import { rulesConfig } from "./config";
import type { Decision, Level, RoleGroup, SfContext, StarbridgeResult, Submission } from "./types";

/** Clear-cut cases decided without AI. Returns null when Claude should score. */
export function applyRules(sub: Submission, sf: SfContext, sb?: StarbridgeResult): Decision | null {
  if (sf.existingOwner) {
    const name = sf.existingOwner.name ?? "the account owner";
    return { level: 3, route: "owner", ownerName: sf.existingOwner.name, reason: `${sf.existingOwner.why}. Routed to ${name}.`, source: "rules" };
  }

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

  // GM fast lane: a hot, sizable district adopting soon, and anyone there who isn't a teacher.
  const a = sb?.account;
  const { signalBands, minEnrollment, adoptionTimelines } = rulesConfig.firstTouch;
  const group = roleGroup(sub.job_title);
  if (
    a && group !== "end_user" && group !== "other" &&
    signalBands.includes(a.signalBand) && (a.enrollment ?? 0) >= minEnrollment &&
    adoptionTimelines.includes(sub.adoption_timeline)
  ) {
    return {
      level: 3,
      route: "gm",
      reason: `${sub.job_title} at a ${a.signalBand.toLowerCase()} district (${a.enrollment!.toLocaleString("en-US")} students) adopting ${sub.adoption_timeline}: First Touch.`,
      source: "rules",
    };
  }

  return null;
}

/** Runs after rules and Claude: a First Touch at a small or low-scoring district becomes a BDR Discovery. */
export function capFirstTouch(decision: Decision, sf: SfContext, sb: StarbridgeResult): Decision {
  if (decision.route !== "gm") return decision;
  const { minParr, minEnrollment, minScore } = rulesConfig.firstTouchFloor;
  const parr = sf.account?.parr;
  const enrollment = sb.account?.enrollment;
  const why = [
    parr !== undefined && parr < minParr && `$${Math.round(parr).toLocaleString("en-US")} PARR`,
    parr === undefined && enrollment !== undefined && enrollment < minEnrollment && `${enrollment.toLocaleString("en-US")} students`,
    sb.account && sb.account.score < minScore && `Starbridge score ${sb.account.score}`,
  ].filter(Boolean).join(", ");
  if (!why) return decision;
  return { ...decision, level: 2, route: "bdr", meeting: "discovery", reason: `${decision.reason} Capped at Discovery: ${why}.` };
}

/** Runs after the First Touch floor: a Level 1 lead at a very large district becomes a BDR Discovery. */
export function liftLargeDistrict(decision: Decision, sf: SfContext): Decision {
  const parr = sf.account?.parr;
  if (decision.level !== 1 || parr === undefined || parr < rulesConfig.largeDistrict.minParr) return decision;
  return { ...decision, level: 2, route: "bdr", meeting: "discovery", reason: `${decision.reason} Lifted to Discovery: very large district ($${Math.round(parr).toLocaleString("en-US")} PARR).` };
}

/** Innovamat staff testing the form: scored like a real lead, but flagged and never written to Salesforce. */
export function isInternalTest(email: string): boolean {
  return /@innovamat\.com$/i.test(email.trim());
}

export function isDecisionMaker(role: string): boolean {
  return rulesConfig.decisionMakerRoles.includes(role);
}

export function roleGroup(role: string): RoleGroup {
  if (rulesConfig.decisionMakerRoles.includes(role)) return "decision_maker";
  if (rulesConfig.championRoles.includes(role)) return "champion";
  if (rulesConfig.coachRoles.includes(role)) return "coach";
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
