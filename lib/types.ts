import { z } from "zod";

// Field IDs match the RevOps form table. Don't rename without RevOps.
export const SubmissionSchema = z.object({
  name: z.string().trim().min(1),
  surname: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  phone_number: z.string().trim().optional().default(""),
  job_title: z.string().trim().min(1),
  school: z.string().trim().min(1),
  country: z.string().trim().optional().default("United States of America"),
  form_grades: z.string().trim().optional().default(""),
  needs: z.string().trim().optional().default(""), // the form's free-text "message" box
  state: z.string().trim().optional().default(""), // "NY" or "New York"; picks the BDR and First Touch owner
  // "When is your district planning to adopt a new math curriculum?"
  // (Unbounce ID: when_is_your_district_planning_to_adopt_a_new_math_curriculum)
  adoption_timeline: z.string().trim().optional().default(""),
  utm_source: z.string().optional().default(""),
  utm_medium: z.string().optional().default(""),
  utm_campaign: z.string().optional().default(""),
  utm_content: z.string().optional().default(""),
  utm_term: z.string().optional().default(""),
  page_url: z.string().optional().default(""),
  // Bot checks: honeypot must stay empty; form_started_at is set when the page loads.
  website: z.string().optional().default(""),
  form_started_at: z.coerce.number().optional(),
});
export type Submission = z.infer<typeof SubmissionSchema>;

export type Level = 0 | 1 | 2 | 3;

export interface SfContext {
  matchedBy: "email" | "email-domain" | "account-name" | "none";
  contact?: {
    id: string;
    ownerName?: string;
    usInboundStage?: string | null;
    inboundMessage?: string | null;
    contactSource?: string | null;
  };
  account?: {
    id: string;
    name: string;
    label?: string | null;
    ownerId?: string;
    ownerName?: string;
    parentId?: string | null;
    parentName?: string | null;
    parr?: number; // Total PARR (USD) of the lead's district: Total_PARR__c, the "Total Account PARR" in Slack
  };
  openOpportunity?: { id: string; stage: string; ownerId?: string; ownerName?: string; typeOfSale?: string };
  // From Make's check (lib/handoff.ts): an active deal, open renewal or recent Closed Won on the school, district or contact's account.
  existingOwner?: { id?: string; name?: string; why: string; oppId?: string; stage?: string };
  source?: "make" | "app"; // who read Salesforce; unset means the app's own lookup
  accountCandidates?: string[]; // when the district name was ambiguous
  recordUrl?: string;
}

export interface AccountScore {
  score: number; // 0-100
  fitBand: string; // Weak | Moderate | Strong | Ideal
  signalBand: string; // NoSignals | Blocked | Cool | Warm | Hot
  fitSummary?: string;
  signalSummary?: string;
  competitors: string[];
  enrollment?: number;
  mathProficiencyPct?: number;
  propensityToSpend?: string;
}

export interface StarbridgeResult {
  buyerName?: string; // the Starbridge buyer the district matched
  stateCode?: string; // e.g. "NY"; picks the state-specific line in the reply
  account?: AccountScore; // undefined = not in the target market, or lookup failed
  source: "stub" | "starbridge" | "timeout" | "error";
}

export type RoleGroup = "decision_maker" | "champion" | "coach" | "end_user" | "other";

export interface Decision {
  level: Level;
  // "gm" = Level 3 First Touch, booked with the state's First Touch owner (ft_owners tab).
  route: "email" | "bdr" | "gm" | "owner";
  // Level 3 = First Touch with a decision maker. Level 2 = Discovery (BDR).
  meeting?: "first_touch" | "discovery";
  reason: string;
  source: "rules" | "claude" | "fallback";
  ownerName?: string;
}

export interface WriteResult {
  action: "created" | "updated" | "skipped" | "would-create" | "would-update";
  contactId?: string;
  note?: string;
  payload?: Record<string, unknown>;
}

/** Who follows up on a lead. userId is a Salesforce User Id, for Make to set as the Contact and Task owner. */
export interface Host {
  name: string;
  userId?: string;
  bookingUrl?: string; // raw sheet link; nextStep() makes it embeddable
  alsoAdd: string[]; // First Touch: people to add to the call
  source: "first_touch_sheet" | "bdr_sheet" | "salesforce" | "env";
}

export interface NextStep {
  type: "thanks" | "calendar";
  host?: string;
  url?: string;
  message: string;
}

/** The AI SDR's reply, ready to paste into Gmail. */
export interface ReplyDraft {
  to: string;
  subject: string;
  body: string;
  source: "claude" | "template";
  gmailUrl: string; // opens a pre-filled Gmail compose window; Gmail saves it as a draft
}
