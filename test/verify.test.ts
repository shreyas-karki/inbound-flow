import { describe, expect, it, vi } from "vitest";
import { decisionKey, memoryStore } from "../lib/decisions";
import { isPersonalEmail } from "../lib/email";
import { emailDomain } from "../lib/salesforce";
import { handleVerify, type VerifyDeps } from "../lib/verify";
import { SubmissionSchema } from "../lib/types";

// The lead as the page holds it after the Unbounce handoff.
const lead = {
  first_name: "Dana", last_name: "W", email: "dana.w@gmail.com", school: "Kearny", country: "United States of America",
  user_profile: "Curriculum Director", when_is_your_district_planning_to_adopt_a_new_math_curriculum: "SY27-28",
};
const key = decisionKey(SubmissionSchema.parse({ name: "Dana", surname: "W", email: "dana.w@gmail.com", job_title: "Curriculum Director", school: "Kearny", adoption_timeline: "SY27-28" }));
const decided = {
  sf: { matchedBy: "none", account: { id: "001", name: "[School District] Kearny (Kearny, NJ)" } },
  decision: { level: 3, route: "gm", reason: "", source: "rules" },
  host: { name: "Larry Dang", alsoAdd: [], source: "sheet" },
};

async function setup() {
  const store = memoryStore();
  await store.set(key, JSON.stringify(decided), 60);
  const deps: VerifyDeps = { store, slack: vi.fn(async () => {}) };
  return deps;
}

describe("personal email domains", () => {
  it("blocks free mail and internet-provider addresses, including country versions", () => {
    for (const e of ["a@gmail.com", "a@AOL.com", "a@yahoo.co.uk", "a@hotmail.fr", "a@icloud.com", "a@comcast.net", "a@rogers.com"]) expect(isPersonalEmail(e)).toBe(true);
    for (const e of ["a@kearnyschools.com", "a@schools.nyc.gov", "a@lakeview.k12.ny.us", "a@innovamat.com"]) expect(isPersonalEmail(e)).toBe(false);
  });

  it("never reads a district from a personal or internal domain", () => {
    expect(emailDomain("a@aol.com")).toBeUndefined();
    expect(emailDomain("a@innovamat.com")).toBeUndefined();
    expect(emailDomain("a@kearnyschools.com")).toBe("kearnyschools.com");
  });
});

describe("/api/verify", () => {
  vi.spyOn(console, "log").mockImplementation(() => {});

  it("refuses a personal or malformed email", async () => {
    const deps = await setup();
    expect(await handleVerify({ email: "Dana.W@gmail.com", lead }, deps)).toMatchObject({ status: 400, body: { ok: false, reason: "personal" } });
    expect(await handleVerify({ email: "dana@", lead }, deps)).toMatchObject({ status: 400, body: { reason: "invalid" } });
    expect(deps.slack).not.toHaveBeenCalled();
  });

  it("unlocks with a school email and tells Slack when it differs from the form's", async () => {
    const deps = await setup();
    expect(await handleVerify({ email: " Dana@KearnySchools.com ", lead }, deps)).toEqual({ status: 200, body: { ok: true, email: "dana@kearnyschools.com" } });
    expect(deps.slack).toHaveBeenCalledWith(
      ":email: *Dana W* (Curriculum Director) · [School District] Kearny (Kearny, NJ) switched to *dana@kearnyschools.com* before booking with Larry Dang. _The form had dana.w@gmail.com._",
    );
  });

  it("stays quiet in Slack when the lead keeps the form's email", async () => {
    const deps = await setup();
    const same = { ...lead, email: "dana@kearnyschools.com" };
    expect((await handleVerify({ email: "dana@kearnyschools.com", lead: same }, deps)).status).toBe(200);
    expect(deps.slack).not.toHaveBeenCalled();
  });

  it("a Slack failure doesn't block the lead", async () => {
    const deps = await setup();
    deps.slack = vi.fn(async () => { throw new Error("down"); });
    expect((await handleVerify({ email: "dana@kearnyschools.com", lead }, deps)).status).toBe(200);
  });
});
