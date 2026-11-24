import { describe, expect, it } from "vitest";
import { applyLevelPolicy, applyRules, capFirstTouch } from "../lib/rules";
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

describe("District decision makers and math directors/coordinators", () => {
  const sf = (parr?: number, over: Partial<NonNullable<SfContext["account"]>> = {}): SfContext => ({ matchedBy: "email", account: { id: "1", name: "X", parr, ...over } });
  const sb = (over: Partial<NonNullable<StarbridgeResult["account"]>> = {}): StarbridgeResult => ({
    source: "starbridge",
    account: { score: 42, fitBand: "Weak", signalBand: "NoSignals", competitors: [], enrollment: 5484, ...over },
  });
  const gmRoles = ["Superintendent", "Assistant Superintendent", "Chief Academic Officer", "Curriculum Director", "Director of Teaching & Learning", "District Administrator", "Math / STEM Director", "Math Director", "Math / STEM Coordinator"];

  it("always go to the growth manager at a $30k+ district, with no WHY NOW and a low Starbridge score", () => {
    for (const job_title of gmRoles) {
      const lead = sub({ job_title, adoption_timeline: "No plans yet" });
      const d = applyRules(lead, sf(209720), sb())!;
      expect(d, job_title).toMatchObject({ level: 3, route: "gm", source: "rules", reason: expect.stringContaining("$209,720 PARR") });
      expect(capFirstTouch(d, lead, sf(209720), sb()), job_title).toBe(d);
    }
  });

  it("go to a BDR at a district under $30k PARR, even adopting soon", () => {
    for (const job_title of gmRoles) {
      expect(applyRules(sub({ job_title, adoption_timeline: "SY26-27" }), sf(8050), sb()), job_title).toMatchObject({
        level: 2, route: "bdr", reason: expect.stringContaining("small district ($8,050 PARR)"),
      });
    }
    expect(applyRules(sub({ job_title: "Curriculum Director" }), sf(29999), sb())).toMatchObject({ level: 2 });
    expect(applyRules(sub({ job_title: "Curriculum Director" }), sf(30000), sb())).toMatchObject({ level: 3 });
  });

  it("use Starbridge students only without PARR, and no size data clears the floor", () => {
    expect(applyRules(sub({ job_title: "Superintendent" }), sf(), sb({ enrollment: 649 }))).toMatchObject({ level: 2, reason: expect.stringContaining("649 students") });
    expect(applyRules(sub({ job_title: "Superintendent" }), sf(), sb({ enrollment: 650 }))).toMatchObject({ level: 3 });
    expect(applyRules(sub({ job_title: "Superintendent" }), { matchedBy: "none" }, { source: "timeout" })).toMatchObject({
      level: 3, route: "gm", reason: "Superintendent: always a First Touch with the growth manager.",
    });
  });

  it("leave principals, coaches, teachers and other champions to Claude; owners and non-served countries win", () => {
    for (const job_title of ["Principal", "Instructional Coach", "Teacher", "Director of Early Childhood Education", "Other"]) {
      expect(applyRules(sub({ job_title }), sf(209720), sb()), job_title).toBeNull();
    }
    expect(applyRules(sub({ job_title: "Curriculum Director" }), sf(209720, { label: "CUSTOMER", ownerName: "Kim" }), sb())).toMatchObject({ route: "owner", ownerName: "Kim" });
    expect(applyRules(sub({ job_title: "Curriculum Director", country: "Other" }), sf(209720), sb())?.level).toBe(0);
  });
});

describe("GM fast lane", () => {
  const hot: StarbridgeResult = { source: "starbridge", account: { score: 84, fitBand: "Moderate", signalBand: "Hot", competitors: [], enrollment: 19986 } };
  const none: SfContext = { matchedBy: "none" };

  it("only takes champions outside the growth-manager roles", () => {
    expect(applyRules(sub({ job_title: "Director of Early Childhood Education", adoption_timeline: "SY27-28" }), none, hot)).toMatchObject({ level: 3, route: "gm" });
    for (const job_title of ["Principal", "Vice Principal", "Instructional Coach", "Math TOSA", "Teacher"]) {
      expect(applyRules(sub({ job_title, adoption_timeline: "SY27-28" }), none, hot), job_title).toBeNull();
    }
  });
});

describe("First Touch floor", () => {
  const principal = sub({ job_title: "Principal" });
  const firstTouch: Decision = { level: 3, route: "gm", meeting: "first_touch", reason: "Principal adopting SY27-28: First Touch.", source: "claude" };
  const sb = (over: Partial<NonNullable<StarbridgeResult["account"]>> = {}): StarbridgeResult => ({
    source: "starbridge",
    account: { score: 84, fitBand: "Moderate", signalBand: "Hot", competitors: [], enrollment: 6375, ...over },
  });
  const sf = (parr?: number): SfContext => ({ matchedBy: "email", account: { id: "1", name: "X", parr } });

  it("sends a district under $30k PARR to a BDR Discovery, with or without Starbridge", () => {
    // Braceville SD 75, IL: $8,050 PARR, booked a First Touch with Neha.
    expect(capFirstTouch(firstTouch, principal, sf(8050), sb())).toMatchObject({ level: 2, route: "bdr", meeting: "discovery", reason: expect.stringContaining("$8,050 PARR") });
    expect(capFirstTouch(firstTouch, principal, sf(8050), { source: "timeout" })).toMatchObject({ level: 2, route: "bdr" });
  });

  it("measures size by PARR when Salesforce has it, and by students only when it doesn't", () => {
    expect(capFirstTouch(firstTouch, principal, sf(29999), sb())).toMatchObject({ level: 2, reason: expect.stringContaining("$29,999 PARR") });
    expect(capFirstTouch(firstTouch, principal, sf(30000), sb({ enrollment: 301 }))).toBe(firstTouch);
    expect(capFirstTouch(firstTouch, principal, sf(), sb({ enrollment: 301 }))).toMatchObject({ level: 2, reason: expect.stringContaining("301 students") });
    expect(capFirstTouch(firstTouch, principal, sf(), sb({ enrollment: 650 }))).toBe(firstTouch);
  });

  it("still caps a low Starbridge score, whatever the PARR", () => {
    // Henry Hudson Regional, NJ: score 42, no enrollment from Starbridge.
    expect(capFirstTouch(firstTouch, principal, sf(), sb({ score: 42, enrollment: undefined }))).toMatchObject({ level: 2, reason: expect.stringContaining("Starbridge score 42") });
    expect(capFirstTouch(firstTouch, principal, sf(500000), sb({ score: 42 }))).toMatchObject({ level: 2 });
    expect(capFirstTouch(firstTouch, principal, sf(30000), sb({ score: 50 }))).toBe(firstTouch);
  });

  it("never caps without data, and leaves other levels alone", () => {
    expect(capFirstTouch(firstTouch, principal, { matchedBy: "none" }, { source: "timeout" })).toBe(firstTouch);
    const owner: Decision = { level: 3, route: "owner", reason: "Existing customer.", source: "rules" };
    expect(capFirstTouch(owner, principal, sf(100), sb({ score: 10 }))).toBe(owner);
  });
});

describe("Level policy after scoring", () => {
  const sf = (parr?: number): SfContext => ({ matchedBy: "email", account: { id: "1", name: "X", parr } });
  const sb = (signalBand = "NoSignals"): StarbridgeResult => ({ source: "starbridge", account: { score: 80, fitBand: "Strong", signalBand, competitors: [] } });
  const at = (level: 0 | 1 | 2 | 3, source: Decision["source"] = "claude"): Decision => ({
    level, route: level === 3 ? "gm" : level === 2 ? "bdr" : "email", meeting: level === 3 ? "first_touch" : level === 2 ? "discovery" : undefined, reason: "Scored.", source,
  });

  it("gives a teacher a Discovery only with a review signal at a district under $150k PARR", () => {
    const soon = sub({ adoption_timeline: "SY26-27" });
    expect(applyLevelPolicy(at(1), soon, sf(80000), sb())).toMatchObject({ level: 2, route: "bdr", meeting: "discovery", reason: expect.stringContaining("adopting SY26-27") });
    expect(applyLevelPolicy(at(1), sub({ needs: "I'm on our math curriculum committee" }), sf(80000), sb())).toMatchObject({ level: 2, reason: expect.stringContaining("message") });
    expect(applyLevelPolicy(at(1), sub(), sf(80000), sb("Hot"))).toMatchObject({ level: 2, reason: expect.stringContaining("hot district") });
    expect(applyLevelPolicy(at(1), soon, sf(), sb())).toMatchObject({ level: 2 }); // no PARR passes
    expect(applyLevelPolicy(at(2), soon, sf(149999), sb()).level).toBe(2);
    expect(applyLevelPolicy(at(1), sub({ adoption_timeline: "SY28-29 or later" }), sf(80000), sb())).toMatchObject({ level: 2, reason: expect.stringContaining("SY28-29") });
    for (const adoption_timeline of ["No plans yet", "Already adopted", "I'm not sure"]) {
      expect(applyLevelPolicy(at(2), sub({ adoption_timeline }), sf(80000), sb()).level, adoption_timeline).toBe(1);
    }
  });

  it("keeps teachers at big districts, or with no signal, at Level 1, whatever Claude or the fallback said", () => {
    const soon = sub({ adoption_timeline: "SY27-28" });
    expect(applyLevelPolicy(at(2), soon, sf(150000), sb())).toMatchObject({ level: 1, route: "email", meeting: undefined, reason: expect.stringContaining("$150,000 PARR") });
    expect(applyLevelPolicy(at(3), soon, sf(969940), sb("Hot"))).toMatchObject({ level: 1 });
    // A Warm district or a high score is no longer enough on its own.
    expect(applyLevelPolicy(at(2), sub(), sf(50000), sb("Warm"))).toMatchObject({ level: 1, reason: expect.stringContaining("no curriculum-review signal") });
    expect(applyLevelPolicy(at(2, "fallback"), sub(), sf(50000), sb())).toMatchObject({ level: 1 });
  });

  it("always gives coaches and TOSAs a Discovery, never a First Touch", () => {
    for (const job_title of ["Instructional Coach", "Math TOSA"]) {
      expect(applyLevelPolicy(at(3), sub({ job_title }), sf(900000), sb("Hot")), job_title).toMatchObject({ level: 2, route: "bdr" });
      expect(applyLevelPolicy(at(1), sub({ job_title }), sf(), sb()), job_title).toMatchObject({ level: 2, route: "bdr" });
    }
  });

  it("gives building leaders at least a Discovery; only a principal can keep a First Touch", () => {
    expect(applyLevelPolicy(at(1), sub({ job_title: "Principal" }), sf(), sb())).toMatchObject({ level: 2 });
    const ft = at(3);
    expect(applyLevelPolicy(ft, sub({ job_title: "Principal" }), sf(), sb())).toBe(ft);
    expect(applyLevelPolicy(ft, sub({ job_title: "Vice Principal" }), sf(), sb())).toMatchObject({ level: 2 });
  });

  it("leaves Level 0, existing owners and other roles alone", () => {
    const zero = at(0);
    expect(applyLevelPolicy(zero, sub({ adoption_timeline: "SY26-27" }), sf(1000), sb("Hot"))).toBe(zero);
    const owner: Decision = { level: 3, route: "owner", reason: "Existing customer.", source: "rules" };
    expect(applyLevelPolicy(owner, sub(), sf(), sb())).toBe(owner);
    const champ = at(3);
    expect(applyLevelPolicy(champ, sub({ job_title: "Director of Early Childhood Education" }), sf(), sb())).toBe(champ);
  });
});

describe("Enterprise override", () => {
  const sf = (parr?: number): SfContext => ({ matchedBy: "email", account: { id: "1", name: "X", parr } });
  const sb = (enrollment?: number): StarbridgeResult => ({ source: "starbridge", account: { score: 60, fitBand: "Strong", signalBand: "NoSignals", competitors: [], enrollment } });
  const l1: Decision = { level: 1, route: "email", reason: "Scored.", source: "claude" };

  it("sends a teacher or coach at an 8,000+ student district adopting soon to Prynce, whatever the PARR", () => {
    for (const [job_title, adoption_timeline] of [["Teacher", "SY26-27"], ["Instructional Coach", "SY27-28"], ["Math TOSA", "SY28-29 or later"]]) {
      const d = applyLevelPolicy(l1, sub({ job_title, adoption_timeline }), sf(900000), sb(8000));
      expect(d, job_title).toMatchObject({ level: 3, route: "gm", meeting: "first_touch", hostName: "Prynce Karki", reason: expect.stringContaining("Enterprise override: large district (8,000 students)") });
      expect(capFirstTouch(d, sub({ job_title }), sf(900000), { source: "starbridge", account: { score: 10, fitBand: "Weak", signalBand: "NoSignals", competitors: [], enrollment: 8000 } }), job_title).toBe(d);
    }
  });

  it("needs a large district and an adoption date, and only covers teachers and coaches", () => {
    expect(applyLevelPolicy(l1, sub({ adoption_timeline: "SY26-27" }), sf(), sb(7999)).hostName).toBeUndefined();
    expect(applyLevelPolicy(l1, sub({ adoption_timeline: "SY26-27" }), sf(), sb()).hostName).toBeUndefined();
    expect(applyLevelPolicy(l1, sub({ adoption_timeline: "No plans yet" }), sf(), sb(20000)).hostName).toBeUndefined();
    const ft: Decision = { level: 3, route: "gm", reason: "Scored.", source: "claude" };
    expect(applyLevelPolicy(ft, sub({ job_title: "Principal", adoption_timeline: "SY26-27" }), sf(), sb(20000))).toBe(ft);
    const zero: Decision = { level: 0, route: "email", reason: "Student.", source: "claude" };
    expect(applyLevelPolicy(zero, sub({ adoption_timeline: "SY26-27" }), sf(), sb(20000))).toBe(zero);
  });
});
