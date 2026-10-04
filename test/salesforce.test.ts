import { describe, expect, it } from "vitest";
import { buildContactFields, soqlString } from "../lib/salesforce";
import { SubmissionSchema } from "../lib/types";

const sub = SubmissionSchema.parse({
  name: "Dana", surname: "W", email: "d@x.org", job_title: "Curriculum Director", school: "Lakeview",
  needs: "District-wide review", utm_source: "google", utm_campaign: "mj_fall", page_url: "https://x/mj",
});
const decision = { level: 3 as const, route: "gm" as const, reason: "district lead", source: "claude" as const };

describe("buildContactFields", () => {
  it("mirrors the Make integration fields and adds UTMs", () => {
    const f = buildContactFields(sub, { matchedBy: "none" }, decision);
    expect(f).toMatchObject({
      US_Inbound_Stage__c: "New", isMQL__c: true, Inbound_Stage__c: "Delivered",
      Role__c: "Curriculum Director", Decision_Maker__c: true, Contact_Source__c: "Website",
      UTM_Source_Last_Touch__c: "google", UTM_Campaign_Last_Touch__c: "mj_fall", UTM_Form_Last_Touch__c: "https://x/mj",
    });
    expect(f.Inbound_Contact_Message__c).toContain("Level 3");
  });

  it("does not reset the funnel stage of a contact already being worked", () => {
    const f = buildContactFields(sub, { matchedBy: "email", contact: { id: "1", usInboundStage: "Engaged", contactSource: "Email" } }, decision);
    expect(f.US_Inbound_Stage__c).toBeUndefined();
    expect(f.Contact_Source__c).toBe("Email;Website");
  });

  it("skips Role__c when the job title isn't a picklist value", () => {
    const f = buildContactFields({ ...sub, job_title: "Wizard" }, { matchedBy: "none" }, decision);
    expect(f.Role__c).toBeUndefined();
  });

  it("escapes SOQL strings", () => {
    expect(soqlString("O'Brien \\ Co")).toBe("O\\'Brien \\\\ Co");
  });
});

describe("account matching", async () => {
  const { coreName, pickAccount } = await import("../lib/salesforce");
  it("normalizes Salesforce district names and typed names to the same core", () => {
    expect(coreName("[School District] Ajo Unified District (Ajo, AZ)")).toBe("ajo");
    expect(coreName("Ajo Unified School District")).toBe("ajo");
  });
  it("picks the district when names match, and nothing when ambiguous", () => {
    const accts = [
      { Name: "[School District] Ajo Unified District (Ajo, AZ)", ParentId: null },
      { Name: "[School] Ajo Elementary (Ajo, AZ)", ParentId: "x" },
    ];
    expect(pickAccount("Ajo Unified", accts)?.Name).toContain("Ajo Unified District");
    expect(pickAccount("Springfield", [{ Name: "Springfield A" }, { Name: "Springfield B" }])).toBeUndefined();
  });
});

describe("login", async () => {
  const { loginEnvelope, xmlTag } = await import("../lib/salesforce");
  it("escapes credentials in the SOAP envelope", () => {
    const xml = loginEnvelope("a@b.com", "p<&>'\"token");
    expect(xml).toContain("<urn:password>p&lt;&amp;&gt;&apos;&quot;token</urn:password>");
  });
  it("reads tags with or without a namespace prefix", () => {
    expect(xmlTag("<result><sessionId>00D!abc</sessionId></result>", "sessionId")).toBe("00D!abc");
    expect(xmlTag("<soapenv:faultstring>INVALID_LOGIN</soapenv:faultstring>", "faultstring")).toBe("INVALID_LOGIN");
  });
});
