// POST /api/phone: the number a Level 2 or 3 lead enters before the calendar unlocks, for confirmation calls and
// coordinating deliveries. The form's phone is often the district office, so a number that matches the school's or
// district's main line in Salesforce is not saved. Any other number goes to Slack, and to Salesforce through Make
// when MAKE_PHONE_WEBHOOK_URL is set. Make already writes the form's phone, so this is the number to call.
import { config } from "./config";
import { decisionKey, defaultStore, type Store } from "./decisions";
import type { Decided } from "./router";
import { postToSlack } from "./slack";
import { fromUnbounce } from "./unbounce";
import { SubmissionSchema } from "./types";

export interface PhoneDeps {
  slack: (text: string) => Promise<void>;
  /** Make's webhook for the Salesforce write; skipped when unset. */
  salesforce?: (payload: Record<string, unknown>) => Promise<void>;
  store: Store;
}

export function defaultPhoneDeps(): PhoneDeps {
  const url = config.phoneWebhookUrl;
  return {
    slack: postToSlack,
    store: defaultStore(),
    salesforce: url
      ? async (payload) => {
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
          if (!res.ok) throw new Error(`Make webhook failed: ${res.status}`);
        }
      : undefined,
  };
}

const digits = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
};

/** 10 US digits as (555) 555-0123, or undefined. A leading 1 is dropped. */
export function usPhone(raw: string): string | undefined {
  const d = digits(raw);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : undefined;
}

type Outcome = "saved" | "district_line";

/**
 * Body: { phone_number, level, lead } where lead is the form as the page has it (our field names or Unbounce's).
 * The lead's cached decision supplies the district's main lines, the host and the Salesforce Contact.
 */
export async function handlePhone(raw: unknown, deps: PhoneDeps = defaultPhoneDeps()) {
  const body = (raw && typeof raw === "object" ? raw : {}) as { phone_number?: unknown; level?: unknown; lead?: unknown };
  const phone = typeof body.phone_number === "string" ? usPhone(body.phone_number) : undefined;
  const parsed = SubmissionSchema.safeParse(fromUnbounce(body.lead));
  if (!phone || !parsed.success) return { status: 400, body: { ok: false, error: "Send the lead and a 10-digit US phone number." } };
  const sub = parsed.data;

  let decided: Decided | undefined;
  try {
    const hit = await deps.store.get(decisionKey(sub));
    if (hit) decided = JSON.parse(hit) as Decided;
  } catch { /* no cached decision: nothing to compare against, so the number counts as theirs */ }
  const level = decided?.decision.level ?? (Number(body.level) || undefined);
  const account = decided?.sf.account;

  const districtLine = account?.phones?.some((p) => digits(p) === digits(phone)) ?? false;
  const outcome: Outcome = districtLine ? "district_line" : "saved";
  const results: Record<string, string> = {};

  if (!districtLine) {
    const who = [`*${`${sub.name} ${sub.surname}`.trim()}*`, `(${sub.job_title})`].join(" ");
    const where = [account?.parentName ?? account?.name ?? sub.school, sub.email].join(" · ");
    const call = [level && `Level ${level}`, decided?.host.name && `booking with ${decided.host.name}`].filter(Boolean).join(", ");
    const text = `:telephone_receiver: ${who} · ${where}\nNumber for confirmation calls and deliveries${call ? ` (${call})` : ""}: *+1 ${phone}*`;
    const formPhone = usPhone(sub.phone_number);
    const note = formPhone && formPhone !== phone ? `\n_The form had +1 ${formPhone}._` : "";
    results.slack = await deps.slack(text + note).then(() => "posted", (e) => `failed: ${e instanceof Error ? e.message : e}`);
    if (deps.salesforce) {
      const payload = { email: sub.email, phone: `+1 ${phone}`, contact_id: decided?.sf.contact?.id ?? null, account_id: account?.id ?? null, level: level ?? null };
      results.salesforce = await deps.salesforce(payload).then(() => "sent to Make", (e) => `failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "phone", email: sub.email, phone, level, outcome, ...results }));
  return { status: 200, body: { ok: true, phone, outcome } };
}
