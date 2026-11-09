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
  // When Make acts, it also reads Salesforce and hands it over on /api/tier (lib/handoff.ts). The page waits
  // this long for that handoff, alongside Starbridge, before deciding without it.
  handoffWaitMs: Number(env("HANDOFF_WAIT_MS", "6000")),
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
    "Director of Early Childhood Education",
    "Math / STEM Director",
    "Math Director",
    "Math / STEM Coordinator",
    "Curriculum Coordinator",
    "MTSS Coordinator",
    "Title I Director",
    "Director of Special Education",
    "Vice Principal",
  ],
  // GM fast lane: anyone who isn't a teacher goes straight to a First Touch when the district is
  // hot, sizable and adopting soon. Everything else is scored by Claude with prompts/rubric.md.
  firstTouch: {
    signalBands: ["Hot"], // Starbridge signal band
    minEnrollment: 5000, // "sizable": Starbridge total enrollment
    adoptionTimelines: ["SY26-27", "SY27-28"], // the form's adoption answer
  },
  // A First Touch costs a growth manager an hour, so small or low-scoring districts get a BDR Discovery instead,
  // whoever asks. Size is the district's Total PARR in Salesforce; Starbridge enrollment stands in only when
  // Salesforce has no PARR. Either check caps the lead at Level 2. Missing data never caps.
  firstTouchFloor: {
    // Salesforce Total PARR, USD. US First Touches Aug 2025-Oct 2026: $20-30k districts won 2 of 34,
    // $30-40k won 7 of 42 (as well as any band above it).
    minParr: 30000,
    minEnrollment: 650, // ~$30k PARR at ~$46 per student; used only without PARR
    minScore: 50, // Starbridge account score, 0-100
  },
  // These roles always get the growth manager's calendar at a district that clears the size floor above
  // ($30k+ PARR, or 650+ students without PARR), with or without a WHY NOW, and whatever the Starbridge score.
  // Kearny, NJ (Nov 2): a Curriculum Director at $209,720 PARR adopting SY28-29 got a BDR Discovery instead.
  directorFirstTouch: {
    roles: ["Curriculum Director"],
  },
  // A very large district always enters the funnel: anyone there who would only get the Level 1 email
  // (a teacher with no signal, say) gets a BDR Discovery instead. Level 0 non-buyers stay Level 0.
  largeDistrict: {
    minParr: 500000, // Salesforce Total PARR, USD
  },
  // Coaches and TOSAs work across classrooms and sit close to curriculum decisions: they can always
  // book a Discovery, and a First Touch when the district is hot.
  coachRoles: [
    "Instructional Coach",
    "Math Coach",
    "Math / Instructional Coach",
    "Math TOSA",
  ],
  endUserRoles: [
    "Teacher",
    "Assistant / Special Ed Teacher",
    "Interventionist",
  ],
};
