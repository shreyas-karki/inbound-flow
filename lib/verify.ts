// POST /api/verify: a Level 2 or 3 lead gives a school or district email before the calendar unlocks.
// BDRs and growth managers kept getting bookings from Gmail and AOL addresses they couldn't tie to a district.
// Body: { email, lead }. Personal addresses are refused; anything else unlocks the calendar. No code is sent.
import { decisionKey, defaultStore, type Store } from "./decisions";
import { isEmail, isPersonalEmail, normalizeEmail } from "./email";
import type { Decided } from "./router";
import { postToSlack } from "./slack";
import { SubmissionSchema, type Submission } from "./types";
import { fromUnbounce } from "./unbounce";

export interface VerifyDeps {
  store: Store;
  slack: (text: string) => Promise<void>;
}

export function defaultVerifyDeps(): VerifyDeps {
  return { store: defaultStore(), slack: postToSlack };
}

type Reply = { status: number; body: Record<string, unknown> };
const fail = (error: string, reason: string): Reply => ({ status: 400, body: { ok: false, error, reason } });

export async function handleVerify(raw: unknown, deps: VerifyDeps = defaultVerifyDeps()): Promise<Reply> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) return fail("Enter a valid email address.", "invalid");
  if (isPersonalEmail(email)) return fail("Use your school or district email. We can't book calls with Gmail, Yahoo, AOL or other personal addresses.", "personal");

  const parsed = SubmissionSchema.safeParse(fromUnbounce(body.lead));
  const lead = parsed.success ? parsed.data : undefined;
  const switched = Boolean(lead && normalizeEmail(lead.email) !== email);
  if (lead && switched) await noteSwitch(deps, lead, email);
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "verify", email, form_email: lead?.email, switched }));
  return { status: 200, body: { ok: true, email } };
}

/** The BDR sees the form's email in Slack; tell them when the lead will book with a different one. */
async function noteSwitch(deps: VerifyDeps, lead: Submission, email: string) {
  let decided: Decided | undefined;
  try {
    const hit = await deps.store.get(decisionKey(lead));
    if (hit) decided = JSON.parse(hit) as Decided;
  } catch { /* no cached decision: the note goes out without the district and host */ }
  const where = decided?.sf.account?.parentName ?? decided?.sf.account?.name ?? lead.school;
  const booking = decided?.host.name ? ` before booking with ${decided.host.name}` : " before booking";
  const text = `:email: *${`${lead.name} ${lead.surname}`.trim()}* (${lead.job_title}) · ${where} switched to *${email}*${booking}. _The form had ${lead.email}._`;
  await deps.slack(text).catch(() => {});
}
