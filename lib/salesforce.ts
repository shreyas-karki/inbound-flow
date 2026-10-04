// Innovamat Salesforce model (from the innovamat-salesforce knowledge base):
// - US inbound lives on Contact (US_Inbound_Stage__c, isMQL__c), never Lead.
// - Every Contact needs an AccountId. Account creation goes through an Operations
//   approval flow, so the router never creates Accounts.
// - Salesforce blocks a second Contact with the same email, so we update instead.
// - Always exclude test data: Account.Label__c != 'TEST'.
import { config } from "./config";
import { isDecisionMaker } from "./rules";
import type { Decision, SfContext, Submission, WriteResult } from "./types";

export interface SalesforceClient {
  lookup(sub: Submission): Promise<SfContext>;
  upsertContact(sub: Submission, ctx: SfContext, decision: Decision): Promise<WriteResult>;
}

const US = "United States of America";

/** Fields we write on every inbound, mirroring the existing Make integration. */
export function buildContactFields(sub: Submission, ctx: SfContext, decision: Decision): Record<string, unknown> {
  const routerNote = `[Router ${new Date().toISOString().slice(0, 10)}] Level ${decision.level} (${decision.source}): ${decision.reason}`;
  const message = [sub.needs, sub.adoption_timeline && `Curriculum adoption: ${sub.adoption_timeline}`, sub.form_grades && `Grades: ${sub.form_grades}`, routerNote].filter(Boolean).join("\n\n");

  const fields: Record<string, unknown> = {
    Title: sub.job_title,
    isMQL__c: true,
    Inbound_Stage__c: "Delivered",
    UTM_Form_Last_Touch__c: sub.page_url || undefined,
    UTM_Source_Last_Touch__c: sub.utm_source || undefined,
    UTM_Medium_Last_Touch__c: sub.utm_medium || undefined,
    UTM_Campaign_Last_Touch__c: sub.utm_campaign || undefined,
    Inbound_Contact_Message__c: ctx.contact?.inboundMessage
      ? `${message}\n\n---\n${ctx.contact.inboundMessage}`.slice(0, 32000)
      : message,
    Contact_Source__c: addToMultiPicklist(ctx.contact?.contactSource, "Website"),
  };
  if (ROLE_VALUES.has(sub.job_title)) fields.Role__c = sub.job_title;
  if (isDecisionMaker(sub.job_title)) fields.Decision_Maker__c = true;
  // Only (re)open the inbound funnel when the contact isn't already being worked.
  const stage = ctx.contact?.usInboundStage;
  if (!stage || stage === "Closed") fields.US_Inbound_Stage__c = "New";

  for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
  return fields;
}

function addToMultiPicklist(current: string | null | undefined, value: string): string {
  const values = (current ?? "").split(";").filter(Boolean);
  return values.includes(value) ? values.join(";") : [...values, value].join(";");
}

/** US-relevant Role__c picklist values. The form's job_title options use these exact strings. */
export const ROLE_VALUES = new Set([
  "Teacher", "Assistant / Special Ed Teacher", "Interventionist", "MTSS Coordinator",
  "Instructional Coach", "Math Coach", "Math / Instructional Coach", "Math TOSA",
  "Principal", "Vice Principal", "Math / STEM Coordinator", "Curriculum Coordinator",
  "Math / STEM Director", "Math Director", "Curriculum Director", "Director of Teaching & Learning",
  "Director of Special Education", "Title I Director", "Chief Academic Officer",
  "Assistant Superintendent", "Assistant Superintendent - Instruction/Curriculum", "Superintendent",
  "District Administrator", "Parent or Homeschooler", "Other",
]);

// ---------------------------------------------------------------- live client

export function soqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function soqlLike(value: string): string {
  return soqlString(value).replace(/[%_]/g, (c) => `\\${c}`);
}

const GENERIC_WORDS = /\b(the|school|schools|district|public|unified|independent|consolidated|county|city|isd|usd|cusd|sd|no|#\d+|\d+)\b/g;

/** "[School District] Ajo Unified District (Ajo, AZ)" → "ajo". Same for what people type in the form. */
export function coreName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/\([^)]*\)\s*$/, "")
    .replace(GENERIC_WORDS, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DISTRICT_PREFIX = "[School District]";
const ACCOUNT_FIELDS = "Id, Name, Label__c, OwnerId, Owner.Name, ParentId, Parent.Name";

/** Pick one account only when the match is unambiguous. Districts (no parent) win over schools. */
export function pickAccount<T extends { Name: string; ParentId?: string | null }>(typed: string, accounts: T[]): T | undefined {
  if (accounts.length === 1) return accounts[0];
  const target = coreName(typed);
  const same = accounts.filter((a) => coreName(a.Name) === target);
  if (same.length === 1) return same[0];
  const districts = same.filter((a) => !a.ParentId);
  if (districts.length === 1) return districts[0];
  // "Port Chester" → "[School District] Port Chester-Rye Union Free School District (Port Chester, NY)".
  if (!target) return undefined;
  const containing = accounts.filter((a) => a.Name.startsWith(DISTRICT_PREFIX) && ` ${coreName(a.Name)} `.includes(` ${target} `));
  return containing.length === 1 ? containing[0] : undefined;
}

// Personal and internal domains say nothing about the district.
const NON_DISTRICT_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "comcast.net", "att.net", "verizon.net", "protonmail.com", "proton.me", "innovamat.com",
]);

/** "jane@portchesterschools.org" → "portchesterschools.org"; undefined for gmail and the like. */
export function emailDomain(email: string): string | undefined {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  return domain && !NON_DISTRICT_DOMAINS.has(domain) ? domain : undefined;
}

interface ColleagueRow {
  AccountId: string;
  Account?: { Name?: string; ParentId?: string | null; Parent?: { Name?: string; ParentId?: string | null; Parent?: { Name?: string } | null } | null };
}

/**
 * The district a colleague's account belongs to: climb through "[School District]" ancestors only,
 * so a NYC school lands on NYCPS (school → Geographic District → NYCPS) but a Texas district
 * never climbs into its Education Service Center.
 */
export function districtOf(c: ColleagueRow): string {
  const a = c.Account;
  const isDistrict = (name?: string) => Boolean(name?.startsWith(DISTRICT_PREFIX));
  if (a?.Parent?.ParentId && isDistrict(a.Parent.Parent?.Name)) return a.Parent.ParentId;
  if (a?.ParentId && isDistrict(a.Parent?.Name)) return a.ParentId;
  return c.AccountId;
}

/** The district most colleagues on the same email domain belong to, when they mostly agree. */
export function consensusDistrict(colleagues: ColleagueRow[]): string | undefined {
  const counts = new Map<string, number>();
  for (const c of colleagues) if (c.AccountId) counts.set(districtOf(c), (counts.get(districtOf(c)) ?? 0) + 1);
  const [top] = [...counts].sort((a, b) => b[1] - a[1]);
  return top && top[1] * 2 > colleagues.length ? top[0] : undefined;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function loginEnvelope(username: string, passwordWithToken: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com">
  <env:Body><urn:login><urn:username>${xmlEscape(username)}</urn:username><urn:password>${xmlEscape(passwordWithToken)}</urn:password></urn:login></env:Body>
</env:Envelope>`;
}

export function xmlTag(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`))?.[1];
}

class LiveSalesforce implements SalesforceClient {
  private token?: { accessToken: string; instanceUrl: string; expires: number };

  // SOAP login() with username + password + security token. The session ID it returns works
  // as a Bearer token for the REST API, so no Connected App is needed.
  private async auth() {
    if (this.token && this.token.expires > Date.now()) return this.token;
    const { loginUrl, username, password, securityToken, apiVersion } = config.salesforce;
    if (!username || !password) throw new Error("Salesforce env vars missing (SALESFORCE_USERNAME, SALESFORCE_PASSWORD, SALESFORCE_SECURITY_TOKEN)");
    const res = await fetch(`${loginUrl.replace(/\/$/, "")}/services/Soap/u/${apiVersion.replace(/^v/, "")}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: "login" },
      body: loginEnvelope(username, password + securityToken),
    });
    const xml = await res.text();
    if (!res.ok) throw new Error(`Salesforce auth failed: ${res.status} ${xmlTag(xml, "faultstring") ?? xml}`);
    const sessionId = xmlTag(xml, "sessionId");
    const serverUrl = xmlTag(xml, "serverUrl");
    if (!sessionId || !serverUrl) throw new Error("Salesforce auth failed: no session in login response");
    this.token = { accessToken: sessionId, instanceUrl: new URL(serverUrl).origin, expires: Date.now() + 50 * 60_000 };
    return this.token;
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { accessToken, instanceUrl } = await this.auth();
    const res = await fetch(`${instanceUrl}/services/data/${config.salesforce.apiVersion}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
    });
    if (!res.ok) throw new Error(`Salesforce ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status} ${await res.text()}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private async query<T>(soql: string): Promise<T[]> {
    const out = await this.api<{ records: T[] }>(`/query?q=${encodeURIComponent(soql)}`);
    return out.records;
  }

  /** Account via colleagues on the same email domain, or a district whose Website is that domain. */
  private async accountByDomain(domain: string): Promise<any | undefined> {
    const like = soqlLike(domain);
    const [colleagues, sites] = await Promise.all([
      this.query<ColleagueRow>(
        `SELECT AccountId, Account.Name, Account.ParentId, Account.Parent.Name, Account.Parent.ParentId, Account.Parent.Parent.Name
         FROM Contact WHERE Email LIKE '%@${like}' AND Account.Country__c = '${US}' AND Account.Label__c != 'TEST'
         ORDER BY LastModifiedDate DESC LIMIT 200`,
      ),
      this.query<{ Id: string }>(
        `SELECT Id FROM Account WHERE Website LIKE '%${like}%' AND Name LIKE '${soqlLike(DISTRICT_PREFIX)}%'
           AND Country__c = '${US}' AND Label__c != 'TEST' LIMIT 2`,
      ),
    ]);
    const id = consensusDistrict(colleagues) ?? (sites.length === 1 ? sites[0].Id : undefined);
    if (!id) return undefined;
    const [account] = await this.query<any>(`SELECT ${ACCOUNT_FIELDS} FROM Account WHERE Id = '${soqlString(id)}'`);
    return account;
  }

  async lookup(sub: Submission): Promise<SfContext> {
    const { instanceUrl } = await this.auth();
    const ctx: SfContext = { matchedBy: "none" };

    // Runs alongside the email lookup; a failure here just falls through to the name match.
    const domain = emailDomain(sub.email);
    const byDomain = domain ? this.accountByDomain(domain).catch(() => undefined) : Promise.resolve(undefined);

    const contacts = await this.query<any>(
      `SELECT Id, Owner.Name, US_Inbound_Stage__c, Inbound_Contact_Message__c, Contact_Source__c,
              AccountId, Account.Name, Account.Label__c, Account.OwnerId, Account.Owner.Name, Account.ParentId, Account.Parent.Name
       FROM Contact WHERE Email = '${soqlString(sub.email)}' AND Account.Label__c != 'TEST'
       ORDER BY LastModifiedDate DESC LIMIT 5`,
    );
    if (contacts[0]) {
      const c = contacts[0];
      ctx.matchedBy = "email";
      ctx.contact = {
        id: c.Id, ownerName: c.Owner?.Name, usInboundStage: c.US_Inbound_Stage__c,
        inboundMessage: c.Inbound_Contact_Message__c, contactSource: c.Contact_Source__c,
      };
      ctx.recordUrl = `${instanceUrl}/lightning/r/Contact/${c.Id}/view`;
      if (c.AccountId) {
        ctx.account = {
          id: c.AccountId, name: c.Account?.Name, label: c.Account?.Label__c, ownerId: c.Account?.OwnerId,
          ownerName: c.Account?.Owner?.Name, parentId: c.Account?.ParentId, parentName: c.Account?.Parent?.Name,
        };
      }
    }

    // "Port Chester" or a school name won't always match an account, but colleagues on the same domain will.
    if (!ctx.account) {
      const acct = await byDomain;
      if (acct) {
        if (ctx.matchedBy === "none") ctx.matchedBy = "email-domain";
        ctx.account = {
          id: acct.Id, name: acct.Name, label: acct.Label__c, ownerId: acct.OwnerId,
          ownerName: acct.Owner?.Name, parentId: acct.ParentId, parentName: acct.Parent?.Name,
        };
      }
    }

    if (!ctx.account) {
      const select = `SELECT ${ACCOUNT_FIELDS} FROM Account`;
      const scope = `Country__c = '${US}' AND Label__c != 'TEST'`;
      let accounts = await this.query<any>(
        `${select} WHERE Name LIKE '%${soqlLike(sub.school)}%' AND ${scope} ORDER BY ParentId NULLS FIRST, Name LIMIT 10`,
      );
      // "Ajo Unified School District" vs "[School District] Ajo Unified District (Ajo, AZ)": retry on the first distinctive word.
      const keyword = coreName(sub.school).split(" ")[0];
      if (!accounts.length && keyword) {
        accounts = await this.query<any>(
          `${select} WHERE Name LIKE '%${soqlLike(keyword)}%' AND ${scope} ORDER BY ParentId NULLS FIRST, Name LIMIT 10`,
        );
      }
      const pick = pickAccount(sub.school, accounts);
      if (pick) {
        if (ctx.matchedBy === "none") ctx.matchedBy = "account-name";
        ctx.account = {
          id: pick.Id, name: pick.Name, label: pick.Label__c, ownerId: pick.OwnerId,
          ownerName: pick.Owner?.Name, parentId: pick.ParentId, parentName: pick.Parent?.Name,
        };
      } else if (accounts.length) {
        ctx.accountCandidates = accounts.map((a) => a.Name);
      }
    }

    if (ctx.account) {
      const ids = [ctx.account.id, ctx.account.parentId].filter(Boolean).map((id) => `'${id}'`).join(",");
      const opps = await this.query<any>(
        `SELECT Id, StageName, OwnerId, Owner.Name, Type_of_Sale__c FROM Opportunity
         WHERE AccountId IN (${ids}) AND RecordType.Name = 'US NB Opportunity'
           AND Is_Current_Campaign_Deal__c = TRUE AND IsClosed = FALSE
         ORDER BY LastModifiedDate DESC LIMIT 1`,
      );
      if (opps[0]) {
        const o = opps[0];
        ctx.openOpportunity = { id: o.Id, stage: o.StageName, ownerId: o.OwnerId, ownerName: o.Owner?.Name, typeOfSale: o.Type_of_Sale__c };
      }
    }
    return ctx;
  }

  async upsertContact(sub: Submission, ctx: SfContext, decision: Decision): Promise<WriteResult> {
    const fields = buildContactFields(sub, ctx, decision);
    const live = config.salesforce.writeMode === "live";

    if (ctx.contact) {
      if (!live) return { action: "would-update", contactId: ctx.contact.id, payload: fields };
      await this.api(`/sobjects/Contact/${ctx.contact.id}`, { method: "PATCH", body: JSON.stringify(fields) });
      return { action: "updated", contactId: ctx.contact.id };
    }

    if (!ctx.account) {
      return { action: "skipped", note: "No confident account match. Contact not created; link it by hand." };
    }

    const create: Record<string, unknown> = {
      ...fields,
      FirstName: sub.name,
      LastName: sub.surname,
      Email: sub.email,
      Phone: sub.phone_number || undefined,
      AccountId: ctx.account.id,
      Country__c: US,
      Key_Contact__c: false,
    };
    if (config.salesforce.defaultOwnerId) create.OwnerId = config.salesforce.defaultOwnerId;
    for (const k of Object.keys(create)) if (create[k] === undefined) delete create[k];

    if (!live) return { action: "would-create", payload: create };
    const res = await this.api<{ id: string }>(`/sobjects/Contact`, { method: "POST", body: JSON.stringify(create) });
    const { instanceUrl } = await this.auth();
    ctx.recordUrl = `${instanceUrl}/lightning/r/Contact/${res.id}/view`;
    return { action: "created", contactId: res.id };
  }
}

// ---------------------------------------------------------------- mock client

const MOCK_ACCOUNTS: NonNullable<SfContext["account"]>[] = [
  { id: "001MOCK0001", name: "Oak Grove School District", label: null, ownerName: "Luis Acevedo" },
  { id: "001MOCK0002", name: "Lakeview County Schools", label: null, ownerName: "Luis Acevedo" },
  { id: "001MOCK0003", name: "Riverside Unified", label: null, ownerName: "Luis Acevedo" },
  { id: "001MOCK0004", name: "Maplewood Public Schools", label: "CUSTOMER", ownerName: "Sample KAM" },
  { id: "001MOCK0005", name: "Cedar Falls ISD", label: null, ownerName: "Luis Acevedo" },
];

class MockSalesforce implements SalesforceClient {
  async lookup(sub: Submission): Promise<SfContext> {
    await new Promise((r) => setTimeout(r, 300));
    const account = MOCK_ACCOUNTS.find((a) => a.name.toLowerCase() === sub.school.toLowerCase());
    const ctx: SfContext = { matchedBy: account ? "account-name" : "none", account };
    if (sub.email === "existing@example.org") {
      ctx.matchedBy = "email";
      ctx.contact = { id: "003MOCK0001", ownerName: "Luis Acevedo", usInboundStage: "Engaged", contactSource: "Email" };
    }
    if (account?.name === "Cedar Falls ISD") {
      ctx.openOpportunity = { id: "006MOCK0001", stage: "Discovery", ownerName: "Sample AE", typeOfSale: "Supplement" };
    }
    ctx.recordUrl = "https://example.invalid/mock-salesforce";
    return ctx;
  }

  async upsertContact(sub: Submission, ctx: SfContext, decision: Decision): Promise<WriteResult> {
    const fields = buildContactFields(sub, ctx, decision);
    if (ctx.contact) return { action: "would-update", contactId: ctx.contact.id, payload: fields };
    if (!ctx.account) return { action: "skipped", note: "No confident account match (mock)." };
    return { action: "would-create", payload: { ...fields, FirstName: sub.name, LastName: sub.surname, Email: sub.email, AccountId: ctx.account.id } };
  }
}

export function createSalesforce(): SalesforceClient {
  return config.mock.salesforce ? new MockSalesforce() : new LiveSalesforce();
}
