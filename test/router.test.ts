import { describe, expect, it, vi } from "vitest";
import { handleSubmission, type Deps } from "../lib/router";
import { mockScorer } from "../lib/score";
import { createSalesforce } from "../lib/salesforce";
import { lookupAccountScore } from "../lib/starbridge";

const deps = (): Deps & { posts: string[] } => {
  const posts: string[] = [];
  return { salesforce: createSalesforce(), starbridge: lookupAccountScore, scorer: mockScorer, slack: async (t) => { posts.push(t); }, posts };
};
const base = { name: "Dana", surname: "W", email: "d@example.org", country: "United States of America" };

describe("handleSubmission (mock mode)", () => {
  vi.spyOn(console, "log").mockImplementation(() => {});

  it("district lead with signals → Level 3", async () => {
    const d = deps();
    const out = await handleSubmission({ ...base, job_title: "Curriculum Director", school: "Lakeview County Schools", needs: "Tier 2/3 intervention RFP" }, d);
    expect(out.body).toMatchObject({ ok: true, level: 3 });
    expect(d.posts[0]).toContain("Level 3");
  });

  it("teacher with vague request → Level 1 with an email draft in Slack", async () => {
    const d = deps();
    const out = await handleSubmission({ ...base, job_title: "Teacher", school: "Riverside Unified", needs: "ideas for fractions" }, d);
    expect(out.body.level).toBe(1);
    expect(d.posts[0]).toContain("Subject: Math Journeys resources");
  });

  it("existing customer → owner, no BDR calendar", async () => {
    const out = await handleSubmission({ ...base, job_title: "Principal", school: "Maplewood Public Schools" }, deps());
    expect(out.body.next).toMatchObject({ type: "thanks" });
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
