// The pipeline: Salesforce → Starbridge → rules/Claude → Salesforce write → Slack → next step.
import { config } from "./config";
import { applyRules } from "./rules";
import { createSalesforce, type SalesforceClient } from "./salesforce";
import { claudeScorer, mockScorer, scoreWithFallback, type Scorer } from "./score";
import { buildSlackMessage, postToSlack } from "./slack";
import { lookupAccountScore } from "./starbridge";
import { SubmissionSchema, type Decision, type NextStep, type SfContext, type StarbridgeResult, type WriteResult } from "./types";

export interface Deps {
  salesforce: SalesforceClient;
  starbridge: (district: string, stateCode?: string) => Promise<StarbridgeResult>;
  scorer: Scorer;
  slack: (text: string) => Promise<void>;
}

export function defaultDeps(): Deps {
  return {
    salesforce: createSalesforce(),
    starbridge: lookupAccountScore,
    scorer: config.mockMode ? mockScorer : claudeScorer,
    slack: postToSlack,
  };
}

export interface RouterResponse {
  status: number;
  body: { ok: boolean; level?: number; next?: NextStep; error?: string };
}

const THANKS: NextStep = { type: "thanks", message: "Thanks! We just sent you a few resources. Reply to that email any time and our team will get back to you." };
const MIN_FILL_MS = 2500;

export async function handleSubmission(raw: unknown, deps: Deps = defaultDeps()): Promise<RouterResponse> {
  const started = Date.now();
  const timings: Record<string, number> = {};
  const time = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    try { return await fn(); } finally { timings[step] = Date.now() - t; }
  };

  const parsed = SubmissionSchema.safeParse(raw);
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

  let sf: SfContext = { matchedBy: "none" };
  let sb: StarbridgeResult = { source: "error" };
  let write: WriteResult = { action: "skipped" };
  const errors: string[] = [];

  try {
    sf = await time("salesforce_lookup", () => deps.salesforce.lookup(sub));
  } catch (err) {
    errors.push(`salesforce_lookup: ${msg(err)}`);
  }

  // Salesforce district names end in "(City, ST)"; pass the state so Starbridge picks the right district.
  const district = sf.account?.parentName ?? sf.account?.name;
  const stateCode = district?.match(/,\s*([A-Z]{2})\)\s*$/)?.[1];
  sb = await time("starbridge", () => deps.starbridge(sub.school, stateCode));

  const decision: Decision = applyRules(sub, sf) ?? (await time("scoring", () => scoreWithFallback(deps.scorer, sub, sf, sb)));

  try {
    write = await time("salesforce_write", () => deps.salesforce.upsertContact(sub, sf, decision));
  } catch (err) {
    errors.push(`salesforce_write: ${msg(err)}`);
    write = { action: "skipped", note: `Write failed: ${msg(err)}` };
  }

  const next = nextStep(decision);
  try {
    await time("slack", () => deps.slack(buildSlackMessage(sub, sf, sb, decision, write, next)));
  } catch (err) {
    errors.push(`slack: ${msg(err)}`);
  }

  log({
    event: "submission",
    email: sub.email,
    role: sub.job_title,
    school: sub.school,
    utm_campaign: sub.utm_campaign,
    utm_content: sub.utm_content,
    level: decision.level,
    route: decision.route,
    source: decision.source,
    reason: decision.reason,
    sf_match: sf.matchedBy,
    sf_account: sf.account?.name,
    sf_write: write.action,
    sf_payload: write.payload,
    starbridge: sb,
    timings,
    total_ms: Date.now() - started,
    errors,
  });

  return { status: 200, body: { ok: true, level: decision.level, next } };
}

export function nextStep(decision: Decision): NextStep {
  const { routing } = config;
  if (decision.route === "gm" && routing.gmBookingUrl) {
    return { type: "calendar", host: routing.gmName, url: routing.gmBookingUrl, message: "Pick a time to meet with our district team." };
  }
  if ((decision.route === "bdr" || decision.route === "gm") && routing.bdrBookingUrl) {
    return { type: "calendar", host: routing.bdrName, url: routing.bdrBookingUrl, message: "Pick a time for a quick discovery call." };
  }
  if (decision.route === "owner") {
    return { type: "thanks", message: `Thanks! ${decision.ownerName ?? "Your Innovamat contact"} will reach out to you shortly.` };
  }
  if (decision.route === "email") return THANKS;
  return { type: "thanks", message: "Thanks! A member of our team will reach out within one business day to set up a time." };
}

function msg(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
