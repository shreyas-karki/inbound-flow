import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { decisionKey, memoryStore } from "../lib/decisions";
import { saveHandoff, toSfContext, waitForHandoff } from "../lib/handoff";
import { handleSubmission, parseSubmission, type Deps } from "../lib/router";
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
    expect(out.body.slack_header).not.toMatch(/Level \d/); // a hand-off to the owner isn't a score
    expect(calls.lookup).toBe(0); // the app's own (SSO-blocked) lookup never runs
  });

  it("a Curriculum Director at a $30k+ district from Make's handoff gets the GM's calendar, WHY NOW or not", async () => {
    // Kearny, NJ (Nov 2): adopting SY28-29, no message, $209,720 PARR. Was shown Luis's Discovery calendar.
    const lead = fixture("level2");
    Object.assign(lead.data, {
      user_profile: ["Curriculum Director"], school: ["Kearny"], message: [""],
      when_is_your_district_planning_to_adopt_a_new_math_curriculum: ["SY28-29 or later"],
    });
    const kearny = { matched_by: "email", contact_id: "003QD000015LGoEYAW", account_id: "001KEARNY", account_name: "[School District] Kearny (Kearny, NJ)", account_parr: "209720", parent_parr: "", owner_id: "", owner_name: "" };
    const out = await handleTier(SECRET, { ...lead, salesforce: kearny }, deps().d, SECRET);
    expect(out.body).toMatchObject({ level: 3, route: "gm", meeting: "first_touch", source: "rules", host_name: "Eric Fontana" });
    expect(out.body.booking_url).toContain("AcZEric");
    expect(out.body.reason).toContain("$209,720 PARR");
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

  it("an owner from Make wins over an answer the page already cached without it", async () => {
    // Udelia Gonzalez, Bakersfield City (Nov 15): the page decided before Make's handoff arrived, so Make got
    // "Discovery, Vania's calendar" back while it DMed the account owner.
    const { d } = deps({ handoffWaitMs: 100 });
    expect((await handleTier(SECRET, fixture("level2"), d, SECRET)).body).toMatchObject({ route: "bdr" }); // decided without Make
    const out = await handleTier(SECRET, { ...fixture("level2"), salesforce: AKRON }, d, SECRET);
    expect(out.body).toMatchObject({ level: 3, route: "owner", host_name: "Eric Fontana", booking_url: null });
    const sub = parseSubmission(fixture("level2").data);
    if (!sub.success) throw new Error("fixture");
    const cached = JSON.parse((await d.store.get(decisionKey(sub.data)))!);
    expect(cached.decision.route).toBe("owner"); // what /api/verify and a reload now see
  });

  it("Make's district arriving after the page decided is used: a teacher at a large district loses the Discovery the page gave", async () => {
    // Internal test, Cicero SD 99 (Nov 18): the page waited 8 s, scored with no district and showed Level 1;
    // Make's handoff with $604k PARR landed under a second later and got the cached answer back. Here the teacher is
    // adopting soon: with no PARR the page gives a Discovery, and Make's $604k PARR (over $150k) takes it away.
    const { d, calls } = deps({ handoffWaitMs: 50, scorer: async () => ({ level: 2, route: "bdr", reason: "Teacher adopting soon.", source: "claude" }) });
    const lead = { ...fixture("level2"), data: { ...fixture("level2").data, school: ["Cicero SD 99 - Cicero, Cook County"], state: [""], message: [""], when_is_your_district_planning_to_adopt_a_new_math_curriculum: ["SY27-28"] } };
    const page = await handleSubmission({ ...lead.data, page_url: lead.page_url }, { ...d, salesforce: { ...d.salesforce, lookup: async () => { throw new Error("SSO"); } } });
    await page.background;
    expect(page.body).toMatchObject({ level: 2 });
    const CICERO = { ...NOTHING, matched_by: "account-name", account_id: "0017Q00000mdpF0QAI", account_name: "[School District] Cicero SD 99 (Cicero, IL)", account_parr: "604162" };
    const out = await handleTier(SECRET, { ...lead, salesforce: CICERO }, d, SECRET);
    expect(out.body).toMatchObject({ level: 1, route: "email", cached: false, sf_source: "make", state: "Illinois" });
    expect(out.body.reason).toContain("The lead's page showed Level 2");
    expect(calls.lookup).toBe(0);
    // Asked again (a Make retry), the answer is the stored one and isn't rescored.
    expect((await handleTier(SECRET, { ...lead, salesforce: CICERO }, d, SECRET)).body).toMatchObject({ level: 1, cached: true });
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
