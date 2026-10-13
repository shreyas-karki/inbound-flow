import { describe, expect, it } from "vitest";
import { applyRules } from "../lib/rules";
import { SubmissionSchema, type SfContext, type StarbridgeResult } from "../lib/types";

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
