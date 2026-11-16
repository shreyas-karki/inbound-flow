// POST /api/verify: a Level 2 or 3 lead gives a school or district email before the calendar unlocks.
// BDRs and growth managers kept getting bookings from Gmail and AOL addresses they couldn't tie to a district.
// Body: { email, lead, grades }. Personal addresses are refused; anything else unlocks the calendar. No code is sent.
// Grades are the ranges the lead works in; 9+ alone means high school only, which Thinking Math! (Pre-K to 8) doesn't
// cover, so there's no call to book.
// When the email differs from the form's, Make saves it on the Contact as Email 2: David's booking sync
// matches the calendar invite to a Contact by Email or Email 2, and without it the meeting lands with no Contact.
//
// The school email is also checked for an existing owner. Routing ran on the form's email and typed school name,
// which miss a customer or open deal when the lead used Gmail/AOL and typed the district differently (a Bakersfield
// pilot teacher reached a BDR calendar on Nov 16 2026 that way). When Make finds an owner for the school email,
// the calendar stays hidden and the page says the owner will reach out, as it does for owners found at routing.
import { config } from "./config";
import { decisionKey, defaultStore, type Store } from "./decisions";
import { isEmail, isPersonalEmail, normalizeEmail } from "./email";
import { waitForHandoff } from "./handoff";
import type { Decided } from "./router";
import { postToSlack } from "./slack";
import { SubmissionSchema, type SfContext, type Submission } from "./types";
import { fromUnbounce } from "./unbounce";

export interface EmailSwitch {
  form_email: string;
  school_email: string;
  name: string;
  job_title: string;
  school: string;
}

export interface OwnerCheck extends EmailSwitch {
  switched: boolean;
}

/** Who already owns the account behind the school email, per Make. */
export interface OwnerHit {
  name: string;
  why?: string;
  account?: string;
  matchedBy?: string;
}

export interface VerifyDeps {
  store: Store;
  slack: (text: string) => Promise<void>;
  saveSwitch: (sw: EmailSwitch) => Promise<void>;
  checkOwner: (check: OwnerCheck) => Promise<OwnerHit | undefined>;
}

export function defaultVerifyDeps(): VerifyDeps {
  return { store: defaultStore(), slack: postToSlack, saveSwitch: postSwitchToMake, checkOwner: checkOwnerWithMake };
}

async function postSwitchToMake(sw: EmailSwitch) {
  if (!config.make.emailSwitchUrl) return;
  const res = await fetch(config.make.emailSwitchUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sw),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Make answers with flat strings, empty when there's no owner. Make also DMs the owner and reassigns the Contact. */
async function checkOwnerWithMake(check: OwnerCheck): Promise<OwnerHit | undefined> {
  if (!config.make.ownerCheckUrl) return undefined;
  const res = await fetch(config.make.ownerCheckUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(check),
    signal: AbortSignal.timeout(config.make.ownerCheckTimeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return toOwnerHit(await res.json().catch(() => ({})));
}

export function toOwnerHit(raw: unknown): OwnerHit | undefined {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const name = text(m.owner_name);
  if (!name || !text(m.owner_id)) return undefined;
  return { name, why: text(m.owner_why), account: text(m.account_name), matchedBy: text(m.matched_by) };
}

/** The booking page's grade ranges. Thinking Math! is Pre-K to 8, so a lead who only works in 9+ can't book. */
export const GRADE_RANGES = ["Pre-K-5", "6-8", "9+"];

/** The known ranges the page sent, or undefined when it sent none (an older page): those leads aren't blocked. */
export function parseGrades(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const grades = raw.filter((g): g is string => typeof g === "string" && GRADE_RANGES.includes(g));
  return grades.length ? grades : undefined;
}

export function highSchoolOnly(grades?: string[]): boolean {
  return Boolean(grades?.length && grades.every((g) => g === "9+"));
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
  const grades = parseGrades(body.grades);
  const decided = lead ? await cachedDecision(deps, lead) : undefined;

  // High school only: no calendar, no owner check. Slack hears so the BDR isn't left waiting for a booking.
  if (highSchoolOnly(grades)) {
    if (lead) await noteHighSchool(deps, lead, email, decided);
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "verify", email, form_email: lead?.email, grades, high_school: true }));
    return { status: 200, body: { ok: false, reason: "high_school" } };
  }

  if (!lead) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "verify", email, switched: false, owner_check: "no_lead" }));
    return { status: 200, body: { ok: true, email } };
  }

  const switched = normalizeEmail(lead.email) !== email;
  const who: EmailSwitch = { form_email: normalizeEmail(lead.email), school_email: email, name: `${lead.name} ${lead.surname}`.trim(), job_title: lead.job_title, school: lead.school };
  // An owner routing already knows about (Make found it after the page had decided) needs no second lookup:
  // Make has already DMed them and given them the Contact.
  const routed = await routedOwner(deps, lead, decided);
  let checkError: string | undefined;
  const [owner] = await Promise.all([
    routed ?? deps.checkOwner({ ...who, switched }).catch((e) => { checkError = String(e); return undefined; }),
    switched ? deps.saveSwitch(who).catch((e) => console.log(JSON.stringify({ event: "verify_switch_to_make_failed", error: String(e) }))) : undefined,
  ]);
  if (owner || switched) await noteSwitch(deps, lead, email, switched, decided, owner, grades);

  console.log(JSON.stringify({
    ts: new Date().toISOString(), event: "verify", email, form_email: lead.email, switched, grades,
    owner: owner?.name, owner_why: owner?.why, owner_account: owner?.account, owner_matched_by: owner?.matchedBy, owner_check_error: checkError,
  }));
  if (owner) return { status: 200, body: { ok: true, email, owner: owner.name, message: `Thanks! ${owner.name} will reach out to you shortly.` } };
  return { status: 200, body: { ok: true, email } };
}

/** The routing decision cached for this lead, for the district and host in Slack notes. */
async function cachedDecision(deps: VerifyDeps, lead: Submission): Promise<Decided | undefined> {
  try {
    const hit = await deps.store.get(decisionKey(lead));
    return hit ? (JSON.parse(hit) as Decided) : undefined;
  } catch {
    return undefined; // the note goes out without the district and host
  }
}

const personOf = (lead: Submission) => `*${`${lead.name} ${lead.surname}`.trim()}* (${lead.job_title})`;
const districtOf = (lead: Submission, decided?: Decided) => decided?.sf.account?.parentName ?? decided?.sf.account?.name ?? lead.school;

/** An owner routing found: the cached decision routes to them, or Make's Salesforce handoff for this lead names one. */
async function routedOwner(deps: VerifyDeps, lead: Submission, decided?: Decided): Promise<OwnerHit | undefined> {
  const district = (sf?: SfContext) => sf?.account?.parentName ?? sf?.account?.name ?? undefined;
  if (decided?.decision.route === "owner" && decided.host.name) {
    return { name: decided.host.name, why: decided.sf.existingOwner?.why, account: district(decided.sf), matchedBy: "routing" };
  }
  const sf = await waitForHandoff(deps.store, lead.email);
  const name = sf?.existingOwner?.name;
  return name ? { name, why: sf.existingOwner?.why, account: district(sf), matchedBy: "routing" } : undefined;
}

/** The BDR sees the form's email in Slack: say when the lead books with a different one, or turns out to be owned. */
async function noteSwitch(deps: VerifyDeps, lead: Submission, email: string, switched: boolean, decided?: Decided, owner?: OwnerHit, grades?: string[]) {
  const formHad = switched ? ` _The form had ${lead.email}._` : "";
  const gradesNote = grades ? ` Grades: ${grades.join(", ")}.` : "";
  let text: string;
  if (owner) {
    const where = owner.account ?? districtOf(lead, decided);
    const why = owner.why ? ` (${owner.why})` : "";
    const instead = decided?.host.name ? `, instead of booking with ${decided.host.name}` : "";
    text = `:lock: ${personOf(lead)} · ${where} verified *${email}*, an account owned by *${owner.name}*${why}. The calendar was hidden${instead}; ${owner.name} owns the follow-up. BDRs, don't contact.${gradesNote}${formHad}`;
  } else {
    const booking = decided?.host.name ? ` before booking with ${decided.host.name}` : " before booking";
    text = `:email: ${personOf(lead)} · ${districtOf(lead, decided)} switched to *${email}*${booking}.${gradesNote}${formHad}`;
  }
  await deps.slack(text).catch(() => {});
}

/** High school only: the page said Thinking Math! is Pre-K to 8 and showed no calendar. */
async function noteHighSchool(deps: VerifyDeps, lead: Submission, email: string, decided?: Decided) {
  const host = decided?.host.name ? ` with ${decided.host.name}` : "";
  const text = `:no_entry: ${personOf(lead)} · ${districtOf(lead, decided)} only works in grades 9+ (${email}). The page said Thinking Math! is Pre-K to 8 and showed no calendar, so no call${host} will be booked.`;
  await deps.slack(text).catch(() => {});
}
