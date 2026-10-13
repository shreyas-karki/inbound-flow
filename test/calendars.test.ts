import { describe, expect, it } from "vitest";
import { EMPTY_TABLES, expandShortLink, parseCsv, resolveHost, resolveState } from "../lib/calendars";
import { nextStep } from "../lib/router";
import { SubmissionSchema, type Decision, type SfContext } from "../lib/types";
import { IDS, TABLES } from "./fixtures/routing";

const decision = (level: Decision["level"], route: Decision["route"]): Decision => ({ level, route, reason: "test", source: "rules" });
const L1 = decision(1, "email");
const L2 = decision(2, "bdr");
const L3 = decision(3, "gm");
const none: SfContext = { matchedBy: "none" };
const sub = (extra: Record<string, string> = {}) =>
  SubmissionSchema.parse({ name: "A", surname: "B", email: "a@example.org", job_title: "Teacher", school: "X", ...extra });

describe("parseCsv", () => {
  it("handles quoted commas, doubled quotes and CRLF", () => {
    expect(parseCsv(`a,"b, c","say ""hi"""\r\n1,2,3\r\n`)).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });
});

describe("resolveState", () => {
  it("prefers the form, then the Salesforce district suffix, then Starbridge", () => {
    const sf: SfContext = { matchedBy: "account-name", account: { id: "1", name: "[School District] Austin ISD (Austin, TX)" } };
    expect(resolveState(sub({ state: "ny" }), sf, { source: "stub", stateCode: "OH" })).toBe("New York");
    expect(resolveState(sub(), sf, { source: "stub", stateCode: "OH" })).toBe("Texas");
    expect(resolveState(sub(), none, { source: "stub", stateCode: "OH" })).toBe("Ohio");
    expect(resolveState(sub({ state: "Narnia" }), none, { source: "stub" })).toBeUndefined();
  });
});

describe("resolveHost", () => {
  it("NY Level 2 → Luis, the state's BDR, with an embeddable calendar", () => {
    const host = resolveHost(L2, "New York", none, TABLES);
    expect(host).toMatchObject({ name: "Luis Acevedo", userId: IDS.luis, source: "bdr_sheet" });
    expect(nextStep(L2, host)).toMatchObject({ type: "calendar", url: "https://calendar.google.com/calendar/appointments/schedules/AcZLuis?gv=true" });
  });

  it("TX Level 2 → Neftali; no link yet, so the lead is told someone will call", () => {
    const host = resolveHost(L2, "Texas", none, TABLES);
    expect(host).toMatchObject({ name: "Neftali Cuevas", userId: IDS.neftali, bookingUrl: undefined });
    expect(nextStep(L2, host)).toMatchObject({ type: "thanks", host: "Neftali Cuevas" });
  });

  it("a state missing from the sheet, or no state at all, uses the Other row", () => {
    expect(resolveHost(L2, "Alaska", none, TABLES).name).toBe("Luis Acevedo");
    expect(resolveHost(L2, undefined, none, TABLES).name).toBe("Luis Acevedo");
  });

  it("Level 1 gets an owner for the Contact but no calendar", () => {
    const host = resolveHost(L1, "New York", none, TABLES);
    expect(host).toMatchObject({ name: "Luis Acevedo", userId: IDS.luis, bookingUrl: undefined });
    expect(nextStep(L1, host).type).toBe("thanks");
  });

  it("NY Level 3 → Eric, the state's First Touch owner, with Chenoa added; his ID comes from calendar_links", () => {
    const host = resolveHost(L3, "New York", none, TABLES);
    expect(host).toMatchObject({ name: "Eric Fontana", userId: IDS.eric, alsoAdd: ["Chenoa"], source: "first_touch_sheet" });
    expect(nextStep(L3, host)).toMatchObject({ type: "calendar", host: "Eric Fontana", url: "https://calendar.google.com/calendar/appointments/schedules/AcZEric?gv=true" });
  });

  it("one row can cover several states, and also-add lists split on commas", () => {
    expect(resolveHost(L3, "Massachusetts", none, TABLES).name).toBe("Eric Fontana");
    expect(resolveHost(L3, "Ohio", none, TABLES)).toMatchObject({ name: "Arnau Marli", userId: undefined, bookingUrl: undefined, alsoAdd: ["Eric", "Chenoa"] });
  });

  it("Level 3 in an unlisted state → the Other row (Manuel), matched by name despite the accent", () => {
    expect(resolveHost(L3, "Florida", none, TABLES)).toMatchObject({ name: "Manuel Méndez", userId: IDS.manuel });
  });

  it("no ft_owners tab yet → the GM env fallback", () => {
    const host = resolveHost(L3, "New York", none, { ...TABLES, firstTouch: [] });
    expect(host).toMatchObject({ name: "Growth Manager", source: "env" });
  });

  it("existing customer or open deal → the deal owner, then the account owner; no calendar", () => {
    const owner = decision(3, "owner");
    const sf: SfContext = {
      matchedBy: "account-name",
      account: { id: "1", name: "Maplewood", ownerId: "005000000000009AAA", ownerName: "Account Owner" },
      openOpportunity: { id: "006", stage: "Discovery", ownerId: "005000000000008AAA", ownerName: "Deal Owner" },
    };
    expect(resolveHost(owner, "New York", sf, TABLES)).toMatchObject({ name: "Deal Owner", userId: "005000000000008AAA", source: "salesforce" });
    expect(resolveHost(owner, "New York", { ...sf, openOpportunity: undefined }, EMPTY_TABLES).name).toBe("Account Owner");
    expect(nextStep(owner, resolveHost(owner, "New York", sf, TABLES))).toMatchObject({ type: "thanks", message: expect.stringContaining("Deal Owner") });
  });
});

describe("expandShortLink", () => {
  it("follows calendar.app.google to the full appointment page", async () => {
    const fetcher = (async () => new Response(null, { status: 302, headers: { location: "https://calendar.google.com/appointments/schedules/AcZFull" } })) as typeof fetch;
    expect(await expandShortLink("https://calendar.app.google/abc", fetcher)).toBe("https://calendar.google.com/appointments/schedules/AcZFull");
  });

  it("also accepts a short link that opens a booking page with several schedules", async () => {
    const fetcher = (async () => new Response(null, { status: 302, headers: { location: "https://calendar.google.com/calendar/appointments/AcZssZ3P8iz=" } })) as typeof fetch;
    expect(await expandShortLink("https://calendar.app.google/neha", fetcher)).toBe("https://calendar.google.com/calendar/appointments/AcZssZ3P8iz=");
  });

  it("drops a short link that doesn't resolve, and leaves full links alone", async () => {
    const fail = (async () => { throw new Error("offline"); }) as typeof fetch;
    expect(await expandShortLink("https://calendar.app.google/abc", fail)).toBeUndefined();
    expect(await expandShortLink("https://calendar.google.com/calendar/appointments/schedules/X", fail)).toBe("https://calendar.google.com/calendar/appointments/schedules/X");
  });
});
