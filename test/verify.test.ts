import { describe, expect, it, vi } from "vitest";
import { decisionKey, memoryStore } from "../lib/decisions";
import { isPersonalEmail } from "../lib/email";
import { emailDomain } from "../lib/salesforce";
import { handleVerify, toOwnerHit, type VerifyDeps } from "../lib/verify";
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
  const deps: VerifyDeps = { store, slack: vi.fn(async () => {}), saveSwitch: vi.fn(async () => {}), checkOwner: vi.fn(async () => undefined) };
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
    expect(deps.saveSwitch).toHaveBeenCalledWith({
      form_email: "dana.w@gmail.com", school_email: "dana@kearnyschools.com", name: "Dana W", job_title: "Curriculum Director", school: "Kearny",
    });
  });

  it("still unlocks when Make can't be reached", async () => {
    const deps = await setup();
    deps.saveSwitch = vi.fn(async () => { throw new Error("HTTP 500"); });
    expect((await handleVerify({ email: "dana@kearnyschools.com", lead }, deps)).status).toBe(200);
    expect(deps.slack).toHaveBeenCalled();
  });

  it("stays quiet in Slack when the lead keeps the form's email", async () => {
    const deps = await setup();
    const same = { ...lead, email: "dana@kearnyschools.com" };
    expect((await handleVerify({ email: "dana@kearnyschools.com", lead: same }, deps)).status).toBe(200);
    expect(deps.slack).not.toHaveBeenCalled();
    expect(deps.saveSwitch).not.toHaveBeenCalled();
  });

  it("asks Make about every school email, switched or not", async () => {
    const deps = await setup();
    await handleVerify({ email: "dana@kearnyschools.com", lead }, deps);
    expect(deps.checkOwner).toHaveBeenCalledWith({
      form_email: "dana.w@gmail.com", school_email: "dana@kearnyschools.com", name: "Dana W", job_title: "Curriculum Director", school: "Kearny", switched: true,
    });
    const same = { ...lead, email: "dana@kearnyschools.com" };
    await handleVerify({ email: "dana@kearnyschools.com", lead: same }, deps);
    expect(deps.checkOwner).toHaveBeenLastCalledWith(expect.objectContaining({ switched: false }));
  });

  it("keeps the calendar hidden when the school email belongs to an owned account", async () => {
    const deps = await setup();
    deps.checkOwner = vi.fn(async () => ({ name: "Carlo Andrea Bassani", why: "Open deal in Pilot", account: "[School District] Kearny (Kearny, NJ)", matchedBy: "email-domain" }));
    expect(await handleVerify({ email: "dana@kearnyschools.com", lead }, deps)).toEqual({
      status: 200,
      body: { ok: true, email: "dana@kearnyschools.com", owner: "Carlo Andrea Bassani", message: "Thanks! Carlo Andrea Bassani will reach out to you shortly." },
    });
    expect(deps.slack).toHaveBeenCalledWith(
      ":lock: *Dana W* (Curriculum Director) · [School District] Kearny (Kearny, NJ) verified *dana@kearnyschools.com*, an account owned by *Carlo Andrea Bassani* (Open deal in Pilot). The calendar was hidden, instead of booking with Larry Dang; Carlo Andrea Bassani owns the follow-up. BDRs, don't contact. _The form had dana.w@gmail.com._",
    );
    expect(deps.saveSwitch).toHaveBeenCalled();
  });

  it("tells Slack about an owner even when the lead kept the form's email", async () => {
    const deps = await setup();
    deps.checkOwner = vi.fn(async () => ({ name: "Carlo Andrea Bassani" }));
    const same = { ...lead, email: "dana@kearnyschools.com" };
    expect((await handleVerify({ email: "dana@kearnyschools.com", lead: same }, deps)).body).toMatchObject({ owner: "Carlo Andrea Bassani" });
    expect(deps.slack).toHaveBeenCalledTimes(1);
    expect(deps.saveSwitch).not.toHaveBeenCalled();
  });

  it("unlocks the calendar when the owner check fails or times out", async () => {
    const deps = await setup();
    deps.checkOwner = vi.fn(async () => { throw new Error("TimeoutError"); });
    expect(await handleVerify({ email: "dana@kearnyschools.com", lead }, deps)).toEqual({ status: 200, body: { ok: true, email: "dana@kearnyschools.com" } });
  });

  it("reads Make's flat answer: an owner needs a name and an id", () => {
    expect(toOwnerHit({ owner_id: "005", owner_name: "Carlo Andrea Bassani", owner_why: "Customer, Closed Won", account_name: "[School District] Bakersfield City (Bakersfield, CA)", matched_by: "email-domain" }))
      .toEqual({ name: "Carlo Andrea Bassani", why: "Customer, Closed Won", account: "[School District] Bakersfield City (Bakersfield, CA)", matchedBy: "email-domain" });
    expect(toOwnerHit({ owner_id: "", owner_name: "", matched_by: "none", account_id: null })).toBeUndefined();
    expect(toOwnerHit("Accepted")).toBeUndefined();
  });

  it("a Slack failure doesn't block the lead", async () => {
    const deps = await setup();
    deps.slack = vi.fn(async () => { throw new Error("down"); });
    expect((await handleVerify({ email: "dana@kearnyschools.com", lead }, deps)).status).toBe(200);
  });
});
