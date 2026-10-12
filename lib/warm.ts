// The test page calls /api/warm when a lead picks their district, while they're still filling in the form.
// It fetches Starbridge then (with a generous timeout, since nobody is waiting) and caches the answer, so the
// decision at submit doesn't spend 4-7 seconds on Starbridge. Read-only: it only fills the cache.
import { defaultStore, type Store } from "./decisions";
import { emailDomain } from "./salesforce";
import { cachedAccountScore } from "./starbridge";
import { stateCode } from "./states";

const WARM_TIMEOUT_MS = 20_000;

export interface WarmRequest {
  school?: string;
  email?: string;
  state?: string;
}

/** Returns the work to keep alive after responding, or undefined when there's nothing worth looking up. */
export function warmStarbridge(req: WarmRequest, store: Store = defaultStore()): Promise<void> | undefined {
  const school = String(req.school ?? "").trim().slice(0, 200);
  if (school.length < 3) return undefined;
  const domain = req.email ? emailDomain(String(req.email)) : undefined;
  return cachedAccountScore(store, school, stateCode(req.state), domain, WARM_TIMEOUT_MS).then(() => undefined, () => undefined);
}
