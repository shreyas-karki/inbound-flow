import { describe, expect, it } from "vitest";
import { memoryStore } from "../lib/decisions";
import { cachedAccountScore, describeScore, pickBuyer } from "../lib/starbridge";
import type { StarbridgeResult } from "../lib/types";

// Real results from Starbridge's buyer search.
const nyc = [
  { id: "city", name: "New York City", type: "City", url: "https://nyc.gov" },
  { id: "nyu", name: "New York University", type: "HigherEducation", url: "https://www.nyu.edu/" },
  { id: "arch", name: "Archdiocese of New York", type: "SchoolDistrict", url: "http://www.archny.org/" },
  { id: "d2", name: "New York City Community School District 2", type: "SchoolDistrict", url: "https://district2nyc.org" },
];
const portChester = [
  { id: "village", name: "Village of Port Chester", type: "City", url: "https://portchesterny.gov" },
  { id: "hs", name: "Port Chester High School", type: "School", url: "https://portchesterschools.org" },
  { id: "pcps", name: "Port Chester Public Schools", type: "SchoolDistrict", url: "https://portchesterschools.org" },
];

describe("pickBuyer", () => {
  it("prefers the district on the lead's email domain", () => {
    expect(pickBuyer("Port Chester", portChester, "portchesterschools.org")?.id).toBe("pcps");
    expect(pickBuyer("King Street School", portChester, "portchesterschools.org")?.id).toBe("pcps");
  });
  it("does not treat a parent domain as the district (schools.nyc.gov is not nyc.gov)", () => {
    expect(pickBuyer("New York City Public Schools", nyc, "schools.nyc.gov")?.id).not.toBe("city");
  });
  it("never falls back to an unrelated district", () => {
    expect(pickBuyer("New York City Public Schools", nyc)?.id).not.toBe("arch");
    expect(pickBuyer("Port Chester", portChester)?.id).toBe("pcps");
  });
});

// Real results from Starbridge's buyer search for "Oak Ridge" with no state (Nov 17 2026): no district in the top ten.
const oakRidgeNationwide = [
  { id: "c-tn", name: "City of Oak Ridge", type: "City", url: "https://oakridgetn.gov" },
  { id: "c-tx", name: "City of Oak Ridge", type: "City", url: "https://cityofoakridgetx.com" },
  { id: "s-mo", name: "Oak Ridge School", type: "School", url: null },
];
const oakRidgeTn = [
  { id: "c-tn", name: "City of Oak Ridge", type: "City", url: "https://oakridgetn.gov" },
  { id: "d-tn", name: "Oak Ridge City School District", type: "SchoolDistrict", url: "https://ortn.edu" },
  { id: "hs-tn", name: "Oak Ridge High School", type: "School", url: "https://ortn.edu" },
];

describe("pickBuyer with and without a state", () => {
  it("finds no district in a nationwide search for a common name, and the right one once the state narrows it", () => {
    expect(pickBuyer("Oak Ridge", oakRidgeNationwide, "ortn.edu")).toBeUndefined();
    expect(pickBuyer("Oak Ridge", oakRidgeTn, "ortn.edu")?.id).toBe("d-tn");
  });
});

describe("cachedAccountScore", () => {
  const miss: StarbridgeResult = { source: "starbridge" };
  const match: StarbridgeResult = { source: "starbridge", buyerName: "Oak Ridge City School District", stateCode: "TN" };
  const school = "Oak Ridge - Oak Ridge, Tennessee";

  it("does not keep a miss from a search with no state, and looks again once the state is known", async () => {
    const store = memoryStore();
    const calls: (string | undefined)[] = [];
    const lookup = async (_s: string, state?: string) => { calls.push(state); return state ? match : miss; };
    // /api/warm: the form has no State field.
    expect((await cachedAccountScore(store, school, undefined, "ortn.edu", undefined, lookup)).buyerName).toBeUndefined();
    // Submit: Salesforce gave the state.
    expect((await cachedAccountScore(store, school, "TN", "ortn.edu", undefined, lookup)).buyerName).toBe("Oak Ridge City School District");
    expect(calls).toEqual([undefined, "TN"]);
  });

  it("retries a miss that an older deploy cached, once the state is known", async () => {
    const store = memoryStore();
    await store.set("sb|oak ridge - oak ridge, tennessee|ortn.edu", JSON.stringify(miss), 60);
    const out = await cachedAccountScore(store, school, "TN", "ortn.edu", undefined, async () => match);
    expect(out.buyerName).toBe("Oak Ridge City School District");
  });

  it("reuses a cached match without calling Starbridge again", async () => {
    const store = memoryStore();
    let n = 0;
    const lookup = async () => { n++; return match; };
    await cachedAccountScore(store, school, "TN", "ortn.edu", undefined, lookup);
    await cachedAccountScore(store, school, undefined, "ortn.edu", undefined, lookup);
    expect(n).toBe(1);
  });

  it("keeps a miss that was searched with a state, so a district Starbridge doesn't have isn't looked up on every lead", async () => {
    const store = memoryStore();
    let n = 0;
    const lookup = async () => { n++; return miss; };
    await cachedAccountScore(store, school, "TN", "ortn.edu", undefined, lookup);
    await cachedAccountScore(store, school, "TN", "ortn.edu", undefined, lookup);
    expect(n).toBe(1);
  });
});

describe("describeScore", () => {
  it("a district Starbridge knows but hasn't scored doesn't print an empty score", () => {
    const line = describeScore({ source: "starbridge", buyerName: "Madison School District", account: { score: undefined as unknown as number, fitBand: "", signalBand: "NoSignals" } } as StarbridgeResult);
    expect(line).toBe("Not scored yet · Signals NoSignals");
  });
});
