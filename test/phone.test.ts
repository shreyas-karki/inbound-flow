import { describe, expect, it, vi } from "vitest";
import { decisionKey, memoryStore } from "../lib/decisions";
import { toSfContext } from "../lib/handoff";
import { handlePhone, usPhone, type PhoneDeps } from "../lib/phone";
import { SubmissionSchema } from "../lib/types";

// The lead as the page holds it after the Unbounce handoff: Unbounce field names, no phone.
const lead = {
  first_name: "Dana", last_name: "W", email: "Dana@Kearny.org", school: "Kearny", country: "United States of America",
  user_profile: "Curriculum Director", when_is_your_district_planning_to_adopt_a_new_math_curriculum: "SY28-29 or later",
};
const key = decisionKey(SubmissionSchema.parse({ name: "Dana", surname: "W", email: "dana@kearny.org", job_title: "Curriculum Director", school: "Kearny", adoption_timeline: "SY28-29 or later" }));
// What decide() cached for this lead: Make's handoff with the district's main line.
const decided = {
  sf: toSfContext({ matched_by: "email", contact_id: "003KEARNY", account_id: "001KEARNY", account_name: "[School District] Kearny (Kearny, NJ)", account_parr: "209720", account_phone: "(201) 955-5000" }),
  decision: { level: 3, route: "gm", reason: "Curriculum Director…", source: "rules" },
  host: { name: "Larry Dang", alsoAdd: [], source: "sheet" },
};

async function setup(cached = true) {
  const store = memoryStore();
  if (cached) await store.set(key, JSON.stringify(decided), 60);
  const deps: PhoneDeps = { slack: vi.fn(async () => {}), salesforce: vi.fn(async () => {}), store };
  return deps;
}

describe("/api/phone", () => {
  vi.spyOn(console, "log").mockImplementation(() => {});

  it("formats 10 US digits, with or without the leading 1", () => {
    expect(usPhone("555.555.0123")).toBe("(555) 555-0123");
    expect(usPhone("+1 (555) 555-0123")).toBe("(555) 555-0123");
    expect(usPhone("555-0123")).toBeUndefined();
    expect(usPhone("2 555 555 0123")).toBeUndefined();
  });

  it("takes the district's main lines from Make's handoff", () => {
    expect(decided.sf.account?.phones).toEqual(["(201) 955-5000"]);
    expect(toSfContext({ account_id: "1", account_phone: "", parent_phone: "" }).account).not.toHaveProperty("phones");
  });

  it("sends the lead's own number to Slack and to Make for Salesforce", async () => {
    const deps = await setup();
    const out = await handlePhone({ phone_number: "5555550123", level: 3, lead }, deps);
    expect(out).toEqual({ status: 200, body: { ok: true, phone: "(555) 555-0123", outcome: "saved" } });
    expect(deps.slack).toHaveBeenCalledWith(
      ":telephone_receiver: *Dana W* (Curriculum Director) · [School District] Kearny (Kearny, NJ) · dana@kearny.org\n" +
      "Number for confirmation calls and deliveries (Level 3, booking with Larry Dang): *+1 (555) 555-0123*",
    );
    expect(deps.salesforce).toHaveBeenCalledWith({ email: "dana@kearny.org", phone: "+1 (555) 555-0123", contact_id: "003KEARNY", account_id: "001KEARNY", level: 3 });
  });

  it("doesn't save the district's main line as the lead's number", async () => {
    const deps = await setup();
    const out = await handlePhone({ phone_number: "1-201-955-5000", level: 3, lead }, deps);
    expect(out.body).toMatchObject({ ok: true, outcome: "district_line" });
    expect(deps.slack).not.toHaveBeenCalled();
    expect(deps.salesforce).not.toHaveBeenCalled();
  });

  it("notes when it differs from the form's number, and still saves it without a cached decision", async () => {
    const deps = await setup(false);
    await handlePhone({ phone_number: "5555550123", level: 2, lead: { ...lead, phone_number: "2015550000" } }, deps);
    expect(deps.slack).toHaveBeenCalledWith(expect.stringContaining("(Level 2): *+1 (555) 555-0123*\n_The form had +1 (201) 555-0000._"));
    expect(deps.salesforce).toHaveBeenCalledWith(expect.objectContaining({ contact_id: null, level: 2 }));
  });

  it("a Slack or Make failure doesn't fail the lead", async () => {
    const deps = await setup();
    deps.slack = vi.fn(async () => { throw new Error("down"); });
    deps.salesforce = undefined;
    expect((await handlePhone({ phone_number: "5555550123", lead }, deps)).status).toBe(200);
  });

  it("rejects a short number or an incomplete lead", async () => {
    const deps = await setup();
    expect((await handlePhone({ phone_number: "555", lead }, deps)).status).toBe(400);
    expect((await handlePhone({ phone_number: "5555550123", lead: { email: "a@b.org" } }, deps)).status).toBe(400);
    expect(deps.slack).not.toHaveBeenCalled();
  });
});
