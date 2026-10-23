import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { memoryStore } from "../lib/decisions";
import { saveHandoff, toSfContext, waitForHandoff } from "../lib/handoff";
import { handleSubmission, type Deps } from "../lib/router";
import { createSalesforce } from "../lib/salesforce";
import { mockScorer } from "../lib/score";
import { mockDrafter } from "../lib/sdr";
import { lookupAccountScore } from "../lib/starbridge";
import { handleTier } from "../lib/tier";
import { IDS, TABLES } from "./fixtures/routing";

const SECRET = "test-secret";
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", `unbounce-${name}.json`), "utf8"));

function deps(over: Partial<Deps> = {}) {
  const calls = { lookup: 0 };
  const salesforce = createSalesforce();
  const d: Deps = {
    salesforce: { lookup: async (s) => { calls.lookup++; return salesforce.lookup(s); }, upsertContact: (...a) => salesforce.upsertContact(...a) },
    starbridge: lookupAccountScore, scorer: mockScorer, drafter: mockDrafter, slack: async () => {},
    routing: async () => TABLES, store: memoryStore(), actionsOwner: "make",
    ...over,
  };
  return { d, calls };
}

// What Make's CreateJSON module sends: flat strings, empty where it found nothing.
const AKRON = {
  matched_by: "account-name", contact_id: "",
  account_id: "0017Q00000me60PQAQ", account_name: "Akron Early College High School (Akron, OH)", account_label: "",
  account_owner_id: IDS.eric, account_owner_name: "Eric Fontana",
  parent_id: "0017Q00000mdqOXQAY", parent_name: "[School District] Akron City (Akron, OH)", account_parr: "0", parent_parr: "944283.9",
  owner_id: IDS.eric, owner_name: "Eric Fontana", owner_why: "Open deal in Follow-up", opp_id: "006QD00000wpyFGYAY", opp_stage: "Follow-up",
};
const NOTHING = { matched_by: "none", contact_id: "", account_id: "", owner_id: "", owner_name: "", account_parr: "" };

describe("Make's Salesforce handoff", () => {
  vi.spyOn(console, "log").mockImplementation(() => {});

  it("turns Make's flat strings into the app's Salesforce context, with the district's PARR for a school", () => {
    expect(toSfContext(AKRON)).toMatchObject({
      matchedBy: "account-name", source: "make",
      account: { id: "0017Q00000me60PQAQ", ownerName: "Eric Fontana", parentName: "[School District] Akron City (Akron, OH)", parr: 944283.9, label: null },
      existingOwner: { id: IDS.eric, name: "Eric Fontana", why: "Open deal in Follow-up", oppId: "006QD00000wpyFGYAY" },
    });
    const none = toSfContext(NOTHING);
    expect(none).toEqual({ matchedBy: "none", source: "make" });
    expect(toSfContext("not an object")).toEqual({ matchedBy: "none", source: "make" });
  });

  it("/api/tier with an owner from Make → Level 3 owner route, the owner as host, no calendar", async () => {
    const { d, calls } = deps();
    const out = await handleTier(SECRET, { ...fixture("level2"), salesforce: AKRON }, d, SECRET);
    expect(out.body).toMatchObject({
      level: 3, route: "owner", host_name: "Eric Fontana", host_user_id: IDS.eric, booking_url: null,
      sf_source: "make", sf_account_id: "0017Q00000me60PQAQ", open_opp_id: "006QD00000wpyFGYAY",
    });
    expect(out.body.reason).toBe("Open deal in Follow-up. Routed to Eric Fontana.");
    expect(out.body.slack_header).toContain("Existing account");
    expect(calls.lookup).toBe(0); // the app's own (SSO-blocked) lookup never runs
  });

  it("accepts the handoff as a JSON string too, the way Make's CreateJSON output can arrive", async () => {
    const out = await handleTier(SECRET, { ...fixture("level2"), salesforce: JSON.stringify(AKRON) }, deps().d, SECRET);
    expect(out.body).toMatchObject({ route: "owner", host_name: "Eric Fontana" });
  });

  it("the page waits for Make's handoff, so the lead sees 'Eric will reach out' instead of a BDR calendar", async () => {
    const { d, calls } = deps({ handoffWaitMs: 3000 });
    const sub = { name: "Dana", surname: "W", email: "dana@apslearns.org", country: "United States of America", job_title: "Teacher", school: "Akron Early College High School - Akron, Summit", state: "Ohio", adoption_timeline: "No plans yet" };
    setTimeout(() => void saveHandoff(d.store, sub.email, toSfContext(AKRON)), 300);
    const out = await handleSubmission(sub, d);
    await out.background;
    expect(out.body).toMatchObject({ level: 3, route: "owner", next: { type: "thanks", host: "Eric Fontana" } });
    expect(out.body.next?.message).toBe("Thanks! Eric Fontana will reach out to you shortly.");
    expect(calls.lookup).toBe(0);
  });

  it("Make finding nothing still counts: the page stops waiting and doesn't fall back to the app's lookup", async () => {
    const { d, calls } = deps({ handoffWaitMs: 3000 });
    await saveHandoff(d.store, "casey.teacher@example.org", toSfContext(NOTHING));
    const started = Date.now();
    const out = await handleTier(SECRET, fixture("level2"), d, SECRET);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(out.body).toMatchObject({ level: 2, route: "bdr", sf_source: "make", sf_match: "none" });
    expect(calls.lookup).toBe(0);
  });

  it("no handoff within the wait → the app's own lookup, as before", async () => {
    const { d, calls } = deps({ handoffWaitMs: 200 });
    const out = await handleTier(SECRET, fixture("level2"), d, SECRET);
    expect(out.body).toMatchObject({ level: 2, route: "bdr", host_name: "Luis Acevedo", sf_source: "app" });
    expect(calls.lookup).toBe(1);
  });

  it("waitForHandoff gives up after the wait, and is keyed on the email regardless of case", async () => {
    const store = memoryStore();
    expect(await waitForHandoff(store, "a@b.org", { waitMs: 100, pollMs: 20 })).toBeUndefined();
    await saveHandoff(store, "A@B.org", toSfContext(AKRON));
    expect((await waitForHandoff(store, " a@b.org "))?.existingOwner?.name).toBe("Eric Fontana");
  });
});
