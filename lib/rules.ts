import { rulesConfig } from "./config";
import type { Decision, SfContext, Submission } from "./types";

/** Clear-cut cases decided without AI. Returns null when Claude should score. */
export function applyRules(sub: Submission, sf: SfContext): Decision | null {
  const label = sf.account?.label?.toUpperCase();
  if (label && rulesConfig.customerLabels.includes(label)) {
    return {
      level: 3,
      route: "owner",
      ownerName: sf.account?.ownerName,
      reason: `Existing customer (${sf.account?.name}, ${label}). Routed to account owner.`,
      source: "rules",
    };
  }

  if (sf.openOpportunity) {
    return {
      level: 3,
      route: "owner",
      ownerName: sf.openOpportunity.ownerName,
      reason: `Open US NB deal in stage ${sf.openOpportunity.stage}. Routed to deal owner.`,
      source: "rules",
    };
  }

  if (sub.country && !rulesConfig.servedCountries.includes(sub.country)) {
    return { level: 1, route: "email", reason: `Outside served markets (${sub.country}).`, source: "rules" };
  }

  if (rulesConfig.level1Roles.includes(sub.job_title)) {
    return { level: 1, route: "email", reason: `Role "${sub.job_title}" is not a buyer.`, source: "rules" };
  }

  return null;
}

export function isDecisionMaker(role: string): boolean {
  return rulesConfig.decisionMakerRoles.includes(role);
}

export function routeForLevel(level: 1 | 2 | 3): Decision["route"] {
  return level === 3 ? "gm" : level === 2 ? "bdr" : "email";
}
