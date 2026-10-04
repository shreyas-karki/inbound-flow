import { describe, expect, it, vi } from "vitest";
import { embeddable, handleSubmission, type Deps } from "../lib/router";
import { mockScorer } from "../lib/score";
import { createSalesforce } from "../lib/salesforce";
import { lookupAccountScore } from "../lib/starbridge";
import { mockDrafter } from "../lib/sdr";

const deps = (): Deps & { posts: string[] } => {
  const posts: string[] = [];
  return { salesforce: createSalesforce(), starbridge: lookupAccountScore, scorer: mockScorer, drafter: mockDrafter, slack: async (t) => { posts.push(t); }, posts };
};
const base = { name: "Dana", surname: "W", email: "d@example.org", country: "United States of America" };

describe("handleSubmission (mock mode)", () => {
  vi.spyOn(console, "log").mockImplementation(() => {});

  it("district lead with signals → Level 3", async () => {
    const d = deps();
    const out = await handleSubmission({ ...base, job_title: "Curriculum Director", school: "Lakeview County Schools", adoption_timeline: "SY27-28" }, d);
    await out.background;
    expect(out.body).toMatchObject({ ok: true, level: 3 });
    expect(d.posts[0]).toContain("Level 3");
    expect(d.posts[0]).toContain("First Touch");
  });

  it("teacher with no WHY NOW → Level 1, reply asks them to loop in the district", async () => {
    const d = deps();
    const out = await handleSubmission({ ...base, job_title: "Teacher", school: "Riverside Unified", needs: "ideas for fractions" }, d);
    await out.background;
    expect(out.body.level).toBe(1);
    expect(d.posts[0]).toContain("Subject: Your Thinking Math! request");
    expect(d.posts[0]).toContain("curriculum director");
    expect(d.posts[0]).toContain("mail.google.com");
  });

  it("instructional coach at a hot district → Level 2 Discovery", async () => {
    const out = await handleSubmission({ ...base, job_title: "Instructional Coach", school: "Lakeview County Schools" }, deps());
    expect(out.body.level).toBe(2);
  });

  it("teacher adopting soon → Level 2", async () => {
    const out = await handleSubmission({ ...base, job_title: "Teacher", school: "Riverside Unified", adoption_timeline: "SY26-27" }, deps());
    expect(out.body.level).toBe(2);
  });

  it("math coordinator at a hot district adopting soon is still a Discovery, never a First Touch", async () => {
    const out = await handleSubmission({ ...base, job_title: "Math / STEM Coordinator", school: "Lakeview County Schools", adoption_timeline: "SY26-27" }, deps());
    expect(out.body.level).toBe(2);
  });

  it("NYC teacher is asked to loop in their principal or AP", async () => {
    const d = deps();
    const out = await handleSubmission({ ...base, job_title: "Teacher", school: "P.S. 321 William Penn" }, d);
    await out.background;
    expect(d.posts[0]).toContain("principal or an assistant principal");
  });

  it("existing customer → owner, no BDR calendar", async () => {
    const d = deps();
    const out = await handleSubmission({ ...base, job_title: "Principal", school: "Maplewood Public Schools" }, d);
    await out.background;
    expect(out.body.next).toMatchObject({ type: "thanks" });
    expect(d.posts[0]).not.toContain("AI SDR reply");
    expect(out.body.next?.message).toContain("Sample KAM");
  });

  it("honeypot submissions get a fake thank-you and no Slack post", async () => {
    const d = deps();
    const out = await handleSubmission({ ...base, job_title: "Teacher", school: "X", website: "spam" }, d);
    expect(out.status).toBe(200);
    expect(d.posts).toHaveLength(0);
  });

  it("rejects missing required fields", async () => {
    const out = await handleSubmission({ name: "x" }, deps());
    expect(out.status).toBe(400);
  });
});

describe("embeddable", () => {
  it("adds gv=true to Google appointment schedule URLs so they load in an iframe", () => {
    expect(embeddable("https://calendar.google.com/calendar/appointments/schedules/AcZ")).toBe("https://calendar.google.com/calendar/appointments/schedules/AcZ?gv=true");
    expect(embeddable("https://calendar.google.com/calendar/appointments/schedules/AcZ?gv=true")).toBe("https://calendar.google.com/calendar/appointments/schedules/AcZ?gv=true");
    expect(embeddable("https://calendly.com/x")).toBe("https://calendly.com/x");
  });
});
