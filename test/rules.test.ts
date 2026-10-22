import { describe, expect, it } from "vitest";
import { applyRules, capFirstTouch, liftLargeDistrict } from "../lib/rules";
import { SubmissionSchema, type Decision, type SfContext, type StarbridgeResult } from "../lib/types";

const sub = (over: Record<string, unknown> = {}) =>
  SubmissionSchema.parse({ name: "A", surname: "B", email: "a@b.org", job_title: "Teacher", school: "X", ...over });

describe("applyRules", () => {
  it("routes existing customers to the account owner", () => {
    const d = applyRules(sub(), { matchedBy: "account-name", account: { id: "1", name: "X", label: "CUSTOMER", ownerName: "Kim" } });
    expect(d).toMatchObject({ route: "owner", ownerName: "Kim", source: "rules" });
  });

  it("routes open US NB deals to the deal owner", () => {
    const d = applyRules(sub(), { matchedBy: "account-name", account: { id: "1", name: "X" }, openOpportunity: { id: "o", stage: "Discovery", ownerName: "Ana" } });
    expect(d).toMatchObject({ route: "owner", ownerName: "Ana" });
  });

  it("sends non-served countries and non-buyer roles to Level 0", () => {
    expect(applyRules(sub({ country: "Other" }), { matchedBy: "none" })?.level).toBe(0);
    expect(applyRules(sub({ job_title: "Parent or Homeschooler" }), { matchedBy: "none" })?.level).toBe(0);
  });

  it("leaves everyone else to Claude", () => {
    expect(applyRules(sub({ job_title: "Principal" }), { matchedBy: "none" })).toBeNull();
  });
});

describe("GM fast lane", () => {
  const hot = (over: Partial<NonNullable<StarbridgeResult["account"]>> = {}): StarbridgeResult => ({
    source: "starbridge",
    account: { score: 84, fitBand: "Moderate", signalBand: "Hot", competitors: [], enrollment: 19986, ...over },
  });
  const none: SfContext = { matchedBy: "none" };

  it("sends anyone who isn't a teacher at a hot, sizable district adopting soon to the GM", () => {
    for (const job_title of ["Curriculum Director", "Math / STEM Coordinator", "District Administrator", "Director of Early Childhood Education", "Principal", "Instructional Coach", "Math TOSA"]) {
      expect(applyRules(sub({ job_title, adoption_timeline: "SY27-28" }), none, hot()), job_title).toMatchObject({ level: 3, route: "gm", source: "rules" });
    }
  });

  it("leaves teachers to Claude, even at a hot district", () => {
    for (const job_title of ["Teacher", "Interventionist", "Other"]) {
      expect(applyRules(sub({ job_title, adoption_timeline: "SY26-27" }), none, hot()), job_title).toBeNull();
    }
  });

  it("needs all three: Hot, 5,000+ students, adopting SY26-27 or SY27-28", () => {
    const director = (adoption_timeline: string) => sub({ job_title: "Curriculum Director", adoption_timeline });
    expect(applyRules(director("SY26-27"), none, hot({ signalBand: "Warm" }))).toBeNull();
    expect(applyRules(director("SY26-27"), none, hot({ enrollment: 1200 }))).toBeNull();
    expect(applyRules(director("SY28-29 or later"), none, hot())).toBeNull();
    expect(applyRules(director("SY26-27"), none, { source: "timeout" })).toBeNull();
  });
});

describe("First Touch floor", () => {
  const firstTouch: Decision = { level: 3, route: "gm", meeting: "first_touch", reason: "Principal adopting SY27-28: First Touch.", source: "claude" };
  const sb = (over: Partial<NonNullable<StarbridgeResult["account"]>> = {}): StarbridgeResult => ({
    source: "starbridge",
    account: { score: 84, fitBand: "Moderate", signalBand: "Hot", competitors: [], enrollment: 6375, ...over },
  });
  const sf = (parr?: number): SfContext => ({ matchedBy: "email", account: { id: "1", name: "X", parr } });

  it("sends a district under $30k PARR to a BDR Discovery, with or without Starbridge", () => {
    // Braceville SD 75, IL: $8,050 PARR, booked a First Touch with Neha.
    expect(capFirstTouch(firstTouch, sf(8050), sb())).toMatchObject({ level: 2, route: "bdr", meeting: "discovery", reason: expect.stringContaining("$8,050 PARR") });
    expect(capFirstTouch(firstTouch, sf(8050), { source: "timeout" })).toMatchObject({ level: 2, route: "bdr" });
  });

  it("measures size by PARR when Salesforce has it, and by students only when it doesn't", () => {
    expect(capFirstTouch(firstTouch, sf(29999), sb())).toMatchObject({ level: 2, reason: expect.stringContaining("$29,999 PARR") });
    expect(capFirstTouch(firstTouch, sf(30000), sb({ enrollment: 301 }))).toBe(firstTouch);
    expect(capFirstTouch(firstTouch, sf(), sb({ enrollment: 301 }))).toMatchObject({ level: 2, reason: expect.stringContaining("301 students") });
    expect(capFirstTouch(firstTouch, sf(), sb({ enrollment: 650 }))).toBe(firstTouch);
  });

  it("still caps a low Starbridge score, whatever the PARR", () => {
    // Henry Hudson Regional, NJ: score 42, no enrollment from Starbridge.
    expect(capFirstTouch(firstTouch, sf(), sb({ score: 42, enrollment: undefined }))).toMatchObject({ level: 2, reason: expect.stringContaining("Starbridge score 42") });
    expect(capFirstTouch(firstTouch, sf(500000), sb({ score: 42 }))).toMatchObject({ level: 2 });
    expect(capFirstTouch(firstTouch, sf(30000), sb({ score: 50 }))).toBe(firstTouch);
  });

  it("never caps without data, and leaves other levels alone", () => {
    expect(capFirstTouch(firstTouch, { matchedBy: "none" }, { source: "timeout" })).toBe(firstTouch);
    const owner: Decision = { level: 3, route: "owner", reason: "Existing customer.", source: "rules" };
    expect(capFirstTouch(owner, sf(100), sb({ score: 10 }))).toBe(owner);
  });
});

describe("Very large district", () => {
  const sf = (parr?: number): SfContext => ({ matchedBy: "email", account: { id: "1", name: "X", parr } });
  const level1: Decision = { level: 1, route: "email", reason: "Teacher with no evaluation signal.", source: "claude" };

  it("lifts a Level 1 lead at a $500k+ district to a BDR Discovery", () => {
    // Toledo City, OH: $969,940 PARR.
    expect(liftLargeDistrict(level1, sf(969939.6))).toMatchObject({ level: 2, route: "bdr", meeting: "discovery", reason: expect.stringContaining("very large district ($969,940 PARR)") });
    expect(liftLargeDistrict(level1, sf(500000))).toMatchObject({ level: 2 });
  });

  it("leaves smaller districts, missing PARR, non-buyers and higher levels alone", () => {
    expect(liftLargeDistrict(level1, sf(499999))).toBe(level1);
    expect(liftLargeDistrict(level1, sf())).toBe(level1);
    const level0: Decision = { level: 0, route: "email", reason: "Parent.", source: "rules" };
    expect(liftLargeDistrict(level0, sf(2000000))).toBe(level0);
    const firstTouch: Decision = { level: 3, route: "gm", meeting: "first_touch", reason: "Superintendent.", source: "claude" };
    expect(liftLargeDistrict(firstTouch, sf(2000000))).toBe(firstTouch);
  });
});
