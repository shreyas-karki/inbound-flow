import fs from "node:fs";
import path from "node:path";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { claudeClient } from "./claude";
import { config } from "./config";
import { adoptingSoon, isHotDistrict, isNyc, meetingForLevel, roleGroup, routeForLevel } from "./rules";
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
  const client = claudeClient();
  const lead = {
    role: sub.job_title,
    role_group: roleGroup(sub.job_title),
    hot_district: isHotDistrict(sb),
    is_nyc: isNyc(sub, sf),
    district_or_school: sub.school,
    country: sub.country,
    grades: sub.form_grades,
    curriculum_adoption: sub.adoption_timeline || null,
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

/** Offline scorer for MOCK_CLAUDE: the rubric's main rules, so the whole flow runs without an API key. */
export const mockScorer: Scorer = async (sub, _sf, sb) => {
  await new Promise((r) => setTimeout(r, 400));
  const group = roleGroup(sub.job_title);
  const why = adoptingSoon(sub) || isHotDistrict(sb);
  const level: Level =
    group === "decision_maker" ? (why ? 3 : 2)
    : group === "champion" ? 2
    : why ? 2 : 1;
  return { level, reason: `Mock: ${group.replace("_", " ")}${why ? " with a WHY NOW (adopting soon or hot district)" : ", no WHY NOW yet"}.` };
};

/** Run a scorer with a hard timeout. Any failure becomes Level 2 so nobody waits on a broken step. */
export async function scoreWithFallback(scorer: Scorer, sub: Submission, sf: SfContext, sb: StarbridgeResult, timeoutMs = config.anthropic.timeoutMs): Promise<Decision> {
  try {
    const result = await Promise.race([
      scorer(sub, sf, sb),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`scoring timed out after ${timeoutMs}ms`)), timeoutMs)),
    ]);
    return { ...result, route: routeForLevel(result.level), meeting: meetingForLevel(result.level), source: "claude" };
  } catch (err) {
    return {
      level: 2,
      route: "bdr",
      meeting: "discovery",
      reason: `Fallback to Level 2 (${err instanceof Error ? err.message : "scoring error"}).`,
      source: "fallback",
    };
  }
}
