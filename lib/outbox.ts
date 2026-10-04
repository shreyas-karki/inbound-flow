// Prototype inbox: the last 50 processed leads, kept in memory and served at /inbox by the dev server.
// Stands in for Slack + Gmail until those are connected. Resets on restart; not shared across Vercel instances.
import type { Decision, ReplyDraft, StarbridgeResult, Submission, WriteResult } from "./types";

export interface OutboxEntry {
  at: string;
  lead: Pick<Submission, "name" | "surname" | "email" | "job_title" | "school" | "adoption_timeline" | "needs">;
  decision: Decision;
  starbridge: string;
  signals?: string;
  salesforce: WriteResult["action"];
  draft?: ReplyDraft;
  draftError?: string;
}

const entries: OutboxEntry[] = [];

export function addToOutbox(entry: OutboxEntry) {
  entries.unshift(entry);
  entries.length = Math.min(entries.length, 50);
}

export function listOutbox(): OutboxEntry[] {
  return entries;
}
