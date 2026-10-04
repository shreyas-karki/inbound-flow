import { describe, expect, it } from "vitest";
import { pickBuyer } from "../lib/starbridge";

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
