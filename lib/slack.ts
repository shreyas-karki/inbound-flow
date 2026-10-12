import { config } from "./config";
import { isInternalTest } from "./rules";
import { describeScore } from "./starbridge";
import type { Decision, Host, NextStep, ReplyDraft, SfContext, StarbridgeResult, Submission, WriteResult } from "./types";

const LEVEL_EMOJI = { 0: ":white_circle:", 1: ":large_yellow_circle:", 2: ":large_blue_circle:", 3: ":large_green_circle:" } as const;
const LEVEL_NAME = { 0: "Dead end", 1: "Long shot", 2: "Discovery", 3: "First Touch" } as const;

export interface SlackExtras {
  host?: Host;
  /** The lead's state as resolved by the router (form, Salesforce or Starbridge). */
  state?: string;
  /** Omitted when Make does the Salesforce write: the message then just links the record it found. */
  write?: WriteResult;
  draft?: ReplyDraft;
}

/**
 * The decision part of a post: level, reason, who and which calendar, Starbridge. Make puts this on top of
 * 172177's usual "New physical sample request" body, so the team sees the same post they know plus the level.
 */
export function buildSlackHeader(sub: Submission, sb: StarbridgeResult, decision: Decision, next: NextStep, host?: Host): string {
  const hostName = host?.name ?? (decision.route === "gm" ? config.routing.gmName : config.routing.bdrName);
  const label = decision.route === "owner" ? "Existing account" : LEVEL_NAME[decision.level];
  const routeLine = {
    owner: `:handshake: Routed to *${host?.name ?? decision.ownerName ?? "account owner"}* (existing account/deal). Please follow up.`,
    gm: next.type === "calendar" ? `:calendar: *First Touch*: shown *${next.host}*'s calendar. Watch for the booking.` : `:warning: No calendar link for *${hostName}*. Reach out to book a First Touch.`,
    bdr: next.type === "calendar" ? `:calendar: *Discovery*: shown *${next.host}*'s calendar. Watch for the booking.` : `:warning: No calendar link for *${hostName}*. Reach out to book a Discovery call.`,
    email: `:email: No meeting yet: they get an email asking who picks math curriculum.`,
  }[decision.route];
  return [
    `${isInternalTest(sub.email) ? ":test_tube: *TEST* · " : ""}${LEVEL_EMOJI[decision.level]} *Level ${decision.level} · ${label}* · New physical sample request :package:`,
    `_${decision.reason}_ (${decision.source})`,
    routeLine,
    host?.alsoAdd.length ? `:busts_in_silhouette: Also add to the call: ${host.alsoAdd.join(", ")}` : undefined,
    `:bar_chart: Starbridge: ${describeScore(sb)}`,
    sb.account?.signalSummary ? `:fire: Signals: ${sb.account.signalSummary}` : undefined,
  ].filter((l): l is string => Boolean(l)).join("\n");
}

/** The whole post, in the layout of the team's existing sample-request posts. Used when the app posts itself. */
export function buildSlackMessage(sub: Submission, sf: SfContext, sb: StarbridgeResult, decision: Decision, next: NextStep, { host, state, write, draft }: SlackExtras = {}): string {
  const salesforce = write
    ? `:salesforce: Salesforce: ${write.action}${write.note ? ` · ${write.note}` : ""}${sf.recordUrl ? ` · <${sf.recordUrl}|open record>` : ""}`
    : sf.recordUrl ? `:salesforce: Salesforce link: ${sf.recordUrl}` : undefined;
  const body = [
    `:pencil2: Name: ${sub.name} ${sub.surname}`,
    `:email: Email: ${sub.email}`,
    sub.phone_number ? `:iphone: Phone: ${sub.phone_number}` : undefined,
    `:label: Role: ${sub.job_title}`,
    `:office: Company: ${sub.school}${sub.country ? `, ${sub.country}` : ""}`,
    state ? `:globe_with_meridians: State: ${state}` : undefined,
    sub.utm_medium ? `📍 UTM Medium: ${sub.utm_medium}` : undefined,
    sub.utm_source ? `:vertical_traffic_light: UTM Source: ${sub.utm_source}` : undefined,
    sub.utm_campaign ? `:dart: Campaign: ${sub.utm_campaign}` : undefined,
    salesforce,
    sf.accountCandidates?.length ? `:mag: Possible accounts: ${sf.accountCandidates.slice(0, 5).join(", ")}` : undefined,
    `:question: When is your district planning to adopt? ${sub.adoption_timeline || "not answered"}`,
    "",
    `:speaking_head_in_silhouette: Message: ${sub.needs || "(none)"}`,
  ].filter((l): l is string => l !== undefined);
  const lines = [buildSlackHeader(sub, sb, decision, next, host), "", ...body];
  if (draft) {
    lines.push(`AI SDR reply (${draft.source}): <${draft.gmailUrl}|open as Gmail draft>`);
    lines.push("```Subject: " + draft.subject + "\n\n" + draft.body + "```");
  }
  return lines.join("\n");
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
