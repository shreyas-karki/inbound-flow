// Everything a non-engineer might want to tune lives here or in prompts/.

const env = (key: string, fallback = "") => process.env[key]?.trim() || fallback;

const mockMode = env("MOCK_MODE", "true") === "true";
// Each service can be switched on by itself, e.g. live Starbridge while Salesforce stays mocked.
const mock = (key: string) => env(key, String(mockMode)) === "true";

export const config = {
  mockMode,
  mock: {
    salesforce: mock("MOCK_SALESFORCE"),
    starbridge: mock("MOCK_STARBRIDGE"),
    claude: mock("MOCK_CLAUDE"),
  },

  salesforce: {
    // Username + password + security token login (no Connected App needed).
    loginUrl: env("SALESFORCE_LOGIN_URL", "https://login.salesforce.com"),
    username: env("SALESFORCE_USERNAME"),
    password: env("SALESFORCE_PASSWORD"),
    securityToken: env("SALESFORCE_SECURITY_TOKEN"),
    apiVersion: env("SF_API_VERSION", "v62.0"),
    // "dry-run" reads real data but only logs the writes it would make.
    // Switch to "live" once you've checked a few dry runs.
    writeMode: env("SF_WRITE_MODE", "dry-run") as "dry-run" | "live",
    // Owner for newly created inbound contacts (today the Make flow assigns most to Luis).
    defaultOwnerId: env("SF_DEFAULT_OWNER_ID"),
  },

  anthropic: {
    model: env("CLAUDE_MODEL", "claude-sonnet-5-5"),
    timeoutMs: Number(env("SCORING_TIMEOUT_MS", "6000")),
    // Needed for user-level keys (sk-ant-usr-…) that aren't scoped to one workspace.
    workspaceId: env("ANTHROPIC_WORKSPACE_ID"),
    // The reply draft runs after the page has responded, so it can take longer.
    draftTimeoutMs: Number(env("DRAFT_TIMEOUT_MS", "30000")),
  },

  starbridge: {
    apiKey: env("STARBRIDGE_API_KEY"),
    // Its district search often takes 5-7 seconds. It runs alongside Salesforce when the form has a state.
    timeoutMs: Number(env("STARBRIDGE_TIMEOUT_MS", "6000")),
  },

  slack: {
    webhookUrl: env("SLACK_WEBHOOK_URL"),
  },

  routing: {
    // Who signs the AI SDR reply and whose inbox the draft is meant for.
    replyFromName: env("REPLY_FROM_NAME", env("BDR_NAME", "Luis")),
    replyFromEmail: env("REPLY_FROM_EMAIL"),
    // Fallbacks for when the routing sheet has no row or link for the lead's state.
    bdrName: env("BDR_NAME", "Luis"),
    bdrBookingUrl: env("BDR_BOOKING_URL"),
    gmName: env("GM_NAME", "Growth Manager"),
    gmBookingUrl: env("GM_BOOKING_URL"),
  },

  // "US - Mapping Owners for Inbounds", each tab published to the web as CSV. See lib/calendars.ts.
  sheets: {
    mappingCsvUrl: env("SHEET_MAPPING_CSV_URL"),
    calendarsCsvUrl: env("SHEET_CALENDARS_CSV_URL"),
    ftOwnersCsvUrl: env("SHEET_FT_OWNERS_CSV_URL"),
  },

  // Who acts on a decision. "app": this app writes Salesforce, posts to Slack and drafts the AI reply.
  // "make": the Make scenario does all of that from /api/tier's answer, and this app only decides and logs.
  actionsOwner: (env("ACTIONS_OWNER", "app") === "make" ? "make" : "app") as "app" | "make",
  // Shared secret Make sends in the x-inbound-secret header. /api/tier refuses every call when unset.
  tierSecret: env("TIER_SECRET"),

  // Upstash Redis from the Vercel Marketplace (it sets one of these pairs). Unset: in-memory, one instance only.
  redis: {
    url: env("KV_REST_API_URL", env("UPSTASH_REDIS_REST_URL")),
    token: env("KV_REST_API_TOKEN", env("UPSTASH_REDIS_REST_TOKEN")),
  },
};

// Hard rules that run before Claude. Edit freely.
export const rulesConfig = {
  // Account.Label__c values that mean "already a customer": route to the account owner, not a BDR.
  customerLabels: ["CUSTOMER", "NEW CUSTOMER"],
  // Countries we sell Thinking Math into. Anything else is Level 0.
  servedCountries: ["United States of America", "Canada"],
  // Roles that never buy a district curriculum: Level 0. Values are Salesforce Role__c picklist values.
  level0Roles: ["Parent or Homeschooler", "Press", "Politician", "University", "Consultant / Advisor"],
  // Who is who, from the US deal-stage framework. Decision makers with a WHY NOW get a First Touch (Level 3,
  // growth manager); so do champions running an active review. Other champions get a Discovery (Level 2, BDR).
  // End users get a Discovery only with an evaluation signal or a hot district (their adoption answer alone
  // doesn't count); otherwise Level 1 asks them to loop in a principal / AP / district contact.
  decisionMakerRoles: [
    "Superintendent",
    "Assistant Superintendent",
    "Assistant Superintendent - Instruction/Curriculum",
    "Assistant Superintendent - Teaching and Learning",
    "Chief Academic Officer",
    "Curriculum Director",
    "Director of Teaching & Learning",
    "District Administrator",
    "Principal", // decision maker for a single building (NYC schools buy at building level)
  ],
  championRoles: [
    "Math / STEM Director",
    "Math Director",
    "Math / STEM Coordinator",
    "Curriculum Coordinator",
    "MTSS Coordinator",
    "Title I Director",
    "Director of Special Education",
    "Vice Principal",
  ],
  endUserRoles: [
    "Teacher",
    "Assistant / Special Ed Teacher",
    "Interventionist",
    "Instructional Coach",
    "Math Coach",
    "Math / Instructional Coach",
    "Math TOSA",
  ],
};
