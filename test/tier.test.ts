import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { decideOnce, memoryStore, type Store } from "../lib/decisions";
import { handleSubmission, type Deps } from "../lib/router";
import { createSalesforce } from "../lib/salesforce";
import { mockScorer, type Scorer } from "../lib/score";
import { mockDrafter } from "../lib/sdr";
import { lookupAccountScore } from "../lib/starbridge";
import { handleTier } from "../lib/tier";
import { IDS, TABLES } from "./fixtures/routing";

const SECRET = "test-secret";
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", `unbounce-${name}.json`), "utf8"));

function deps(over: Partial<Deps> = {}) {
  const calls = { score: 0, upsert: 0, slack: 0, draft: 0 };
  const salesforce = createSalesforce();
  const d: Deps = {
    salesforce: { lookup: (s) => salesforce.lookup(s), upsertContact: async (...a) => { calls.upsert++; return salesforce.upsertContact(...a); } },
    starbridge: lookupAccountScore,
    scorer: async (...a) => { calls.score++; return mockScorer(...a); },
    drafter: async (...a) => { calls.draft++; return mockDrafter(...a); },
    slack: async () => { calls.slack++; },
    routing: async () => TABLES,
    store: memoryStore(),
    actionsOwner: "app",
    ...over,
  };
  return { d, calls };
}

describe("/api/tier", () => {
  vi.spyOn(console, "log").mockImplementation(() => {});

  it("refuses a missing or wrong secret, and refuses everything when no secret is configured", async () => {
    const { d } = deps();
    expect((await handleTier(undefined, fixture("level2"), d, SECRET)).status).toBe(401);
    expect((await handleTier("nope", fixture("level2"), d, SECRET)).status).toBe(401);
    expect((await handleTier("", fixture("level2"), d, "")).status).toBe(401);
  });

  it("maps the Unbounce payload (arrays, message → needs, state) and returns the BDR for Level 2", async () => {
    const { d } = deps();
    const out = await handleTier(SECRET, fixture("level2"), d, SECRET);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      ok: true, level: 2, route: "bdr", meeting: "discovery", fallback: false, internal_test: false, state: "New York",
      host_name: "Luis Acevedo", host_user_id: IDS.luis, booking_url: "https://calendar.google.com/calendar/appointments/schedules/AcZLuis?gv=true",
      sf_match: "account-name", cached: false,
    });
    expect(out.body.slack_text).toContain("Level 2");
    expect(out.body.slack_text).toContain("Shown *Luis Acevedo*'s calendar");
  });

  it("routes every fixture to the expected level and host", async () => {
    const expected: Record<string, [number, string, string | null]> = {
      level0: [0, "email", "Luis Acevedo"],
      level1: [1, "email", "Luis Acevedo"],
      level2: [2, "bdr", "Luis Acevedo"],
      level3: [3, "gm", "Melina Gruber"], // Indiana's First Touch owner
      owner: [3, "owner", "Sample KAM"],
    };
    for (const [name, [level, route, host]] of Object.entries(expected)) {
      const out = await handleTier(SECRET, fixture(name), deps().d, SECRET);
      expect(out.body, name).toMatchObject({ level, route, host_name: host });
    }
  });

  it("Level 3 says who else to add to the call", async () => {
    const out = await handleTier(SECRET, fixture("level3"), deps().d, SECRET);
    expect(out.body).toMatchObject({ also_add: "Neha", host_user_id: IDS.melina, decision_maker: true });
    expect(out.body.slack_text).toContain("Also add to the call: Neha");
  });

  it("accepts data.json as a raw JSON string, the way Make may pass it", async () => {
    const f = fixture("level2");
    const out = await handleTier(SECRET, { ...f, data: JSON.stringify(f.data) }, deps().d, SECRET);
    expect(out.body).toMatchObject({ level: 2, host_name: "Luis Acevedo" });
  });

  it("a scorer error becomes Level 2 with fallback: true", async () => {
    const broken: Scorer = async () => { throw new Error("Claude down"); };
    const out = await handleTier(SECRET, fixture("level1"), deps({ scorer: broken }).d, SECRET);
    expect(out.body).toMatchObject({ ok: true, level: 2, route: "bdr", fallback: true });
  });

  it("incomplete form data still answers 200 with the Level 2 fallback", async () => {
    const out = await handleTier(SECRET, { data: { email: ["x@example.org"] } }, deps().d, SECRET);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ level: 2, fallback: true, host_user_id: null });
  });

  it("the page and Make share one decision: one scoring call, same level", async () => {
    const { d, calls } = deps();
    const f = fixture("level3");
    const page = await handleSubmission({ ...f.data, page_url: f.page_url }, d);
    await page.background;
    const make = await handleTier(SECRET, f, d, SECRET);
    expect(calls.score).toBe(1);
    expect(make.body).toMatchObject({ level: page.body.level, cached: true });
  });

  it("with ACTIONS_OWNER=make the page decides but never writes Salesforce, posts to Slack or drafts", async () => {
    const { d, calls } = deps({ actionsOwner: "make" });
    const out = await handleSubmission({ ...fixture("level3").data }, d);
    await out.background;
    expect(out.body.level).toBe(3);
    expect(out.body.next).toMatchObject({ type: "calendar", host: "Melina Gruber" });
    expect(calls).toMatchObject({ upsert: 0, slack: 0, draft: 0 });
  });
});

describe("decideOnce", () => {
  it("two callers at once compute once and share the answer", async () => {
    const store = memoryStore();
    let runs = 0;
    const compute = async () => { runs++; await new Promise((r) => setTimeout(r, 50)); return { level: 3 }; };
    const [a, b] = await Promise.all([decideOnce("k", compute, store, { pollMs: 10 }), decideOnce("k", compute, store, { pollMs: 10 })]);
    expect(runs).toBe(1);
    expect(a.value).toEqual(b.value);
    expect([a.cached, b.cached].sort()).toEqual([false, true]);
  });

  it("a broken store never blocks: it just computes", async () => {
    const broken: Store = { get: async () => { throw new Error("down"); }, setNx: async () => { throw new Error("down"); }, set: async () => { throw new Error("down"); }, del: async () => { throw new Error("down"); } };
    const out = await decideOnce("k", async () => 7, broken);
    expect(out).toEqual({ value: 7, cached: false });
  });

  it("keeps each answer for as long as ttlSec says", async () => {
    const sets: number[] = [];
    const store = memoryStore();
    const spy: Store = { ...store, set: async (k, v, ttl) => { sets.push(ttl); return store.set(k, v, ttl); } };
    await decideOnce("a", async () => ({ ok: false }), spy, { ttlSec: (v) => (v.ok ? 7200 : 120) });
    await decideOnce("b", async () => ({ ok: true }), spy, { ttlSec: (v) => (v.ok ? 7200 : 120) });
    expect(sets).toEqual([120, 7200]);
  });

  it("a scoring failure is kept for 2 minutes, not 2 hours, so the lead gets rescored soon", async () => {
    const sets: number[] = [];
    const store = memoryStore();
    const spy: Store = { ...store, set: async (k, v, ttl) => { sets.push(ttl); return store.set(k, v, ttl); } };
    const broken: Scorer = async () => { throw new Error("Claude down"); };
    await handleTier(SECRET, fixture("level1"), deps({ scorer: broken, store: spy }).d, SECRET);
    await handleTier(SECRET, fixture("level2"), deps({ store: spy }).d, SECRET);
    expect(sets).toEqual([120, 7200]);
  });

  it("if the first caller never finishes, the second scores it after waiting", async () => {
    const store = memoryStore();
    await store.setNx("k|lock", "1", 30);
    const out = await decideOnce("k", async () => 2, store, { waitMs: 50, pollMs: 10 });
    expect(out).toEqual({ value: 2, cached: false });
  });
});
