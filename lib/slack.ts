import { config } from "./config";
import { describeScore } from "./starbridge";
import type { Decision, NextStep, ReplyDraft, SfContext, StarbridgeResult, Submission, WriteResult } from "./types";

const LEVEL_EMOJI = { 0: ":white_circle:", 1: ":large_yellow_circle:", 2: ":large_blue_circle:", 3: ":large_green_circle:" } as const;

export function buildSlackMessage(sub: Submission, sf: SfContext, sb: StarbridgeResult, decision: Decision, write: WriteResult, next: NextStep, draft?: ReplyDraft): string {
  const who = `*${sub.name} ${sub.surname}* (${sub.job_title}) · ${sub.school}`;
  const routeLine = {
    owner: `Routed to *${decision.ownerName ?? "account owner"}* (existing account/deal). Please follow up.`,
    gm: next.type === "calendar" ? `*First Touch* (decision maker). Shown *${next.host}*'s calendar. Watch for the booking.` : `:warning: No calendar link configured. Reach out to book a First Touch with *${config.routing.gmName}*.`,
    bdr: next.type === "calendar" ? `*Discovery*. Shown *${next.host}*'s calendar. Watch for the booking.` : `:warning: No calendar link configured. Reach out to book a Discovery call.`,
    email: `Level 1: no meeting yet. The reply asks them to loop in a decision maker.`,
  }[decision.route];

  const lines = [
    `${LEVEL_EMOJI[decision.level]} *Level ${decision.level}* · ${who}`,
    `_${decision.reason}_ (${decision.source})`,
    routeLine,
    `Email: ${sub.email}${sub.phone_number ? ` · Phone: ${sub.phone_number}` : ""}`,
    sub.adoption_timeline && `Curriculum adoption: ${sub.adoption_timeline}`,
    sub.needs && `Needs: ${sub.needs}`,
    `Starbridge: ${describeScore(sb)}`,
    sb.account?.signalSummary && `Signals: ${sb.account.signalSummary}`,
    `Salesforce: ${write.action}${write.note ? ` · ${write.note}` : ""}${sf.recordUrl ? ` · <${sf.recordUrl}|open record>` : ""}`,
    sf.accountCandidates?.length && `Possible accounts: ${sf.accountCandidates.slice(0, 5).join(", ")}`,
    sub.utm_campaign && `Campaign: ${sub.utm_campaign}${sub.utm_content ? ` / ${sub.utm_content}` : ""}`,
  ];
  if (draft) {
    lines.push(`AI SDR reply (${draft.source}): <${draft.gmailUrl}|open as Gmail draft>`);
    lines.push("```Subject: " + draft.subject + "\n\n" + draft.body + "```");
  }
  return lines.filter(Boolean).join("\n");
}

export async function postToSlack(text: string): Promise<void> {
  if (!config.slack.webhookUrl) {
    console.log(`\n[slack:mock]\n${text}\n`);
    return;
  }
  const res = await fetch(config.slack.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack post failed: ${res.status}`);
}
