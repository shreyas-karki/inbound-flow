// Decide once per lead. The lead's browser (/api/submit) and Make (/api/tier) both ask about the same
// submission within seconds of each other; the first caller scores it and the second reuses the answer,
// so the calendar the lead sees always matches the level in Slack.
// Upstash Redis on Vercel (shared by every instance); an in-memory Map locally and in tests.
import { config } from "./config";
import type { Submission } from "./types";

export interface Store {
  get(key: string): Promise<string | null>;
  /** Set only if the key doesn't exist. True when this caller set it. */
  setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
}

export function memoryStore(): Store {
  const data = new Map<string, { value: string; expires: number }>();
  const live = (key: string) => {
    const hit = data.get(key);
    if (hit && hit.expires < Date.now()) data.delete(key);
    return data.get(key);
  };
  return {
    async get(key) { return live(key)?.value ?? null; },
    async setNx(key, value, ttlSec) {
      if (live(key)) return false;
      data.set(key, { value, expires: Date.now() + ttlSec * 1000 });
      return true;
    },
    async set(key, value, ttlSec) { data.set(key, { value, expires: Date.now() + ttlSec * 1000 }); },
    async del(key) { data.delete(key); },
  };
}

/** Upstash's REST API: one command per POST, no client library needed. */
export function upstashStore(url: string, token: string): Store {
  const run = async (command: (string | number)[]) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`Redis ${command[0]} failed: ${res.status}`);
    return ((await res.json()) as { result: unknown }).result;
  };
  return {
    async get(key) { return (await run(["GET", key])) as string | null; },
    async setNx(key, value, ttlSec) { return (await run(["SET", key, value, "NX", "EX", ttlSec])) === "OK"; },
    async set(key, value, ttlSec) { await run(["SET", key, value, "EX", ttlSec]); },
    async del(key) { await run(["DEL", key]); },
  };
}

let shared: Store | undefined;
export function defaultStore(): Store {
  const { url, token } = config.redis;
  return (shared ??= url && token ? upstashStore(url, token) : memoryStore());
}

/**
 * One key per lead and form answers that both callers see identically. Including the role and timeline
 * lets an internal tester reuse one email for each level; the school is left out because the webhook can
 * carry the district search ID where the browser has the name.
 */
export function decisionKey(sub: Submission): string {
  return ["decision", sub.email, sub.job_title, sub.adoption_timeline].map((s) => s.trim().toLowerCase()).join("|");
}

export const DECISION_TTL_SEC = 2 * 60 * 60;
const LOCK_SEC = 30;
/** Fallback answers (scoring failed) only need to outlive the page/Make pair, not lock a lead in for hours. */
export const FALLBACK_TTL_SEC = 2 * 60;

export interface Once<T> { value: T; cached: boolean }

export async function decideOnce<T>(
  key: string,
  compute: () => Promise<T>,
  store: Store = defaultStore(),
  { waitMs = 8000, pollMs = 300, ttlSec = (_value: T) => DECISION_TTL_SEC } = {},
): Promise<Once<T>> {
  // Redis trouble never blocks a lead: every store call can fail and we just score.
  const safe = async <R>(fn: () => Promise<R>, fallback: R): Promise<R> => {
    try { return await fn(); } catch { return fallback; }
  };
  const read = async () => {
    const hit = await safe(() => store.get(key), null);
    return hit ? (JSON.parse(hit) as T) : undefined;
  };
  const save = async (value: T) => {
    await safe(() => store.set(key, JSON.stringify(value), ttlSec(value)), undefined);
    return { value, cached: false };
  };

  const hit = await read();
  if (hit !== undefined) return { value: hit, cached: true };

  const lock = `${key}|lock`;
  if (await safe(() => store.setNx(lock, "1", LOCK_SEC), true)) {
    try {
      return await save(await compute());
    } finally {
      await safe(() => store.del(lock), undefined);
    }
  }

  // Someone else is scoring this lead right now: wait for their answer, then give up and score it ourselves.
  for (const deadline = Date.now() + waitMs; Date.now() < deadline; ) {
    await new Promise((r) => setTimeout(r, pollMs));
    const value = await read();
    if (value !== undefined) return { value, cached: true };
  }
  return save(await compute());
}
