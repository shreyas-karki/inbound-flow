// The pipeline: Salesforce → Starbridge → rules/Claude → host and calendar (page responds here)
// → in the background: Salesforce write, AI SDR reply draft, Slack, prototype inbox.
// decide() is shared with /api/tier (lib/tier.ts), where Make asks for the same decision and does the acting itself.
import { embeddable, EMPTY_TABLES, loadRoutingTables, resolveHost, resolveState, type RoutingTables } from "./calendars";
import { config } from "./config";
import { decideOnce, decisionKey, defaultStore, DECISION_TTL_SEC, FALLBACK_TTL_SEC, type Store } from "./decisions";
import { addToOutbox } from "./outbox";
import { applyRules, capFirstTouch, isInternalTest, liftLargeDistrict, meetingForLevel } from "./rules";
import { createSalesforce, emailDomain, type SalesforceClient } from "./salesforce";
import { claudeScorer, mockScorer, scoreWithFallback, type Scorer } from "./score";
import { claudeDrafter, draftWithFallback, mockDrafter, type Drafter } from "./sdr";
import { buildSlackMessage, postToSlack } from "./slack";
import { cachedAccountScore, describeScore } from "./starbridge";
import { stateCode } from "./states";
import { fromUnbounce } from "./unbounce";
import { SubmissionSchema, type Decision, type Host, type NextStep, type ReplyDraft, type SfContext, type StarbridgeResult, type Submission, type WriteResult } from "./types";

export { embeddable };

export interface Deps {
  salesforce: SalesforceClient;
  /** Gets the form's school value as-is; the lookup strips the " - City, County" part. */
  starbridge: (school: string, stateCode?: string, domain?: string) => Promise<StarbridgeResult>;
  scorer: Scorer;
  drafter: Drafter;
  slack: (text: string) => Promise<void>;
  routing: () => Promise<RoutingTables>;
  store: Store;
  actionsOwner?: "app" | "make"; // defaults to config.actionsOwner
}

export function defaultDeps(): Deps {
  const store = defaultStore();
  return {
    salesforce: createSalesforce(),
    starbridge: (school, stateCode, domain) => cachedAccountScore(store, school, stateCode, domain),
    scorer: config.mock.claude ? mockScorer : claudeScorer,
    drafter: config.mock.claude ? mockDrafter : claudeDrafter,
    slack: postToSlack,
    routing: loadRoutingTables,
    store,
  };
}

export interface RouterResponse {
  status: number;
  body: { ok: boolean; level?: number; route?: Decision["route"]; next?: NextStep; error?: string };
  /** Work that finishes after the page has its answer. Vercel keeps it alive with waitUntil. */
  background?: Promise<void>;
}

/** Everything known about a lead once it's scored. Cached per lead, so it must stay plain JSON. */
export interface Decided {
  sf: SfContext;
  sb: StarbridgeResult;
  decision: Decision;
  state?: string;
  host: Host;
  next: NextStep;
  timings: Record<string, number>;
  errors: string[];
}

const THANKS: NextStep = { type: "thanks", message: "Thanks! We just sent you a few resources. Reply to that email any time and our team will get back to you." };
const LEVEL1: NextStep = { type: "thanks", message: "Thanks! We'll follow up by email about your request." };
const MIN_FILL_MS = 2500;

/** Unbounce field names or ours, array-wrapped or not → a validated submission. */
export function parseSubmission(raw: unknown) {
  return SubmissionSchema.safeParse(fromUnbounce(raw));
}

export async function decide(sub: Submission, deps: Deps): Promise<Decided> {
  const timings: Record<string, number> = {};
  const errors: string[] = [];
  const time = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    try { return await fn(); } finally { timings[step] = Date.now() - t; }
  };

  // The routing sheet loads alongside the lookups; it's cached, so this is usually instant.
  const tables = deps.routing().catch(() => EMPTY_TABLES);

  const salesforce = time("salesforce_lookup", () => deps.salesforce.lookup(sub)).catch((err): SfContext => {
    errors.push(`salesforce_lookup: ${msg(err)}`);
    return { matchedBy: "none" };
  });
  const starbridge = (code?: string) => time("starbridge", () => deps.starbridge(sub.school, code, emailDomain(sub.email)));

  // Starbridge needs the state to pick the right district. When the form has it, both lookups run at once
  // (Starbridge alone can take 5+ seconds); otherwise Starbridge waits for the "(City, ST)" on the Salesforce district.
  const formState = stateCode(sub.state);
  const [sf, sb] = formState
    ? await Promise.all([salesforce, starbridge(formState)])
    : await salesforce.then(async (sf) => {
        const district = sf.account?.parentName ?? sf.account?.name;
        return [sf, await starbridge(district?.match(/,\s*([A-Z]{2})\)\s*$/)?.[1])] as const;
      });

  const ruled = applyRules(sub, sf, sb);
  const scored: Decision = ruled ? { ...ruled, meeting: ruled.route === "owner" ? undefined : meetingForLevel(ruled.level) } : await time("scoring", () => scoreWithFallback(deps.scorer, sub, sf, sb));
  const decision = liftLargeDistrict(capFirstTouch(scored, sf, sb), sf);

  const state = resolveState(sub, sf, sb);
  const host = resolveHost(decision, state, sf, await time("routing_sheet", () => tables));
  return { sf, sb, decision, state, host, next: nextStep(decision, host), timings, errors };
}

/** decide(), but once per lead: the browser and Make share the first caller's answer. */
export function decideLead(sub: Submission, deps: Deps) {
  return decideOnce(decisionKey(sub), () => decide(sub, deps), deps.store, {
    ttlSec: (d) => (d.decision.source === "fallback" ? FALLBACK_TTL_SEC : DECISION_TTL_SEC),
  });
}

export async function handleSubmission(raw: unknown, deps: Deps = defaultDeps()): Promise<RouterResponse> {
  const started = Date.now();
  const parsed = parseSubmission(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    return { status: 400, body: { ok: false, error: `Check these fields: ${fields}` } };
  }
  const sub = parsed.data;

  // Bots: pretend success, do nothing.
  const tooFast = sub.form_started_at !== undefined && Date.now() - sub.form_started_at < MIN_FILL_MS;
  if (sub.website || tooFast) {
    log({ event: "bot_rejected", email: sub.email, honeypot: Boolean(sub.website), tooFast });
    return { status: 200, body: { ok: true, level: 1, next: THANKS } };
  }

  const { value: decided, cached } = await decideLead(sub, deps);
  const { sf, sb, decision, host, next, timings } = decided;
  const errors = [...decided.errors];
  const responded_ms = Date.now() - started;
  const appActs = (deps.actionsOwner ?? config.actionsOwner) === "app";

  const background = (async () => {
    const time = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
      const t = Date.now();
      try { return await fn(); } finally { timings[step] = Date.now() - t; }
    };
    let write: WriteResult = { action: "skipped", note: "Make writes Salesforce" };
    let draft: ReplyDraft | undefined;
    let draftError: string | undefined;

    if (appActs) {
      // Existing customers and open deals belong to their owner, and Level 0 gets the automatic email: no AI reply.
      const [writeOut, draftOut] = await Promise.all([
        isInternalTest(sub.email)
          ? Promise.resolve<WriteResult>({ action: "skipped", note: "Internal test (@innovamat.com)" })
          : time("salesforce_write", () => deps.salesforce.upsertContact(sub, sf, decision)).catch((err) => {
              errors.push(`salesforce_write: ${msg(err)}`);
              return { action: "skipped", note: `Write failed: ${msg(err)}` } as WriteResult;
            }),
        decision.route === "owner" || decision.level === 0 ? Promise.resolve({}) : time("draft", () => draftWithFallback(deps.drafter, sub, sf, sb, decision, next)),
      ]);
      write = writeOut;
      ({ draft, error: draftError } = draftOut as { draft?: ReplyDraft; error?: string });
      if (draftError) errors.push(`draft: ${draftError}`);

      // Levels 0 and 1 need no sales action, and each post costs a BDR a read.
      if (decision.level >= 2) {
        try {
          await time("slack", () => deps.slack(buildSlackMessage(sub, sf, sb, decision, next, { host, state: decided.state, write, draft })));
        } catch (err) {
          errors.push(`slack: ${msg(err)}`);
        }
      }
    }

    addToOutbox({
      at: new Date().toISOString(),
      lead: { name: sub.name, surname: sub.surname, email: sub.email, job_title: sub.job_title, school: sub.school, adoption_timeline: sub.adoption_timeline, needs: sub.needs },
      decision,
      starbridge: describeScore(sb),
      signals: sb.account?.signalSummary,
      salesforce: write.action,
      draft,
      draftError,
    });

    log({
      event: "submission",
      caller: "page",
      actions_owner: appActs ? "app" : "make",
      cached,
      email: sub.email,
      role: sub.job_title,
      school: sub.school,
      state: decided.state,
      utm_campaign: sub.utm_campaign,
      utm_content: sub.utm_content,
      adoption_timeline: sub.adoption_timeline,
      level: decision.level,
      route: decision.route,
      meeting: decision.meeting,
      source: decision.source,
      reason: decision.reason,
      host: host.name,
      host_source: host.source,
      sf_match: sf.matchedBy,
      sf_account: sf.account?.name,
      sf_write: write.action,
      sf_payload: write.payload,
      starbridge: sb,
      draft_source: draft?.source,
      timings,
      responded_ms,
      total_ms: Date.now() - started,
      errors,
    });
  })();

  return { status: 200, body: { ok: true, level: decision.level, route: decision.route, next }, background };
}

export function nextStep(decision: Decision, host: Host): NextStep {
  if (decision.route === "owner") {
    return { type: "thanks", host: host.name, message: `Thanks! ${host.name} will reach out to you shortly.` };
  }
  if (decision.route === "email") return LEVEL1;
  if (host.bookingUrl) {
    const message = decision.route === "gm" ? "Pick a time to meet with our district team." : "Pick a time for a quick discovery call.";
    return { type: "calendar", host: host.name, url: embeddable(host.bookingUrl), message };
  }
  return { type: "thanks", host: host.name, message: "Thanks! A member of our team will reach out within one business day to set up a time." };
}

function msg(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
