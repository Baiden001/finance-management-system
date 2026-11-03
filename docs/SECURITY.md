# Security

| Control | Implementation |
|---|---|
| Authentication | Supabase Auth, email + password, signups disabled, 12+ char policy; accountant created by admin script only |
| MFA | TOTP enrolment/verification page; `REQUIRE_MFA=true` forces AAL2 for every route (middleware) and for payroll exports (route handlers). Enforcement is application-level, not RLS-level |
| Sessions | httpOnly cookies via `@supabase/ssr`; refresh-token rotation (config); explicit logout confirmation |
| Authorization | Server-side: middleware + layout check + `is_accountant()` in every RLS policy; export routes call `requireAccountant` |
| Isolation | Separate projects; binding guard compares DB `company_code` to deployment; admin scripts refuse mismatches |
| RLS | Enabled on every table; unit test fails if a created table is not secured; DB tests prove outsiders and `anon` get nothing |
| Function exposure | EXECUTE revoked from PUBLIC/anon on all functions; `audit_event` requires an accountant |
| Secrets | Service-role key / DB URL only in admin scripts (a test forbids referencing them in `src/`); `.env*.example` contain placeholders; real env files git-ignored |
| Storage | Buckets private; policy accountant-only; app issues 60-second signed URLs; 10 MB limit; type allow-list on upload |
| Audit | Append-only `audit_log` (inserts, updates, deletes with old/new values, actor), period changes, reversals, exports (`report_exports` with SHA-256) |
| Sensitive data | Bank/MoMo numbers redacted from audit rows; payroll reports flagged `sensitive` (MFA + export audit); Payslip route audited |
| Export safety | CSV/XLSX formula-injection guard; `Cache-Control: no-store`; per-user export rate limit |
| Headers | HSTS, X-Frame-Options DENY, nosniff, strict referrer, restrictive permissions policy |
| Rate limiting | Supabase Auth sign-in limits (configure); in-memory limiter on exports (per instance) |

## Known gaps / recommendations
- Employee bank and mobile-money numbers are stored as plain text protected by RLS and redacted from logs. For stronger protection add column-level encryption (Supabase Vault / pgsodium) before production.
- The in-memory export limiter is per server instance; use an edge/WAF rate limit for multi-instance deployments.
- MFA enforcement for database-level access (RLS on `aal2`) is not implemented; direct API access with a valid AAL1 token can still read data. Consider adding an `aal2` check to `is_accountant()` once MFA is mandatory.
- Content-Security-Policy is not set (Next.js inline scripts); add a nonce-based CSP in deployment.
- No penetration test has been performed.
