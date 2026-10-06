// The pipeline: Salesforce → Starbridge → rules/Claude → next step (page responds here)
// → in the background: Salesforce write, AI SDR reply draft, Slack, prototype inbox.
import { config } from "./config";
import { addToOutbox } from "./outbox";
import { applyRules, meetingForLevel } from "./rules";
import { createSalesforce, emailDomain, type SalesforceClient } from "./salesforce";
import { claudeScorer, mockScorer, scoreWithFallback, type Scorer } from "./score";
import { claudeDrafter, draftWithFallback, mockDrafter, type Drafter } from "./sdr";
import { buildSlackMessage, postToSlack } from "./slack";
import { describeScore, lookupAccountScore } from "./starbridge";
import { SubmissionSchema, type Decision, type NextStep, type ReplyDraft, type SfContext, type StarbridgeResult, type WriteResult } from "./types";

export interface Deps {
  salesforce: SalesforceClient;
  starbridge: (district: string, stateCode?: string, domain?: string) => Promise<StarbridgeResult>;
  scorer: Scorer;
  drafter: Drafter;
  slack: (text: string) => Promise<void>;
}

export function defaultDeps(): Deps {
  return {
    salesforce: createSalesforce(),
    starbridge: lookupAccountScore,
    scorer: config.mock.claude ? mockScorer : claudeScorer,
    drafter: config.mock.claude ? mockDrafter : claudeDrafter,
    slack: postToSlack,
  };
}

export interface RouterResponse {
  status: number;
  body: { ok: boolean; level?: number; route?: Decision["route"]; next?: NextStep; error?: string };
  /** Work that finishes after the page has its answer. Vercel keeps it alive with waitUntil. */
  background?: Promise<void>;
}

const THANKS: NextStep = { type: "thanks", message: "Thanks! We just sent you a few resources. Reply to that email any time and our team will get back to you." };
const LEVEL1: NextStep = { type: "thanks", message: "Thanks! We'll follow up by email about your request." };
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
  const errors: string[] = [];

  try {
    sf = await time("salesforce_lookup", () => deps.salesforce.lookup(sub));
  } catch (err) {
    errors.push(`salesforce_lookup: ${msg(err)}`);
  }

  // Salesforce district names end in "(City, ST)"; pass the state so Starbridge picks the right district.
  const district = sf.account?.parentName ?? sf.account?.name;
  const stateCode = district?.match(/,\s*([A-Z]{2})\)\s*$/)?.[1];
  const sb: StarbridgeResult = await time("starbridge", () => deps.starbridge(sub.school, stateCode, emailDomain(sub.email)));

  const ruled = applyRules(sub, sf);
  const decision: Decision = ruled ? { ...ruled, meeting: ruled.route === "owner" ? undefined : meetingForLevel(ruled.level) } : await time("scoring", () => scoreWithFallback(deps.scorer, sub, sf, sb));
  const next = nextStep(decision);
  const responded_ms = Date.now() - started;

  const background = (async () => {
    let write: WriteResult = { action: "skipped" };
    let draft: ReplyDraft | undefined;
    let draftError: string | undefined;

    // Existing customers and open deals belong to their owner, and Level 0 gets the automatic email: no AI reply.
    const [writeOut, draftOut] = await Promise.all([
      time("salesforce_write", () => deps.salesforce.upsertContact(sub, sf, decision)).catch((err) => {
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
        await time("slack", () => deps.slack(buildSlackMessage(sub, sf, sb, decision, write, next, draft)));
      } catch (err) {
        errors.push(`slack: ${msg(err)}`);
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
      email: sub.email,
      role: sub.job_title,
      school: sub.school,
      utm_campaign: sub.utm_campaign,
      utm_content: sub.utm_content,
      adoption_timeline: sub.adoption_timeline,
      level: decision.level,
      route: decision.route,
      meeting: decision.meeting,
      source: decision.source,
      reason: decision.reason,
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

export function nextStep(decision: Decision): NextStep {
  const { routing } = config;
  if (decision.route === "gm" && routing.gmBookingUrl) {
    return { type: "calendar", host: routing.gmName, url: embeddable(routing.gmBookingUrl), message: "Pick a time to meet with our district team." };
  }
  if ((decision.route === "bdr" || decision.route === "gm") && routing.bdrBookingUrl) {
    return { type: "calendar", host: routing.bdrName, url: embeddable(routing.bdrBookingUrl), message: "Pick a time for a quick discovery call." };
  }
  if (decision.route === "owner") {
    return { type: "thanks", message: `Thanks! ${decision.ownerName ?? "Your Innovamat contact"} will reach out to you shortly.` };
  }
  if (decision.route === "email") return LEVEL1;
  return { type: "thanks", message: "Thanks! A member of our team will reach out within one business day to set up a time." };
}

/** Google appointment pages only allow iframes on the full URL with ?gv=true (calendar.app.google short links refuse). */
export function embeddable(url: string): string {
  if (!url.includes("/calendar/appointments/schedules/") || /[?&]gv=true/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}gv=true`;
}

function msg(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
