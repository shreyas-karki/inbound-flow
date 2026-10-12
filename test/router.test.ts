import { describe, expect, it, vi } from "vitest";
import { embeddable, handleSubmission, type Deps } from "../lib/router";
import { mockScorer } from "../lib/score";
import { createSalesforce } from "../lib/salesforce";
import { lookupAccountScore } from "../lib/starbridge";
import { mockDrafter } from "../lib/sdr";
import { listOutbox } from "../lib/outbox";
import { EMPTY_TABLES } from "../lib/calendars";
import { memoryStore } from "../lib/decisions";

const deps = (): Deps & { posts: string[] } => {
  const posts: string[] = [];
  return {
    salesforce: createSalesforce(), starbridge: lookupAccountScore, scorer: mockScorer, drafter: mockDrafter, slack: async (t) => { posts.push(t); },
    routing: async () => EMPTY_TABLES, store: memoryStore(), actionsOwner: "app", posts,
  };
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
    expect(d.posts).toHaveLength(0); // Levels 0 and 1 don't post to Slack
    const draft = listOutbox()[0].draft;
    expect(draft?.subject).toContain("Your Thinking Math! request");
    expect(draft?.body).toContain("curriculum director");
    expect(draft?.gmailUrl).toContain("mail.google.com");
  });

  it("instructional coach at a hot district → Level 2 Discovery", async () => {
    const out = await handleSubmission({ ...base, job_title: "Instructional Coach", school: "Lakeview County Schools" }, deps());
    expect(out.body.level).toBe(2);
  });

  it("teacher adopting soon stays Level 1: a teacher's adoption answer needs a second signal", async () => {
    const out = await handleSubmission({ ...base, job_title: "Teacher", school: "Riverside Unified", adoption_timeline: "SY26-27" }, deps());
    expect(out.body.level).toBe(1);
  });

  it("internal @innovamat.com test is scored like a real lead, flagged in Slack, never written to Salesforce", async () => {
    const d = deps();
    const out = await handleSubmission({ ...base, email: "tester@innovamat.com", job_title: "Curriculum Director", school: "Lakeview County Schools", adoption_timeline: "SY27-28" }, d);
    await out.background;
    expect(out.body.level).toBe(3);
    expect(d.posts[0]).toContain("*TEST*");
    expect(listOutbox()[0].salesforce).toBe("skipped");
  });

  it("parent → Level 0, no Slack post and no AI reply", async () => {
    const d = deps();
    const out = await handleSubmission({ ...base, job_title: "Parent or Homeschooler", school: "Riverside Unified" }, d);
    await out.background;
    expect(out.body.level).toBe(0);
    expect(d.posts).toHaveLength(0);
    expect(listOutbox()[0].draft).toBeUndefined();
  });

  it("math coordinator at a hot, sizable district adopting soon goes straight to the GM (fast lane)", async () => {
    const out = await handleSubmission({ ...base, job_title: "Math / STEM Coordinator", school: "Lakeview County Schools", adoption_timeline: "SY26-27" }, deps());
    expect(out.body).toMatchObject({ level: 3, route: "gm" });
  });

  it("NYC teacher is asked to loop in their principal or AP", async () => {
    const d = deps();
    const out = await handleSubmission({ ...base, job_title: "Teacher", school: "P.S. 321 William Penn" }, d);
    await out.background;
    expect(listOutbox()[0].draft?.body).toContain("principal or an assistant principal");
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
    // The sheet's variants: signed-in /u/0/ links and links without /calendar/.
    expect(embeddable("https://calendar.google.com/calendar/u/0/appointments/schedules/AcZ")).toBe("https://calendar.google.com/calendar/appointments/schedules/AcZ?gv=true");
    expect(embeddable("https://calendar.google.com/appointments/schedules/AcZ")).toBe("https://calendar.google.com/calendar/appointments/schedules/AcZ?gv=true");
    expect(embeddable("https://example.com/book")).toBe("https://example.com/book");
  });
});
