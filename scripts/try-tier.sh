#!/usr/bin/env bash
# Sends each sample Unbounce payload to /api/tier, the way Make will, and prints what comes back.
#   scripts/try-tier.sh                                   local dev server (npm run dev)
#   TIER_SECRET=… VERCEL_BYPASS=… scripts/try-tier.sh https://<preview>.vercel.app
# VERCEL_BYPASS is the "Protection Bypass for Automation" secret, needed while previews sit behind Vercel's login.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-http://localhost:3000}"
# Falls back to TIER_SECRET in .env (git-ignored), so the secret never has to be typed into a command.
if [ -z "${TIER_SECRET:-}" ] && [ -f .env ]; then
  TIER_SECRET="$(grep -E '^TIER_SECRET=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
fi
if [ -z "${TIER_SECRET:-}" ] && [[ "$BASE" != http://localhost* ]]; then
  echo "TIER_SECRET isn't set. Add a line TIER_SECRET=<your secret> to .env, or export it in this shell." >&2
  exit 1
fi
SECRET="${TIER_SECRET:-local-dev-secret}"
BYPASS=()
[ -n "${VERCEL_BYPASS:-}" ] && BYPASS=(-H "x-vercel-protection-bypass: $VERCEL_BYPASS")

echo "Without the secret (expect 401):"
curl -s -o /dev/null -w "  %{http_code}\n" -X POST "$BASE/api/tier" ${BYPASS[@]+"${BYPASS[@]}"} -H "Content-Type: application/json" -d '{}'

# A fresh address per run (dana+t1760300000@example.org), so the app scores again instead of replaying
# its cached answer for the same lead.
RUN="t$(date +%s)"
for f in test/fixtures/unbounce-*.json; do
  echo "$(basename "$f" .json):"
  jq --arg run "$RUN" '.data.email[0] |= sub("@"; "+" + $run + "@")' "$f" \
  | curl -s -X POST "$BASE/api/tier" -H "Content-Type: application/json" ${BYPASS[@]+"${BYPASS[@]}"} -H "x-inbound-secret: $SECRET" --data @- \
    | jq -c 'if .level == null then {error} else {level, route, host_name, also_add, booking_url, state, fallback, cached, starbridge: .starbridge_summary, salesforce: .sf_match, errors, ms: .timings, reason} end' | sed 's/^/  /'
done
