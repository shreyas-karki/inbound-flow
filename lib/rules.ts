import { rulesConfig } from "./config";
import type { Decision, Level, RoleGroup, SfContext, StarbridgeResult, Submission } from "./types";

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
    return { level: 0, route: "email", reason: `Outside served markets (${sub.country}).`, source: "rules" };
  }

  if (rulesConfig.level0Roles.includes(sub.job_title)) {
    return { level: 0, route: "email", reason: `Role "${sub.job_title}" is not a buyer.`, source: "rules" };
  }

  return null;
}

export function isDecisionMaker(role: string): boolean {
  return rulesConfig.decisionMakerRoles.includes(role);
}

export function roleGroup(role: string): RoleGroup {
  if (rulesConfig.decisionMakerRoles.includes(role)) return "decision_maker";
  if (rulesConfig.championRoles.includes(role)) return "champion";
  if (rulesConfig.endUserRoles.includes(role)) return "end_user";
  return "other";
}

/** "Hot district": Starbridge says it is active now. */
export function isHotDistrict(sb: StarbridgeResult): boolean {
  const a = sb.account;
  return Boolean(a && (["Hot", "Warm"].includes(a.signalBand) || a.score >= 70));
}

export function adoptingSoon(sub: Submission): boolean {
  return /SY26-27|SY27-28/.test(sub.adoption_timeline);
}

/** NYC public schools buy at building level, so the principal / AP is who a teacher should loop in. */
export function isNyc(sub: Submission, sf: SfContext): boolean {
  const names = [sub.school, sf.account?.name, sf.account?.parentName].filter(Boolean).join(" | ");
  return /\bNYC\b|New York City|\bNYCDOE\b|\bP\.?S\.? ?\d+|\bI\.?S\.? ?\d+|\bM\.?S\.? ?\d+/i.test(names);
}

export function routeForLevel(level: Level): Decision["route"] {
  return level === 3 ? "gm" : level === 2 ? "bdr" : "email";
}

export function meetingForLevel(level: Level): Decision["meeting"] {
  return level === 3 ? "first_touch" : level === 2 ? "discovery" : undefined;
}
