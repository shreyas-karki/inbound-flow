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
  needs: z.string().trim().optional().default(""), // TODO: confirm field ID with RevOps
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

export type Level = 1 | 2 | 3;

export interface SfContext {
  matchedBy: "email" | "account-name" | "none";
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
  };
  openOpportunity?: { id: string; stage: string; ownerId?: string; ownerName?: string; typeOfSale?: string };
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
  account?: AccountScore; // undefined = not in the target market, or lookup failed
  source: "stub" | "starbridge" | "timeout" | "error";
}

export interface Decision {
  level: Level;
  route: "email" | "bdr" | "gm" | "owner";
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

export interface NextStep {
  type: "thanks" | "calendar";
  host?: string;
  url?: string;
  message: string;
}
