#!/usr/bin/env bash
# Full local validation: lint, typecheck, all tests (DB tests run on in-process Postgres), production build for BOTH companies.
set -euo pipefail
cd "$(dirname "$0")/.."
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://placeholder.supabase.co}" NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-placeholder}"
npm run lint && npm run typecheck && npm test
for c in resilience ashelite; do echo "== build $c =="; NEXT_PUBLIC_COMPANY=$c npx next build >/dev/null && echo "build $c ok"; done
echo "ALL VALIDATION PASSED"
