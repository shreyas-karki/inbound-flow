import { describe, expect, it } from "vitest";
import { scoreWithFallback, type Scorer } from "../lib/score";
import { SubmissionSchema } from "../lib/types";

const sub = SubmissionSchema.parse({ name: "A", surname: "B", email: "a@b.org", job_title: "Principal", school: "X" });
const sb = { source: "stub" as const };

describe("scoreWithFallback", () => {
  it("uses the scorer result and maps level to route", async () => {
    const scorer: Scorer = async () => ({ level: 3, reason: "district lead" });
    expect(await scoreWithFallback(scorer, sub, { matchedBy: "none" }, sb)).toMatchObject({ level: 3, route: "gm", source: "claude" });
  });

  it("falls back to Level 2 on timeout", async () => {
    const slow: Scorer = () => new Promise((r) => setTimeout(() => r({ level: 1, reason: "late" }), 500));
    expect(await scoreWithFallback(slow, sub, { matchedBy: "none" }, sb, 50)).toMatchObject({ level: 2, route: "bdr", source: "fallback" });
  });

  it("falls back to Level 2 on errors", async () => {
    const broken: Scorer = async () => { throw new Error("refusal"); };
    expect(await scoreWithFallback(broken, sub, { matchedBy: "none" }, sb)).toMatchObject({ level: 2, source: "fallback" });
  });
});
