# Security — Lixxon Studio

Owner-facing security posture, threat model, and the hardening roadmap (Milestone 9).
The owner is a cyber-security student — this document is written to be reviewed as
such. Nothing here is a substitute for a real audit before handling sensitive data
at scale.

## Threat model (summary)

| Asset | Threat | Control today | Roadmap |
|---|---|---|---|
| Supabase data (posts, orders, customers) | SQLi, RLS bypass, leaked service keys | Parameterised queries via supabase-js/PostgREST only; `supabaseClient.ts` **refuses secret keys in the browser**; RLS on all 63 public tables (143 policies), asserted by `scripts/db-assertions.sql` in CI via `scripts/db-test.py` | Extend assertions (M9): fail on tables without RLS, anon-write policies, `USING (true)` on sensitive tables |
| Paid digital products | Link sharing, entitlement bypass | Private bucket, entitlement-checked `download-file` edge function, signed URLs, download counters/caps | Watermarking, per-order tokens with TTL |
| Payments (Flutterwave) | Webhook forgery, replay, price tampering | `verify-payment` verifies the webhook hash; prices recomputed server-side in `create-order` | Idempotency keys, replay window, alert emails (M9) |
| Admin surface | Account takeover, privilege escalation | MFA gate (`MfaGate`, TOTP required by `is_admin()`), trigger-based audit log | Full RBAC roles/permissions tables, re-auth for destructive actions, invite tokens (M5/M9) |
| Readers (PII: emails, IPs, fingerprints) | Leak via APIs/logs | v5 migration column-level REVOKE: PII columns not selectable by anon/authenticated; admin-only views | IP hashing with salt, retention policy, DSAR export/delete (M5/M9) |
| Browser clients | XSS | DOMPurify on all rich text (`sanitize.ts`), `escapeHtml` before formatting, React escaping, CSP with `object-src 'none'`, `frame-ancestors 'none'` | Remove `'unsafe-inline'` from `script-src` via hashes (incl. the theme pre-paint script), `report-to` collector, CORP/OAC headers (M9) |
| Service worker | Cache poisoning, broken offline path | v2 worker: intercepts only navigations + same-origin assets + Supabase reads; never cross-origin; never caches 206/no-store/vary:*; every respondWith resolves to a real Response (`serviceWorker.test.ts`) | Keep CACHE bump rule on every change (Appendix C) |
| Supply chain | Malicious dependency/action | Lockfile committed, `npm ci`, Dependabot recommended | `npm audit` in CI, SBOM, pin actions to SHAs (M9) |

## OWASP Top 10 (2021) mapping

| # | Category | Status | Notes |
|---|---|---|---|
| A01 | Broken Access Control | **Strong** | RLS-first DB access, MFA-gated admins and a 43-permission RBAC model (`admin_can()`), with triggers protecting the founder and the last owner. See `docs/ADMIN.md`. Remaining M9 work: session lockout/backoff. |
| A02 | Cryptographic Failures | **Partial** | HTTPS-only everywhere (HSTS preload); secrets live only in Vercel/Supabase secret stores; never in the repo. |
| A03 | Injection | **Strong** | No string-built SQL; PostgREST filters only; DOMPurify + escaping for output. |
| A04 | Insecure Design | **Partial** | Server-side pricing/entitlements; webhook verification; free-tier abuse caps (rate limits in `submit-form`). |
| A05 | Security Misconfiguration | **Partial** | Tight CSP/security headers in `vercel.json`; remaining: inline-script hashing, report-uri, CORS tightening on functions. |
| A06 | Vulnerable Components | **Open** | Add `npm audit` + SBOM + Dependabot (M9). |
| A07 | Identification & Auth Failures | **Partial** | Supabase Auth magic links + TOTP for admins; add lockout/backoff and re-auth (M9). |
| A08 | Software & Data Integrity | **Partial** | Flutterwave signature check; signed download URLs; CI-only deploys from `main`. |
| A09 | Logging & Monitoring Failures | **Partial** | Sentry (free tier) + field-level admin audit (actor, role, IP, user-agent, before/after diff, revert, 180-day retention) on 43 tables; remaining: alert emails for `critical` checks and an incident timeline (M9). |
| A10 | SSRF | **Partial** | Edge functions fetch only fixed hosts today; enforce allow-lists + timeouts + size caps on any future outbound fetch (e.g., the premium TTS proxy — specified in FEATURES.md). |

## Admin AI Autopilot OS (M8)

M8 adds an explicit autonomy contract. An agent may observe, suggest, draft, auto-apply or require
approval, but the database policy is authoritative and the UI cannot raise its own privilege. The
kill switch stops autopilot, each job has an idempotency key, action records expire, and every
agent/action/workflow/mission/memory/experiment/incident/cost mutation is trigger-audited.

The only automatic action allow-list is low-risk maintenance (`requeue_email`,
`repair_image_urls`, `backfill_seo`, `analyze`) and it requires both the owner policy and `ops.fix`.
Publishing, editing content, replying, commerce, experiments, permission changes and security
actions enter the approval queue and re-check their underlying capability at execution time.
Daily budgets and provider mode are persisted even though the current `rules` provider has no
model cost. A future provider must be called by an authenticated edge function and can only write
proposals; it must not receive database credentials.

## Admin AI and mutation hardening (M7)

The Admin AI system is not a second superuser. `admin.ai.run` may scan live, permission-aware
health and growth facts and create a durable proposal. `admin.ai.approve` is separately required
to apply one. Applying a proposal checks the underlying capability again (`content.publish`,
`content.write`, `content.moderate` or `ops.fix`), writes an audit row, and supports only
allow-listed fields/actions. Low-risk automation is opt-in and never publishes, edits or replies
automatically. An external model, if configured later, must be isolated behind an edge function
and can only write proposals.

The M7 security migration removes the remaining anonymous update/delete policies for carts,
likes, reactions, ratings, helpfulness and reading lists. Reader mutations now use small
validated RPCs with fingerprint and value checks. It also adds a unique abandoned-cart
fingerprint invariant, gates Storage writes by the effective RBAC capability, and strips script,
iframe, event-handler and `javascript:` content from the database-controlled custom head.

## Admin RBAC (M5)

- `admin_can(permission)` is the only authority; `is_admin()` also requires `status = 'active'`
  and AAL2 once the account has enrolled a TOTP factor.
- Capabilities are rows (`admin_permissions`, `admin_roles`, `role_permissions`,
  `admin_permission_overrides`) — not constants in the client bundle. The UI reads the effective
  list from `admin_me()`; RLS enforces the same list even for a hand-made API call.
- The original owner account is the **founder**: it always holds every permission, cannot be
  suspended/demoted/deleted by anyone (including itself — `admin_transfer_founder()` is the only
  way to move the flag), and a trigger refuses any state that would leave the site without an
  active owner.
- Read-only SQL is sandboxed: single `SELECT`/`WITH`, denylist, 5 s statement timeout,
  read-only transaction, 200-row cap, and it executes under the caller's own RLS.
- The data explorer writes through PostgREST with the admin's JWT, so `data.write` + RLS decide
  what is editable; money tables are read/update only and team/audit tables are read-only.
- Every admin write is trigger-audited with a diff and can be reverted (which is itself audited).

## CI security checks (current)

- `scripts/db-assertions.sql` (run by `scripts/db-test.py` on every PR): fixture-based proofs that cross-tenant reads/writes, anon writes to commerce tables, promo-code enumeration etc. are blocked; `ON_ERROR_STOP` fails the build on any regression.
- `scripts/admin-assertions.sql` (run by the same harness): editors cannot read orders or open
  backups, moderators cannot publish, suspended admins lose everything, `deny` overrides beat a
  role grant, the founder cannot be demoted, the last owner cannot be removed, the SQL console
  refuses writes, and audit diffs/reverts behave.
- `scripts/contrast-audit.mjs` (a11y-adjacent, run locally / by hand): 31 WCAG-AA pairs.
- `scripts/image-audit.mjs`: content-side URL hygiene (no `http://`, no HTML-page URLs in image fields).

## Disclosure policy

- Report security issues to **the owner** via the contact form on the site (mark the
  subject “Security”) or the GitHub repository's security advisory feature (private
  reporting). We aim to acknowledge within 72 hours and to ship a fix or mitigation
  timeline within 14 days for high-severity issues.
- Please give us a reasonable disclosure window (90 days) before public write-ups.
- Scope: the production site, this repository, and the Supabase project
  `jaatgiqigsmjodqgaocl`. Do not run destructive testing against production; use the
  PR preview environments. Out of scope: social engineering, DoS, spam, and issues
  that require a physical device unlock.

## Key-rotation runbook (draft)

1. Supabase keys: rotate in the dashboard → update the Vercel env vars (same names,
   Appendix B in the brief/README) → **redeploy without build cache** (keys are
   inlined at build time) → verify `/api/health`.
2. `FLW_SECRET_KEY` / `FLW_WEBHOOK_HASH`: rotate in Flutterwave → `supabase secrets set`
   → update the webhook URL's secret hash.
3. `INTERNAL_FN_SECRET`, `RATE_LIMIT_SALT`, `RESEND_API_KEY`: `supabase secrets set`
   and Vercel respectively; no redeploy needed for function secrets.
4. Sentry DSN/auth: rotate in Sentry → Vercel env → redeploy.

## Verified backups / restore drill

`pg_cron` backup jobs exist (admin “Backups” page). **A documented restore drill is
still owed** (M5/M9): schedule a quarterly drill that restores the latest dump into
the embedded Postgres used by `scripts/db-test.py` and records timings in this file.

---

Hardening backlog (tracked as Milestone 9 in FEATURES.md): inline-script hashing,
report-to collector, CORP/OAC headers, connect-src exact-host tightening, auth
lockout/backoff + re-auth, npm audit + SBOM + pinned action SHAs, IP hashing,
retention + DSAR flows, incident-disclosure template.
