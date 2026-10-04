// Starbridge Account Scoring for a district (REST API, Bearer key).
// Reads the org's Top Buyers bridge ("Account scoring"): one row per target-market buyer with
// a 0-100 Account Score, a Fit band (Weak/Moderate/Strong/Ideal) and a Signal band
// (NoSignals/Blocked/Cool/Warm/Hot; Blocked = a competitor already holds the account).
// Docs: https://hc.starbridge.ai/api-reference/rest/overview.md
import { config } from "./config";
import type { AccountScore, StarbridgeResult } from "./types";

const BASE = "https://dashboard.starbridge.ai/api/external";

const STUB: Record<string, AccountScore> = {
  "lakeview county schools": {
    score: 82, fitBand: "Strong", signalBand: "Hot",
    fitSummary: "Large district, low math proficiency, no recent core math adoption.",
    signalSummary: "Board approved intervention budget; RFP expected spring 2027.",
    competitors: [], enrollment: 18000, mathProficiencyPct: 31, propensityToSpend: "Active",
  },
  "oak grove school district": {
    score: 55, fitBand: "Moderate", signalBand: "Cool",
    fitSummary: "Mid-size district with grade 3-5 math gaps.", signalSummary: "Strategic plan mentions math intervention.",
    competitors: ["HMH"], enrollment: 6000, mathProficiencyPct: 44, propensityToSpend: "Selective",
  },
};

interface BuyerBrief { id: string; name: string; type?: string | null }
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

/** Find the district in Starbridge. Prefers school districts; uses the state when we know it. */
export async function findBuyer(district: string, stateCode?: string): Promise<BuyerBrief | undefined> {
  const params: Record<string, string> = { buyerName: district, limit: "5" };
  if (stateCode) params.buyerStateCode = stateCode;
  const { buyers } = await call<{ buyers: BuyerBrief[] }>("GET", "/buyer/quick/search", params);
  return buyers.find((b) => b.type === "SchoolDistrict") ?? buyers[0];
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

async function fetchScore(district: string, stateCode?: string): Promise<Omit<StarbridgeResult, "source">> {
  if (config.mockMode || !config.starbridge.apiKey) {
    return { account: STUB[district.trim().toLowerCase()] };
  }
  const [buyer, bridgeId] = await Promise.all([findBuyer(district, stateCode), getScoringBridgeId()]);
  if (!buyer || !bridgeId) return { buyerName: buyer?.name };
  const rows = await call<{ result: { columns: Record<string, Cell> }[] }>(
    "PUT",
    `/bridge/${bridgeId}/row`,
    { pageSize: "1" },
    { filters: { terms: [{ field: "buyerId", operation: "Any", value: [buyer.id] }] } },
  );
  // No row = the district is outside the target market, which is different from a low score.
  return { buyerName: buyer.name, account: rows.result[0] ? parseScoreRow(rows.result[0].columns) : undefined };
}

export async function lookupAccountScore(district: string, stateCode?: string): Promise<StarbridgeResult> {
  const live = !config.mockMode && Boolean(config.starbridge.apiKey);
  try {
    const out = await Promise.race([
      fetchScore(district, stateCode),
      new Promise<null>((r) => setTimeout(() => r(null), config.starbridge.timeoutMs)),
    ]);
    if (out === null) return { source: "timeout" };
    return { ...out, source: live ? "starbridge" : "stub" };
  } catch {
    return { source: "error" };
  }
}

/** One-line summary for Slack and the scoring prompt. */
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
    a.competitors.length && `competitors: ${a.competitors.join(", ")}`,
  ].filter(Boolean);
  return `Account Score ${a.score}/100 · Fit ${a.fitBand} · Signals ${a.signalBand}${facts.length ? ` · ${facts.join(" · ")}` : ""}`;
}
