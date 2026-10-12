// A small copy of the routing sheet's three tabs, laid out like the real ones (made-up user IDs and links).
import { parseBdrs, parseFirstTouch, parsePeople, type RoutingTables } from "../../lib/calendars";

export const IDS = {
  luis: "005000000000001AAA",
  neftali: "005000000000002AAA",
  eric: "005000000000003AAA",
  melina: "005000000000004AAA",
  manuel: "005000000000005AAA",
};

export const MAPPING_CSV = `US State,Owner,User Long ID,Calendar Link,Account Team
New York,Luis Acevedo,${IDS.luis},#N/A,Atlantic
Ohio,Luis Acevedo,${IDS.luis},#N/A,Atlantic
Michigan,Luis Acevedo,${IDS.luis},#N/A,Atlantic
Indiana,Luis Acevedo,${IDS.luis},#N/A,Atlantic
New Jersey,Luis Acevedo,${IDS.luis},#N/A,Atlantic
Texas,Neftali Cuevas,${IDS.neftali},#N/A,Texas
Other,Luis Acevedo,${IDS.luis},#N/A,Other
`;

export const CALENDARS_CSV = `SF Long ID,SF Name,Calendar Link
${IDS.luis},Luis Acevedo,https://calendar.google.com/calendar/u/0/appointments/schedules/AcZLuis
${IDS.neftali},Neftali Cuevas,#N/A
${IDS.eric},Eric Fontana,https://calendar.google.com/appointments/schedules/AcZEric
${IDS.melina},Melina Gruber,https://calendar.google.com/calendar/u/0/appointments/schedules/AcZMelina
${IDS.manuel},Manuel Méndez,https://calendar.google.com/calendar/u/0/appointments/schedules/AcZManuel
`;

// The new tab, from Manuel's Oct 12 list. Owner IDs left blank on purpose: names are matched to calendar_links.
export const FT_OWNERS_CSV = `State,Owner,Owner ID,Also add
"Connecticut, Massachusetts",Eric Fontana,,Chenoa
New York,Eric Fontana,,Chenoa
Ohio,Arnau Marli,,"Eric, Chenoa"
Indiana,Melina Gruber,,Neha
Michigan,Melina Gruber,,Prynce
Other,Manuel Méndez,,
`;

export const TABLES: RoutingTables = {
  bdrs: parseBdrs(MAPPING_CSV),
  firstTouch: parseFirstTouch(FT_OWNERS_CSV),
  people: parsePeople(CALENDARS_CSV),
};
