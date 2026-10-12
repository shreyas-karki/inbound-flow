// Unbounce sends form answers with its own field IDs, and its webhook wraps every value in an array
// (data.json: { "first_name": ["Dana"] }). This turns either shape into our field names, so the
// webhook (via Make), the browser handoff and our own form all reach the router the same way.

export const UNBOUNCE_FIELDS: Record<string, string> = {
  first_name: "name",
  last_name: "surname",
  user_profile: "job_title",
  when_is_your_district_planning_to_adopt_a_new_math_curriculum: "adoption_timeline",
  message: "needs", // the free-text box; the rubric's strongest signal
};

export function fromUnbounce(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const flat = Array.isArray(value) ? value.map(String).join(", ") : value;
    const ours = UNBOUNCE_FIELDS[key];
    // Our own field name wins if both are present.
    if (ours) out[ours] ??= flat;
    else out[key] = flat;
  }
  return out;
}
