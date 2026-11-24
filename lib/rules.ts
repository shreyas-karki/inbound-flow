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

  const gm = gmRoleDecision(sub, sf, sb);
  if (gm) return gm;

  // GM fast lane: a champion outside gmRoles at a hot, sizable district adopting soon.
  const a = sb?.account;
  const { signalBands, minEnrollment, adoptionTimelines } = rulesConfig.firstTouch;
  if (
    a && roleGroup(sub.job_title) === "champion" && !isBuildingLeader(sub.job_title) &&
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

/**
 * The district's size as the First Touch floor measures it: Salesforce Total PARR, or Starbridge students only when
 * Salesforce has no PARR. Undefined with neither.
 */
function districtSize(sf: SfContext, sb?: StarbridgeResult): { label: string; small: boolean } | undefined {
  const { minParr, minEnrollment } = rulesConfig.firstTouchFloor;
  const parr = sf.account?.parr;
  if (parr !== undefined) return { label: `$${Math.round(parr).toLocaleString("en-US")} PARR`, small: parr < minParr };
  const enrollment = sb?.account?.enrollment;
  if (enrollment !== undefined) return { label: `${enrollment.toLocaleString("en-US")} students`, small: enrollment < minEnrollment };
  return undefined;
}

/**
 * District decision makers and math directors/coordinators: a First Touch with the growth manager, WHY NOW or not and
 * whatever the Starbridge score, unless the district is under the size floor, which makes it a BDR Discovery.
 * No size data counts as clearing the floor.
 */
function gmRoleDecision(sub: Submission, sf: SfContext, sb?: StarbridgeResult): Decision | null {
  if (!isGmRole(sub.job_title)) return null;
  const size = districtSize(sf, sb);
  if (size?.small) {
    return { level: 2, route: "bdr", reason: `${sub.job_title} at a small district (${size.label}): BDR Discovery.`, source: "rules" };
  }
  const at = size ? ` at a district with ${size.label}` : "";
  return { level: 3, route: "gm", reason: `${sub.job_title}${at}: always a First Touch with the growth manager.`, source: "rules" };
}

export function isGmRole(role: string): boolean {
  return rulesConfig.gmRoles.includes(role);
}

export function isBuildingLeader(role: string): boolean {
  return rulesConfig.buildingLeaderRoles.includes(role);
}

/**
 * Runs after rules and Claude: a First Touch at a small or low-scoring district becomes a BDR Discovery.
 * gmRoles already had the size floor applied by the rules, and skip the Starbridge score check.
 */
export function capFirstTouch(decision: Decision, sub: Submission, sf: SfContext, sb: StarbridgeResult): Decision {
  if (decision.route !== "gm" || isGmRole(sub.job_title)) return decision;
  const size = districtSize(sf, sb);
  const { minScore } = rulesConfig.firstTouchFloor;
  const why = [
    size?.small && size.label,
    sb.account && sb.account.score < minScore && `Starbridge score ${sb.account.score}`,
  ].filter(Boolean).join(", ");
  if (!why) return decision;
  return { ...decision, level: 2, route: "bdr", meeting: "discovery", reason: `${decision.reason} Capped at Discovery: ${why}.` };
}

function setLevel(decision: Decision, level: Level, note: string): Decision {
  return { ...decision, level, route: routeForLevel(level), meeting: meetingForLevel(level), reason: `${decision.reason} ${note}` };
}

/** What makes a teacher worth a Discovery, or undefined. See rulesConfig.teacherDiscovery. */
export function teacherReviewSignal(sub: Submission, sb: StarbridgeResult): string | undefined {
  const { reviewWords, signalBands } = rulesConfig.teacherDiscovery;
  if (reviewWords.test(sub.needs)) return "their message mentions the curriculum review";
  if (adoptingSoon(sub)) return `adopting ${sub.adoption_timeline}`;
  const band = sb.account?.signalBand;
  if (band && signalBands.includes(band)) return `a ${band.toLowerCase()} district in Starbridge`;
  return undefined;
}

/**
 * Runs after rules and Claude (and the Level 2 fallback), before the First Touch floor. Who gets which meeting is a
 * sales decision, so it is fixed here rather than left to Claude:
 * - teachers: a BDR Discovery only with a review signal at a district under $150k PARR (or no PARR); else Level 1.
 * - coaches/TOSAs: always a BDR Discovery.
 * - building leaders (principal, AP): at least a BDR Discovery; a First Touch only for a principal Claude judged to
 *   decide for the whole school, never for an AP.
 * Level 0 (Claude saw a non-buyer) and existing owners are left alone.
 */
export function applyLevelPolicy(decision: Decision, sub: Submission, sf: SfContext, sb: StarbridgeResult): Decision {
  if (decision.route === "owner" || decision.level === 0) return decision;
  const role = sub.job_title;
  const group = roleGroup(role);

  if (group === "end_user") {
    const parr = sf.account?.parr;
    const { maxParr } = rulesConfig.teacherDiscovery;
    const signal = teacherReviewSignal(sub, sb);
    const big = parr !== undefined && parr >= maxParr;
    const ok = signal && !big;
    const level: Level = ok ? 2 : 1;
    if (level === decision.level) return decision;
    const why = ok
      ? `Discovery: teacher with a review signal (${signal}) at a district under $${maxParr / 1000}k PARR.`
      : signal
        ? `Level 1: teacher at a district with $${Math.round(parr!).toLocaleString("en-US")} PARR, where teachers have little say.`
        : "Level 1: teacher with no curriculum-review signal.";
    return setLevel(decision, level, why);
  }

  if (group === "coach") {
    return decision.level === 2 ? decision : setLevel(decision, 2, "Coaches and TOSAs get a BDR Discovery.");
  }

  if (isBuildingLeader(role)) {
    if (decision.level === 1) return setLevel(decision, 2, "Building leaders get at least a BDR Discovery.");
    if (decision.level === 3 && role !== "Principal") return setLevel(decision, 2, "Assistant principals get a BDR Discovery.");
  }
  return decision;
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

/** A planned adoption that qualifies: SY26-27, SY27-28, or SY28-29 (counted since Nov 24 2026). */
export function adoptingSoon(sub: Submission): boolean {
  return /SY26-27|SY27-28|SY28-29/.test(sub.adoption_timeline);
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
