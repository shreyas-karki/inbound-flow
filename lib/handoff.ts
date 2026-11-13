// Make reads Salesforce for us (the app's own login is blocked by SSO) and hands what it found to /api/tier.
// The lead's browser asks /api/submit at the same moment, so the handoff is parked in the shared store and
// decide() waits a few seconds for it before scoring. That way the page and Slack agree on an existing owner.
import type { Store } from "./decisions";
import { districtParr } from "./salesforce";
import type { SfContext } from "./types";

/** What Make sends as `salesforce` on /api/tier: flat, every value a string (empty when Make found nothing). */
export interface MakeSalesforce {
  matched_by?: string;
  contact_id?: string;
  account_id?: string;
  account_name?: string;
  account_label?: string;
  account_owner_id?: string;
  account_owner_name?: string;
  parent_id?: string;
  parent_name?: string;
  account_parr?: string | number;
  parent_parr?: string | number;
  // The owner Make's own check picked: the deal owner for an open deal, the account owner for a customer.
  owner_id?: string;
  owner_name?: string;
  owner_why?: string;
  opp_id?: string;
  opp_stage?: string;
}

export const HANDOFF_TTL_SEC = 10 * 60;

export function handoffKey(email: string): string {
  return `sf|${email.trim().toLowerCase()}`;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export function toSfContext(raw: unknown): SfContext {
  const m = (raw && typeof raw === "object" ? raw : {}) as MakeSalesforce;
  const by = text(m.matched_by);
  const ctx: SfContext = { matchedBy: by === "email" || by === "account-name" ? by : "none", source: "make" };
  const contactId = text(m.contact_id);
  if (contactId) ctx.contact = { id: contactId };

  const accountId = text(m.account_id);
  if (accountId) {
    const name = text(m.account_name) ?? "";
    const parentName = text(m.parent_name);
    ctx.account = {
      id: accountId, name, label: text(m.account_label) ?? null, ownerId: text(m.account_owner_id), ownerName: text(m.account_owner_name),
      parentId: text(m.parent_id) ?? null, parentName: parentName ?? null,
      parr: districtParr({ Name: name, Total_PARR__c: num(m.account_parr), Parent: parentName ? { Name: parentName, Total_PARR__c: num(m.parent_parr) } : null }),
    };
  }

  const ownerName = text(m.owner_name);
  const ownerId = text(m.owner_id);
  if (ownerName || ownerId) {
    ctx.existingOwner = { id: ownerId, name: ownerName, why: text(m.owner_why) ?? "Existing account", oppId: text(m.opp_id), stage: text(m.opp_stage) };
  }
  return ctx;
}

export async function saveHandoff(store: Store, email: string, sf: SfContext): Promise<void> {
  try { await store.set(handoffKey(email), JSON.stringify(sf), HANDOFF_TTL_SEC); } catch { /* the page just won't see it */ }
}

/** Make's Salesforce context for this lead, waiting up to waitMs for it to arrive. Undefined if it never does. */
export async function waitForHandoff(store: Store, email: string, { waitMs = 0, pollMs = 250 } = {}): Promise<SfContext | undefined> {
  const read = async () => {
    try {
      const hit = await store.get(handoffKey(email));
      return hit ? (JSON.parse(hit) as SfContext) : undefined;
    } catch {
      return undefined;
    }
  };
  for (const deadline = Date.now() + waitMs; ; ) {
    const sf = await read();
    if (sf || Date.now() >= deadline) return sf;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
