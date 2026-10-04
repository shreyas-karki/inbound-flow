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
    model: env("CLAUDE_MODEL", "claude-opus-5-5"),
    timeoutMs: Number(env("SCORING_TIMEOUT_MS", "6000")),
    // Needed for user-level keys (sk-ant-usr-…) that aren't scoped to one workspace.
    workspaceId: env("ANTHROPIC_WORKSPACE_ID"),
    // The reply draft runs after the page has responded, so it can take longer.
    draftTimeoutMs: Number(env("DRAFT_TIMEOUT_MS", "30000")),
  },

  starbridge: {
    apiKey: env("STARBRIDGE_API_KEY"),
    timeoutMs: Number(env("STARBRIDGE_TIMEOUT_MS", "3000")),
  },

  slack: {
    webhookUrl: env("SLACK_WEBHOOK_URL"),
  },

  routing: {
    // Who signs the AI SDR reply and whose inbox the draft is meant for.
    replyFromName: env("REPLY_FROM_NAME", env("BDR_NAME", "Luis")),
    replyFromEmail: env("REPLY_FROM_EMAIL"),
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
  // Countries we sell Thinking Math into. Anything else goes to Level 1.
  servedCountries: ["United States of America", "Canada"],
  // Roles that are never a sales conversation. Values are Salesforce Role__c picklist values.
  level1Roles: ["Parent or Homeschooler", "Press", "Politician", "University", "Consultant / Advisor"],
  // Who is who, from the US deal-stage framework. Only a decision maker gets a First Touch (Level 3, growth
  // manager). Champions get a Discovery (Level 2, BDR). End users get a Discovery only when the district is
  // hot or adopting soon; otherwise Level 1 asks them to loop in a principal / AP / district contact.
  // A meeting with a Math Coordinator or Curriculum Supervisor is a champion meeting, not a First Touch.
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
