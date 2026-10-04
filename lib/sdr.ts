// AI SDR: writes the first reply to every scored lead, in Luis's inbound-template voice.
// No Gmail API access in the prototype, so the draft comes with a Gmail compose link: clicking it
// opens the email pre-filled in the rep's own Gmail, which saves it as a draft.
import fs from "node:fs";
import path from "node:path";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { claudeClient } from "./claude";
import { config } from "./config";
import { isNyc, roleGroup } from "./rules";
import type { Decision, NextStep, ReplyDraft, SfContext, StarbridgeResult, Submission } from "./types";

const DraftSchema = z.object({ subject: z.string(), body: z.string() });

export type Drafter = (sub: Submission, sf: SfContext, sb: StarbridgeResult, decision: Decision, next: NextStep) => Promise<ReplyDraft | undefined>;

const prompt = (file: string) => fs.readFileSync(path.join(process.cwd(), "prompts", file), "utf8");

function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v), template);
}

/** Who a teacher or coach should loop in: the principal/AP in NYC (schools buy at building level), else the district. */
export function loopInTarget(sub: Submission, sf: SfContext): string {
  return isNyc(sub, sf)
    ? "your principal or an assistant principal"
    : "someone at your district who leads curriculum decisions, such as your curriculum director or math director";
}

/** Opens Gmail with the email pre-filled. Gmail auto-saves it as a draft in whoever is signed in. */
export function gmailComposeUrl(to: string, subject: string, body: string, from?: string): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  const account = from ? `/mail/u/${encodeURIComponent(from)}/` : "/mail/";
  return `https://mail.google.com${account}?${params}`;
}

function templateVars(sub: Submission, sf: SfContext, next: NextStep) {
  return {
    rep_name: config.routing.replyFromName,
    booking_url: next.type === "calendar" && next.url ? next.url : "(no booking link configured)",
    loop_in: loopInTarget(sub, sf),
    first_name: sub.name,
    district: sub.school,
  };
}

function finish(sub: Submission, subject: string, body: string, source: ReplyDraft["source"]): ReplyDraft {
  return { to: sub.email, subject, body, source, gmailUrl: gmailComposeUrl(sub.email, subject, body, config.routing.replyFromEmail || undefined) };
}

/** Fixed Level 1 email, used offline and whenever Claude fails. Higher levels get no fallback draft. */
export function templateDraft(sub: Submission, sf: SfContext, decision: Decision, next: NextStep): ReplyDraft | undefined {
  if (decision.level !== 1) return undefined;
  const text = fill(prompt("level1-email.md"), templateVars(sub, sf, next));
  const [first, ...rest] = text.split("\n");
  return finish(sub, first.replace(/^Subject:\s*/, ""), rest.join("\n").trim(), "template");
}

export const claudeDrafter: Drafter = async (sub, sf, sb, decision, next) => {
  const lead = {
    level: decision.level,
    meeting: decision.meeting ?? "none (Level 1)",
    first_name: sub.name,
    role: sub.job_title,
    role_group: roleGroup(sub.job_title),
    district_or_school: sf.account?.parentName ?? sf.account?.name ?? sub.school,
    state: sb.stateCode ?? sf.account?.name?.match(/,\s*([A-Z]{2})\)\s*$/)?.[1] ?? null,
    is_nyc: isNyc(sub, sf),
    grades: sub.form_grades || null,
    curriculum_adoption: sub.adoption_timeline || null,
    what_they_wrote: sub.needs || null,
    district_context: sb.account?.signalSummary ?? null,
    why_scored_this_way: decision.reason,
  };

  const response = await claudeClient().messages.parse(
    {
      model: config.anthropic.model,
      max_tokens: 2048,
      system: fill(prompt("sdr-reply.md"), templateVars(sub, sf, next)),
      messages: [{ role: "user", content: `Write the reply to this lead.\n\n${JSON.stringify(lead, null, 2)}` }],
      output_config: { format: zodOutputFormat(DraftSchema), effort: "low" },
    },
    { timeout: config.anthropic.draftTimeoutMs, maxRetries: 1 },
  );
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(`Claude returned no draft (stop_reason: ${response.stop_reason})`);
  }
  const { subject, body } = response.parsed_output;
  return finish(sub, subject, body, "claude");
};

/** Offline drafter for MOCK_CLAUDE: the Level 1 template, nothing for higher levels. */
export const mockDrafter: Drafter = async (sub, sf, _sb, decision, next) => templateDraft(sub, sf, decision, next);

/** Never throws: a failed draft falls back to the template (Level 1) or to no draft. */
export async function draftWithFallback(drafter: Drafter, ...args: Parameters<Drafter>): Promise<{ draft?: ReplyDraft; error?: string }> {
  try {
    return { draft: await drafter(...args) };
  } catch (err) {
    const [sub, sf, , decision, next] = args;
    return { draft: templateDraft(sub, sf, decision, next), error: err instanceof Error ? err.message : String(err) };
  }
}
