import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "./config";
import { routeForLevel } from "./rules";
import type { Decision, Level, SfContext, StarbridgeResult, Submission } from "./types";

const ScoreSchema = z.object({
  tier: z.enum(["1", "2", "3"]),
  reason: z.string(),
});

export type Scorer = (sub: Submission, sf: SfContext, sb: StarbridgeResult) => Promise<{ level: Level; reason: string }>;

let rubricCache: string | undefined;
function rubric(): string {
  rubricCache ??= fs.readFileSync(path.join(process.cwd(), "prompts", "rubric.md"), "utf8");
  return rubricCache;
}

/** Claude scorer. The router wraps it with a timeout and a Level 2 fallback. */
export const claudeScorer: Scorer = async (sub, sf, sb) => {
  const client = new Anthropic();
  const lead = {
    role: sub.job_title,
    district_or_school: sub.school,
    country: sub.country,
    grades: sub.form_grades,
    needs: sub.needs,
    email_domain: sub.email.split("@")[1],
    salesforce: {
      known_contact: Boolean(sf.contact),
      account_found: sf.account?.name ?? null,
      account_is_school_in_district: Boolean(sf.account?.parentId),
      district: sf.account?.parentName ?? sf.account?.name ?? null,
    },
    starbridge_account_scoring: sb.account
      ? {
          account_score_0_to_100: sb.account.score,
          fit_band: sb.account.fitBand,
          signal_band: sb.account.signalBand,
          fit_summary: sb.account.fitSummary,
          signal_summary: sb.account.signalSummary,
          competitors_present: sb.account.competitors,
          enrollment: sb.account.enrollment,
          math_proficiency_pct: sb.account.mathProficiencyPct,
          propensity_to_spend: sb.account.propensityToSpend,
        }
      : sb.buyerName
        ? "District found but not in the target market (no score)"
        : "No Starbridge data",
  };

  const response = await client.messages.parse(
    {
      model: config.anthropic.model,
      max_tokens: 1024,
      system: rubric(),
      messages: [{ role: "user", content: `Score this inbound lead.\n\n${JSON.stringify(lead, null, 2)}` }],
      output_config: { format: zodOutputFormat(ScoreSchema), effort: "low" },
    },
    { timeout: config.anthropic.timeoutMs, maxRetries: 0 },
  );

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(`Claude returned no score (stop_reason: ${response.stop_reason})`);
  }
  return { level: Number(response.parsed_output.tier) as Level, reason: response.parsed_output.reason };
};

/** Offline scorer for MOCK_MODE: simple points so the whole flow runs without an API key. */
export const mockScorer: Scorer = async (sub, _sf, sb) => {
  await new Promise((r) => setTimeout(r, 400));
  const district = /superintendent|chief|director|coordinator/i.test(sub.job_title) ? 3 : 0;
  const school = /principal|coach|interventionist|mtss|tosa/i.test(sub.job_title) ? 2 : 0;
  const hot = sb.account && ["Hot", "Warm"].includes(sb.account.signalBand) ? 2 : sb.account && sb.account.score >= 60 ? 1 : 0;
  const points = Math.max(district, school) + hot + (/tier ?[23]|intervention|benchmark/i.test(sub.needs) ? 1 : 0);
  const level: Level = points >= 4 ? 3 : points >= 2 ? 2 : 1;
  return { level, reason: `Mock score: ${points} points (${sub.job_title}, Starbridge ${sb.account?.score ?? "n/a"}).` };
};

/** Run a scorer with a hard timeout. Any failure becomes Level 2 so nobody waits on a broken step. */
export async function scoreWithFallback(scorer: Scorer, sub: Submission, sf: SfContext, sb: StarbridgeResult, timeoutMs = config.anthropic.timeoutMs): Promise<Decision> {
  try {
    const result = await Promise.race([
      scorer(sub, sf, sb),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`scoring timed out after ${timeoutMs}ms`)), timeoutMs)),
    ]);
    return { ...result, route: routeForLevel(result.level), source: "claude" };
  } catch (err) {
    return {
      level: 2,
      route: "bdr",
      reason: `Fallback to Level 2 (${err instanceof Error ? err.message : "scoring error"}).`,
      source: "fallback",
    };
  }
}
