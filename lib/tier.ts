// /api/tier: Make posts the Unbounce webhook here and gets back the decision, who follows up and a ready
// Slack message. Make then does the acting (Salesforce, Slack, Task, SMS, Iterable). Always answers 200 with
// something Make can route on, so a lead is never dropped; failures become Level 2 with fallback: true.
import { timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { DECISION_TTL_SEC, decisionKey } from "./decisions";
import { saveHandoff, toSfContext } from "./handoff";
import { decide, decideLead, defaultDeps, log, parseSubmission, type Decided, type Deps } from "./router";
import { isDecisionMaker, isInternalTest } from "./rules";
import { buildSlackHeader, buildSlackMessage } from "./slack";
import { describeScore } from "./starbridge";
import type { Submission } from "./types";

export interface TierResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * What Make sends: the webhook's data.json (an object, or the raw JSON string) plus page fields from the bundle,
 * and what Make found in Salesforce for this lead (lib/handoff.ts), as an object or a JSON string.
 */
interface TierRequest {
  data?: unknown;
  page_url?: string;
  page_name?: string;
  salesforce?: unknown;
}

export async function handleTier(secret: string | undefined, raw: unknown, deps: Deps = defaultDeps(), expected = config.tierSecret): Promise<TierResponse> {
  if (!expected || !secret || !sameSecret(secret, expected)) return { status: 401, body: { ok: false, error: "Unauthorized" } };

  const started = Date.now();
  const req = (raw && typeof raw === "object" ? raw : {}) as TierRequest;
  const data = typeof req.data === "string" ? safeJson(req.data) : req.data;
  const parsed = parseSubmission({ ...(data && typeof data === "object" ? data : {}), page_url: req.page_url });
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    log({ event: "tier", error: `Invalid form data: ${fields}`, page_name: req.page_name });
    return { status: 200, body: fallback(undefined, `Form data incomplete (${fields})`) };
  }
  const sub = parsed.data;

  try {
    // Park Make's Salesforce read for the lead's browser, which may be waiting on it right now, and use it here too.
    const handoff = req.salesforce === undefined ? undefined : toSfContext(typeof req.salesforce === "string" ? safeJson(req.salesforce) : req.salesforce);
    if (handoff) await saveHandoff(deps.store, sub.email, handoff);
    let { value, cached } = await decideLead(sub, handoff ? { ...deps, handoff } : deps);
    // The lead's browser often decides first and only waits HANDOFF_WAIT_MS for this handoff; when Make is slower,
    // that answer has no owner and Make would get it from the cache (a Bakersfield pilot teacher was shown a BDR
    // calendar on Nov 15 2026 while Make DMed the account owner). An owner Make found always wins: decide again with
    // it and replace the cached answer, so /api/verify keeps the calendar locked and a reload shows the owner.
    // The same race without an owner is the common case: in Nov 2026 two in three leads were scored by the page with
    // no district, no PARR and no state, because Make's handoff landed just after the page stopped waiting. When
    // Make's handoff names the account and the cached answer was made without it, decide again with it too. Make
    // acts on this answer (Slack, Salesforce, the email), so the reason says what the page showed if that differs.
    const lateOwner = Boolean(handoff?.existingOwner) && value.decision.route !== "owner";
    const lateAccount = cached && Boolean(handoff?.account) && value.sf.source !== "make";
    const ownerOverride = lateOwner;
    if (handoff && (lateOwner || lateAccount)) {
      const shown = value.decision;
      value = await decide(sub, { ...deps, handoff });
      if (value.decision.route !== "owner" && value.decision.level !== shown.level) {
        value = { ...value, decision: { ...value.decision, reason: `${value.decision.reason} The lead's page showed Level ${shown.level}: Salesforce data arrived after it decided.` } };
      }
      try { await deps.store.set(decisionKey(sub), JSON.stringify(value), DECISION_TTL_SEC); } catch { /* the page just won't see it */ }
      cached = false;
    }
    const body = tierBody(sub, value, cached);
    log({
      event: "tier", caller: "make", cached, owner_override: ownerOverride, late_handoff: lateOwner || lateAccount, email: sub.email, role: sub.job_title, school: sub.school, state: value.state,
      level: value.decision.level, route: value.decision.route, source: value.decision.source, reason: value.decision.reason,
      host: value.host.name, host_source: value.host.source, page_name: req.page_name,
      sf_source: value.sf.source ?? "app", sf_handoff: Boolean(handoff), sf_owner: value.sf.existingOwner?.name,
      timings: value.timings, errors: value.errors, total_ms: Date.now() - started,
    });
    return { status: 200, body };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log({ event: "tier", email: sub.email, error, total_ms: Date.now() - started });
    return { status: 200, body: fallback(sub, `Router error: ${error}`) };
  }
}

/** Flat and null-filled, so every field always exists for Make's mapping. */
export function tierBody(sub: Submission, d: Decided, cached: boolean): Record<string, unknown> {
  const { sf, sb, decision, host, team, next } = d;
  return {
    ok: true,
    level: decision.level,
    route: decision.route,
    meeting: decision.meeting ?? null,
    reason: decision.reason,
    source: decision.source,
    fallback: decision.source === "fallback",
    internal_test: isInternalTest(sub.email),
    decision_maker: isDecisionMaker(sub.job_title),
    state: d.state ?? null,
    host_name: host.name,
    host_user_id: host.userId ?? null,
    host_source: host.source,
    also_add: host.alsoAdd.join(", "),
    booking_url: next.type === "calendar" ? next.url ?? null : null,
    // The state's team from State_GM_owner, whatever the level.
    state_gm: team?.gm ?? null,
    state_contributors: team?.contributors.join(", ") ?? "",
    discovery_owner: team?.discovery ?? null,
    starbridge_score: sb.account?.score ?? null,
    starbridge_fit: sb.account?.fitBand ?? null,
    starbridge_signal: sb.account?.signalBand ?? null,
    starbridge_summary: describeScore(sb),
    sf_contact_id: sf.contact?.id ?? null,
    sf_account_id: sf.account?.id ?? null,
    sf_match: sf.matchedBy,
    sf_source: sf.source ?? "app",
    open_opp_id: sf.openOpportunity?.id ?? sf.existingOwner?.oppId ?? null,
    slack_text: buildSlackMessage(sub, sf, sb, decision, next, { host, team, state: d.state }),
    // Just the level, reason, calendar and Starbridge, for Make to put on top of its usual post.
    slack_header: buildSlackHeader(sub, sb, decision, next, host, team),
    cached,
    // What went wrong along the way (e.g. a Salesforce login failure), and how long each step took, in ms.
    errors: d.errors,
    timings: d.timings,
  };
}

function fallback(sub: Submission | undefined, reason: string): Record<string, unknown> {
  const who = sub ? `*${sub.name} ${sub.surname}* (${sub.job_title}) · ${sub.school} · ${sub.email}` : "a lead with incomplete form data";
  return {
    ok: true, level: 2, route: "bdr", meeting: "discovery", reason, source: "fallback", fallback: true,
    internal_test: sub ? isInternalTest(sub.email) : false, decision_maker: sub ? isDecisionMaker(sub.job_title) : false, state: null,
    host_name: null, host_user_id: null, host_source: null, also_add: "", booking_url: null,
    state_gm: null, state_contributors: "", discovery_owner: null,
    starbridge_score: null, starbridge_fit: null, starbridge_signal: null, starbridge_summary: null,
    sf_contact_id: null, sf_account_id: null, sf_match: "none", sf_source: null, open_opp_id: null,
    slack_text: `:warning: *Level 2 by default* · ${who}\n_${reason}_`,
    slack_header: `:warning: *Level 2 by default* (router unavailable) · New physical sample request :package:\n_${reason}_`,
    cached: false, errors: [reason], timings: {},
  };
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
