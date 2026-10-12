// Starbridge Account Scoring for a district (REST API, Bearer key).
// Reads the org's Top Buyers bridge ("Account scoring"): one row per target-market buyer with
// a 0-100 Account Score, a Fit band (Weak/Moderate/Strong/Ideal) and a Signal band
// (NoSignals/Blocked/Cool/Warm/Hot; Blocked = a competitor already holds the account).
// Docs: https://hc.starbridge.ai/api-reference/rest/overview.md
import { config } from "./config";
import type { Store } from "./decisions";
import { coreName, schoolName } from "./salesforce";
import type { AccountScore, StarbridgeResult } from "./types";

const BASE = "https://dashboard.starbridge.ai/api/external";

const STUB: Record<string, AccountScore> = {
  "lakeview county schools": {
    score: 82, fitBand: "Strong", signalBand: "Hot",
    fitSummary: "Large district, low math proficiency, no recent core math adoption.",
    signalSummary: "Board approved a K-8 math curriculum review; RFP expected spring 2027.",
    competitors: [], enrollment: 18000, mathProficiencyPct: 31, propensityToSpend: "Active",
  },
  "oak grove school district": {
    score: 55, fitBand: "Moderate", signalBand: "Cool",
    fitSummary: "Mid-size district with grade 3-5 math gaps.", signalSummary: "Strategic plan mentions a new math curriculum.",
    competitors: ["HMH"], enrollment: 6000, mathProficiencyPct: 44, propensityToSpend: "Selective",
  },
};

interface BuyerBrief { id: string; name: string; type?: string | null; stateCode?: string | null; url?: string | null }
type Cell = { value?: any } | undefined;

async function call<T>(method: "GET" | "PUT", path: string, params: Record<string, string> = {}, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, {
    method,
    headers: { Authorization: `Bearer ${config.starbridge.apiKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Starbridge ${method} ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

let scoringBridgeId: string | undefined = process.env.STARBRIDGE_SCORING_BRIDGE_ID || undefined;
async function getScoringBridgeId(): Promise<string | undefined> {
  if (scoringBridgeId) return scoringBridgeId;
  const out = await call<{ result: { bridgeId: string }[] }>("GET", "/bridge", { filterType: "TopBuyer", pageSize: "1" });
  scoringBridgeId = out.result[0]?.bridgeId;
  return scoringBridgeId;
}

/**
 * Find the district in Starbridge. The lead's email domain is the best evidence
 * (portchesterschools.org → Port Chester Public Schools); otherwise take a school district whose
 * name starts with what they typed. Never fall back to an unrelated buyer: "New York City Public
 * Schools" once scored the Archdiocese of New York.
 */
export async function findBuyer(district: string, stateCode?: string, domain?: string): Promise<BuyerBrief | undefined> {
  const params: Record<string, string> = { buyerName: district, limit: "10" };
  if (stateCode) params.buyerStateCode = stateCode;
  const { buyers } = await call<{ buyers: BuyerBrief[] }>("GET", "/buyer/quick/search", params);
  return pickBuyer(district, buyers, domain);
}

export function pickBuyer(district: string, buyers: BuyerBrief[], domain?: string): BuyerBrief | undefined {
  const isDistrict = (b: BuyerBrief) => b.type === "SchoolDistrict";
  if (domain) {
    const sameDomain = buyers.filter((b) => sameSite(b.url, domain));
    const pick = sameDomain.find(isDistrict) ?? sameDomain[0];
    if (pick) return pick;
  }
  const target = coreName(district);
  if (!target) return undefined;
  // Starts with, not contains: "new york" (city is a generic word) is inside "archdiocese of new york".
  return buyers.find((b) => isDistrict(b) && `${coreName(b.name)} `.startsWith(`${target} `));
}

/** "https://www.portchesterschools.org/" vs "portchesterschools.org"; a subdomain of the email domain counts, a parent does not (schools.nyc.gov is not nyc.gov). */
function sameSite(url: string | null | undefined, domain: string): boolean {
  if (!url) return false;
  let host: string;
  try { host = new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return false; }
  return host === domain || host.endsWith(`.${domain}`);
}

/** Turn a Top Buyers row into the fields the router uses. */
export function parseScoreRow(columns: Record<string, Cell>): AccountScore | undefined {
  const score = columns["Account Score"]?.value;
  if (!score) return undefined; // not scored yet (null is not zero)
  const competitors = (columns["Competitive vendors"]?.value?.previewRows ?? [])
    .filter((r: any) => r.columns?.["Vendor Presence"]?.value !== false)
    .map((r: any) => r.columns?.Vendor?.value)
    .filter(Boolean);
  return {
    score: columns["Account Scoring Score"]?.value ?? score.score,
    fitBand: columns["Fit Band"]?.value ?? score.fit?.band,
    signalBand: columns["Signal Band"]?.value ?? score.signals?.band,
    fitSummary: score.fit?.longExplanation?.summary ?? score.fit?.shortExplanation,
    signalSummary: score.signals?.shortExplanation ?? score.signals?.briefing?.overview,
    competitors,
    enrollment: columns["Total Enrollment"]?.value ?? undefined,
    mathProficiencyPct: columns["Math Proficiency %"]?.value ?? undefined,
    propensityToSpend: columns["Propensity to Spend"]?.value ?? undefined,
  };
}

async function fetchScore(district: string, stateCode?: string, domain?: string): Promise<Omit<StarbridgeResult, "source">> {
  if (config.mock.starbridge || !config.starbridge.apiKey) {
    return { account: STUB[district.trim().toLowerCase()] };
  }
  const [buyer, bridgeId] = await Promise.all([findBuyer(district, stateCode, domain), getScoringBridgeId()]);
  if (!buyer || !bridgeId) return { buyerName: buyer?.name, stateCode: buyer?.stateCode ?? undefined };
  const rows = await call<{ result: { columns: Record<string, Cell> }[] }>(
    "PUT",
    `/bridge/${bridgeId}/row`,
    { pageSize: "1" },
    { filters: { terms: [{ field: "buyerId", operation: "Any", value: [buyer.id] }] } },
  );
  // No row = the district is outside the target market, which is different from a low score.
  return { buyerName: buyer.name, stateCode: buyer.stateCode ?? undefined, account: rows.result[0] ? parseScoreRow(rows.result[0].columns) : undefined };
}

/** `school` is what the form sent; "Akron City - Akron, Summit" is searched as "Akron City". */
export async function lookupAccountScore(school: string, stateCode?: string, domain?: string, timeoutMs = config.starbridge.timeoutMs): Promise<StarbridgeResult> {
  const live = !config.mock.starbridge && Boolean(config.starbridge.apiKey);
  try {
    const out = await Promise.race([
      fetchScore(schoolName(school), stateCode, domain),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    if (out === null) return { source: "timeout" };
    return { ...out, source: live ? "starbridge" : "stub" };
  } catch {
    return { source: "error" };
  }
}

// Starbridge's district search takes 4-7 seconds. The test page warms this cache when the lead picks their
// district (api/warm.ts), so by the time they submit, the answer is usually already here.
const CACHE_TTL_SEC = 24 * 60 * 60;

/** Keyed on the form's exact school value plus the email domain, the two things known before submit. */
export function starbridgeKey(school: string, domain?: string): string {
  return ["sb", school.trim().toLowerCase(), domain ?? ""].join("|");
}

/** lookupAccountScore with a day-long cache. Timeouts and errors aren't kept, so the next lead tries again. */
export async function cachedAccountScore(store: Store, school: string, stateCode?: string, domain?: string, timeoutMs?: number): Promise<StarbridgeResult> {
  const key = starbridgeKey(school, domain);
  try {
    const hit = await store.get(key);
    if (hit) return JSON.parse(hit) as StarbridgeResult;
  } catch { /* cache trouble never blocks a lead */ }
  const out = await lookupAccountScore(school, stateCode, domain, timeoutMs);
  if (out.source === "starbridge" || out.source === "stub") {
    try { await store.set(key, JSON.stringify(out), CACHE_TTL_SEC); } catch { /* ignore */ }
  }
  return out;
}

/** One-line summary for Slack. Competitors stay out (the team asked); Claude still sees them in the scoring input. */
export function describeScore(sb: StarbridgeResult): string {
  const a = sb.account;
  if (!a) {
    if (sb.source === "timeout" || sb.source === "error") return `Starbridge unavailable (${sb.source})`;
    return sb.buyerName ? `${sb.buyerName}: not in the Account Scoring target market` : "No Starbridge match";
  }
  const facts = [
    a.enrollment && `${a.enrollment.toLocaleString("en-US")} students`,
    a.mathProficiencyPct !== undefined && `${a.mathProficiencyPct}% math proficient`,
    a.propensityToSpend && `spend: ${a.propensityToSpend}`,
  ].filter(Boolean);
  return `Account Score ${a.score}/100 · Fit ${a.fitBand} · Signals ${a.signalBand}${facts.length ? ` · ${facts.join(" · ")}` : ""}`;
}
