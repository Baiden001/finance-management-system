#!/usr/bin/env bash
# Logical backup of ONE company database (schema + data + auth users excluded). Store output encrypted, separately per company.
# Usage: SUPABASE_DB_URL=... ./scripts/backup.sh resilience [outdir]
set -euo pipefail
company="${1:?company}"; out="${2:-backups}"; mkdir -p "$out"
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL for this company}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"; file="$out/${company}-${stamp}.dump"
pg_dump --format=custom --no-owner --schema=public --schema=fms_admin --file "$file" "$SUPABASE_DB_URL"
sha256sum "$file" > "$file.sha256"; echo "Wrote $file (verify with sha256sum -c). Encrypt before storing off-site, e.g. age or gpg."
