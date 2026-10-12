#!/usr/bin/env bash
# Sends each sample Unbounce payload to /api/tier, the way Make will, and prints what comes back.
#   scripts/try-tier.sh                                   local dev server (npm run dev)
#   TIER_SECRET=… VERCEL_BYPASS=… scripts/try-tier.sh https://<preview>.vercel.app
# VERCEL_BYPASS is the "Protection Bypass for Automation" secret, needed while previews sit behind Vercel's login.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-http://localhost:3000}"
SECRET="${TIER_SECRET:-local-dev-secret}"
BYPASS=()
[ -n "${VERCEL_BYPASS:-}" ] && BYPASS=(-H "x-vercel-protection-bypass: $VERCEL_BYPASS")

echo "Without the secret (expect 401):"
curl -s -o /dev/null -w "  %{http_code}\n" -X POST "$BASE/api/tier" ${BYPASS[@]+"${BYPASS[@]}"} -H "Content-Type: application/json" -d '{}'

for f in test/fixtures/unbounce-*.json; do
  echo "$(basename "$f" .json):"
  curl -s -X POST "$BASE/api/tier" -H "Content-Type: application/json" ${BYPASS[@]+"${BYPASS[@]}"} -H "x-inbound-secret: $SECRET" --data @"$f" \
    | jq -c '{level, route, host_name, also_add, booking_url, state, fallback, cached, reason}' | sed 's/^/  /'
done
