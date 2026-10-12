import { describe, expect, it } from "vitest";
import { memoryStore } from "../lib/decisions";
import { cachedAccountScore, starbridgeKey } from "../lib/starbridge";
import { warmStarbridge } from "../lib/warm";

describe("Starbridge warm-up", () => {
  it("picking a district caches its Starbridge answer under the form's school value and email domain", async () => {
    const store = memoryStore();
    await warmStarbridge({ school: "Lakeview County Schools", email: "dana@lakeview.k12.us" }, store);
    const cached = await store.get(starbridgeKey("Lakeview County Schools", "lakeview.k12.us"));
    expect(JSON.parse(cached!)).toMatchObject({ account: { signalBand: "Hot" } });
  });

  it("the decision at submit reuses the cached answer", async () => {
    const store = memoryStore();
    const fake = { source: "starbridge", buyerName: "Cached District" };
    await store.set(starbridgeKey("Akron City - Akron, Summit"), JSON.stringify(fake), 60);
    expect(await cachedAccountScore(store, "Akron City - Akron, Summit")).toEqual(fake);
  });

  it("ignores empty or too-short school values", () => {
    expect(warmStarbridge({ school: "" }, memoryStore())).toBeUndefined();
    expect(warmStarbridge({ school: "ab" }, memoryStore())).toBeUndefined();
  });
});
