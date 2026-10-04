import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

/** One client for scoring and drafting. User-level keys need the workspace header on every call. */
export function claudeClient(): Anthropic {
  const { workspaceId } = config.anthropic;
  return new Anthropic(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {});
}
