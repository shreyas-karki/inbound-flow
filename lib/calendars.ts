// Who follows up, and on which calendar. Reads the "US - Mapping Owners for Inbounds" sheet, published as CSV:
// - Mapping:        US State | Owner | User Long ID | … | Account Team   → the state's BDR (Level 2 Discovery)
// - calendar_links: SF Long ID | SF Name | Calendar Link                 → each person's Google appointment page
// - ft_owners:      State | Owner | Owner ID | Also add                  → the state's First Touch owner (Level 3)
// Make scenario 172177 also reads Mapping (columns A and C), so only ever add columns or tabs there.
import { config } from "./config";
import { stateName } from "./states";
import type { Decision, Host, SfContext, StarbridgeResult, Submission } from "./types";

export interface PersonRow { name: string; userId?: string; bookingUrl?: string }
export interface StateRow { state: string; owner: string; userId?: string; alsoAdd: string[] }
export interface RoutingTables {
  bdrs: StateRow[]; // from Mapping
  firstTouch: StateRow[]; // from ft_owners
  people: PersonRow[]; // from calendar_links
}

export const EMPTY_TABLES: RoutingTables = { bdrs: [], firstTouch: [], people: [] };
const OTHER = "Other";

// ---------------------------------------------------------------- routing

/** The lead's state: what they picked on the form, then the "(City, ST)" suffix on the Salesforce district, then Starbridge. */
export function resolveState(sub: Submission, sf: SfContext, sb: StarbridgeResult): string | undefined {
  const district = sf.account?.parentName ?? sf.account?.name;
  const suffix = district?.match(/,\s*([A-Z]{2})\)\s*$/)?.[1];
  return stateName(sub.state) ?? stateName(suffix) ?? stateName(sb.stateCode);
}

export function resolveHost(decision: Decision, state: string | undefined, sf: SfContext, tables: RoutingTables): Host {
  const { routing } = config;

  // Existing customer or open deal: the deal owner first, then the account owner. They reach out; no calendar.
  if (decision.route === "owner") {
    const owner = sf.existingOwner;
    const opp = sf.openOpportunity;
    return {
      name: owner?.name ?? opp?.ownerName ?? sf.account?.ownerName ?? decision.ownerName ?? "Your Innovamat contact",
      userId: owner?.id ?? opp?.ownerId ?? sf.account?.ownerId,
      alsoAdd: [],
      source: "salesforce",
    };
  }

  // Level 3: First Touch with the state's owner, who decides who runs it.
  if (decision.route === "gm") {
    const row = rowFor(tables.firstTouch, state);
    if (row) return personHost(row, tables, "first_touch_sheet");
    return { name: routing.gmName, bookingUrl: routing.gmBookingUrl || undefined, alsoAdd: [], source: "env" };
  }

  // Levels 0-2: the state's BDR. Only Level 2 books a call; 0 and 1 just need an owner for the Contact.
  const row = rowFor(tables.bdrs, state);
  const host = row ? personHost(row, tables, "bdr_sheet") : { name: routing.bdrName, alsoAdd: [], source: "env" as const };
  if (decision.level < 2) return { ...host, bookingUrl: undefined };
  return { ...host, bookingUrl: host.bookingUrl ?? (routing.bdrBookingUrl || undefined) };
}

function rowFor(rows: StateRow[], state?: string): StateRow | undefined {
  return (state && rows.find((r) => r.state === state)) || rows.find((r) => r.state === OTHER);
}

function personHost(row: StateRow, tables: RoutingTables, source: Host["source"]): Host {
  const byId = row.userId ? tables.people.find((p) => p.userId === row.userId && p.bookingUrl) : undefined;
  const byName = tables.people.find((p) => sameName(p.name, row.owner) && p.bookingUrl);
  const person = byId ?? byName;
  return {
    name: row.owner,
    userId: row.userId ?? tables.people.find((p) => sameName(p.name, row.owner) && p.userId)?.userId,
    bookingUrl: person?.bookingUrl,
    alsoAdd: row.alsoAdd,
    source,
  };
}

// "Manuel Méndez" matches "manuel mendez"; first names alone don't match, to avoid picking the wrong Eric.
function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * Google appointment pages only load in an iframe as calendar.google.com/calendar/appointments/schedules/<id>?gv=true.
 * The sheet has variants with /u/0/ or without /calendar/. A booking page that lists several of someone's schedules
 * (calendar.google.com/calendar/appointments/<id>=) embeds the same way. Anything else passes through.
 */
export function embeddable(url: string): string {
  const base = /calendar\.google\.com\/(?:calendar\/)?(?:u\/\d+\/)?appointments\//;
  const schedule = url.match(new RegExp(base.source + /schedules\/([\w-]+)/.source))?.[1];
  if (schedule) return `https://calendar.google.com/calendar/appointments/schedules/${schedule}?gv=true`;
  const bookingPage = url.match(new RegExp(base.source + /(?!schedules\/)([\w-]+=*)/.source))?.[1];
  return bookingPage ? `https://calendar.google.com/calendar/appointments/${bookingPage}?gv=true` : url;
}

// ---------------------------------------------------------------- loading the sheet

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

/** Rows as objects keyed by the first matching header, so reordering or adding columns doesn't break anything. */
function records(csv: string, columns: Record<string, RegExp>): Record<string, string>[] {
  const [header = [], ...rows] = parseCsv(csv);
  const index = Object.fromEntries(Object.entries(columns).map(([key, re]) => [key, header.findIndex((h) => re.test(h.trim()))]));
  return rows.map((r) => Object.fromEntries(Object.entries(index).map(([key, i]) => [key, i >= 0 ? (r[i] ?? "").trim() : ""])));
}

const isUserId = (s: string) => /^005[A-Za-z0-9]{12,15}$/.test(s);
const cleanId = (s: string) => (isUserId(s) ? s : undefined);
const splitNames = (s: string) => s.split(/[,;/]|\band\b/).map((n) => n.trim()).filter(Boolean);

/** "Connecticut, Massachusetts", "CT/MA" or "Other" → canonical state names. */
function statesIn(cell: string): string[] {
  if (/^other$/i.test(cell.trim())) return [OTHER];
  return cell.split(/[,;/]/).map((s) => stateName(s)).filter((s): s is string => Boolean(s));
}

export function parseBdrs(csv: string): StateRow[] {
  return records(csv, { state: /state/i, owner: /^owner$/i, userId: /id/i }).flatMap((r) =>
    statesIn(r.state).map((state) => ({ state, owner: r.owner, userId: cleanId(r.userId), alsoAdd: [] })),
  );
}

export function parseFirstTouch(csv: string): StateRow[] {
  return records(csv, { state: /state/i, owner: /^owner$/i, userId: /id/i, alsoAdd: /also|add/i }).flatMap((r) =>
    r.owner ? statesIn(r.state).map((state) => ({ state, owner: r.owner, userId: cleanId(r.userId), alsoAdd: splitNames(r.alsoAdd) })) : [],
  );
}

export function parsePeople(csv: string): PersonRow[] {
  return records(csv, { userId: /id/i, name: /name/i, bookingUrl: /link|url/i }).map((r) => ({
    name: r.name,
    userId: cleanId(r.userId),
    bookingUrl: /^https?:\/\//.test(r.bookingUrl) ? r.bookingUrl : undefined, // "#N/A" and blanks don't count
  }));
}

/** calendar.app.google short links redirect to the full page; resolve them so they can be embedded. */
export async function expandShortLink(url: string, fetcher: typeof fetch = fetch): Promise<string | undefined> {
  if (!/^https:\/\/calendar\.app\.google\//.test(url)) return url;
  try {
    const res = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    const location = res.headers.get("location");
    return location && /calendar\.google\.com\/.*appointments\//.test(location) ? location : undefined;
  } catch {
    return undefined;
  }
}

const TTL_MS = 10 * 60_000;
let cache: { at: number; tables: RoutingTables } | undefined;

/** The sheet, cached for 10 minutes. A failed refresh keeps the last good copy; no sheet configured means env fallbacks. */
export async function loadRoutingTables(): Promise<RoutingTables> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.tables;
  const { mappingCsvUrl, calendarsCsvUrl, ftOwnersCsvUrl } = config.sheets;
  const get = async (url: string) => {
    if (!url) return "";
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status} ${url}`);
    return res.text();
  };
  try {
    const [mapping, calendars, ftOwners] = await Promise.all([get(mappingCsvUrl), get(calendarsCsvUrl), get(ftOwnersCsvUrl)]);
    const people = await Promise.all(parsePeople(calendars).map(async (p) => ({ ...p, bookingUrl: p.bookingUrl && (await expandShortLink(p.bookingUrl)) })));
    const tables = { bdrs: parseBdrs(mapping), firstTouch: parseFirstTouch(ftOwners), people };
    cache = { at: Date.now(), tables };
    return tables;
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "routing_sheet_error", error: err instanceof Error ? err.message : String(err) }));
    // Retry in a minute rather than on every lead.
    cache = { at: Date.now() - TTL_MS + 60_000, tables: cache?.tables ?? EMPTY_TABLES };
    return cache.tables;
  }
}
