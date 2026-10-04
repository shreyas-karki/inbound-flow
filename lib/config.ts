// Everything a non-engineer might want to tune lives here or in prompts/.

const env = (key: string, fallback = "") => process.env[key]?.trim() || fallback;

export const config = {
  mockMode: env("MOCK_MODE", "true") === "true",

  salesforce: {
    loginUrl: env("SF_LOGIN_URL"), // e.g. https://innovamat.my.salesforce.com
    clientId: env("SF_CLIENT_ID"),
    clientSecret: env("SF_CLIENT_SECRET"),
    apiVersion: env("SF_API_VERSION", "v62.0"),
    // "dry-run" reads real data but only logs the writes it would make.
    // Switch to "live" once you've checked a few dry runs.
    writeMode: env("SF_WRITE_MODE", "dry-run") as "dry-run" | "live",
    // Owner for newly created inbound contacts (today the Make flow assigns most to Luis).
    defaultOwnerId: env("SF_DEFAULT_OWNER_ID"),
  },

  anthropic: {
    model: env("CLAUDE_MODEL", "claude-opus-5-5"),
    timeoutMs: Number(env("SCORING_TIMEOUT_MS", "6000")),
  },

  starbridge: {
    apiKey: env("STARBRIDGE_API_KEY"),
    timeoutMs: Number(env("STARBRIDGE_TIMEOUT_MS", "3000")),
  },

  slack: {
    webhookUrl: env("SLACK_WEBHOOK_URL"),
  },

  routing: {
    bdrName: env("BDR_NAME", "Luis"),
    bdrBookingUrl: env("BDR_BOOKING_URL"),
    gmName: env("GM_NAME", "Growth Manager"),
    gmBookingUrl: env("GM_BOOKING_URL"),
  },
};

// Hard rules that run before Claude. Edit freely.
export const rulesConfig = {
  // Account.Label__c values that mean "already a customer": route to the account owner, not a BDR.
  customerLabels: ["CUSTOMER", "NEW CUSTOMER"],
  // Countries we sell Math Journeys into. Anything else goes to Level 1.
  servedCountries: ["United States of America", "Canada"],
  // Roles that are never a sales conversation. Values are Salesforce Role__c picklist values.
  level1Roles: ["Parent or Homeschooler", "Press", "Politician", "University", "Consultant / Advisor"],
  // Roles that count as a decision maker (sets Decision_Maker__c = true).
  decisionMakerRoles: [
    "Superintendent",
    "Assistant Superintendent",
    "Assistant Superintendent - Instruction/Curriculum",
    "Assistant Superintendent - Teaching and Learning",
    "Chief Academic Officer",
    "Curriculum Director",
    "Director of Teaching & Learning",
    "Math / STEM Director",
    "Math Director",
    "Title I Director",
  ],
};
