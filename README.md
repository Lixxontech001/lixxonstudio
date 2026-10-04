# Lixxon Studio

Editorial skincare magazine + digital shop. Vite · React 18 · TypeScript · Tailwind · Supabase (Postgres, Auth, Storage, Edge Functions, Realtime) · Vercel. Runs entirely on free tiers.

Live: https://lixxonstudio.vercel.app

## Local development

```bash
npm ci
cp .env.example .env            # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_FLUTTERWAVE_PUBLIC_KEY
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit + component smoke tests |
| `npx tsc --noEmit -p tsconfig.app.json` | Type-check the app |
| `npx tsc --noEmit -p supabase/functions/tsconfig.json` | Type-check edge functions |
| `python3 scripts/db-test.py` | Apply every migration to an embedded Postgres and run `scripts/db-assertions.sql` (RLS/privilege checks). Needs `pip install pgserver`. |

CI (`.github/workflows/ci.yml`) runs all of the above on every push, plus Lighthouse budgets on PRs.

## Architecture in one minute

- **Public pages** read from Supabase with the anon key under row-level security. Only published/approved rows and non-PII columns are readable.
- **Anything that writes or costs money goes through an edge function** (`supabase/functions/*`): `create-order` (server-side pricing, promo/gift-card validation, bundles, PWYW), `verify-payment` (Flutterwave verification + webhook), `download-file` (signed, entitlement-checked downloads), `submit-form` (comments, reviews, newsletter double opt-in, questions, reports, rate-limited), `order-status`, `feeds` (sitemap/RSS/bot prerender), `send-emails` and `refresh-rates` (internal, secret-protected).
- **Admins** are rows in `app_admins` (`owner` / `editor` / `moderator`). `is_admin()` additionally requires a verified TOTP factor (AAL2) once one is enrolled. Admin changes are written to a trigger-based audit log.
- **Customers** sign in with magic links; their orders/downloads/bookmarks/lists are matched by `jwt_email()` / `auth.uid()`.
- **Scheduled work**: `pg_cron` inside Supabase (scheduled publishing, abandoned carts, weekly digest, backups, keep-alive) and a GitHub Actions cron (`.github/workflows/cron.yml`) that drains the email queue, refreshes FX rates and pings the site.

## Deployment runbook (first time)

### 1. Supabase
```bash
npm i -g supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase db push                                  # applies supabase/migrations/* in order
supabase functions deploy                         # deploys every function (config.toml sets verify_jwt=false)
supabase secrets set FLW_SECRET_KEY=... FLW_WEBHOOK_HASH=... INTERNAL_FN_SECRET=... \
  RATE_LIMIT_SALT=... RESEND_API_KEY=... EMAIL_FROM="Lixxon Studio <onboarding@resend.dev>" \
  SITE_URL=https://lixxonstudio.vercel.app CHECKOUT_CURRENCY=USD EMAIL_DAILY_CAP=90
```
Then in the dashboard:
- **Auth → URL configuration**: Site URL = your Vercel URL; add it to redirect URLs (magic links).
- **Auth → Providers → Email**: keep "Confirm email" on; magic links use the default Supabase sender (free, no DNS needed).
- **Auth → MFA**: enable TOTP. Each admin enrols from `/admin` → Security (2FA).
- **Storage**: the `media` bucket must exist and be public-read; `digital-products` must be private (downloads go through `download-file`).
- **Database → Extensions**: `pg_cron` and `pg_net` enabled (the migrations schedule the jobs).
- **Database → Replication**: `orders`, `article_views`, `comments` are added to the `supabase_realtime` publication by migration v4 (powers the live admin panel).

Existing auth users become `owner` admins on first migration. Add more from `/admin` → Team & Roles (`set_admin_role`).

### 2. Flutterwave
Dashboard → Settings → Webhooks: URL `https://YOUR-PROJECT-REF.supabase.co/functions/v1/verify-payment`, secret hash = the `FLW_WEBHOOK_HASH` you set above.

### 3. Vercel
Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_FLUTTERWAVE_PUBLIC_KEY`, `VITE_SITE_URL`, optional `VITE_GA_MEASUREMENT_ID`, `VITE_SENTRY_DSN`. The serverless `api/feeds.ts` + `api/og.tsx` reuse the same `VITE_SUPABASE_*` variables. `vercel.json` already rewrites `/sitemap.xml`, `/rss.xml`, `/api/og` and bot traffic on `/blog/:slug`.

The Supabase **URL and key may use any of the alias names** listed in `.env.example` (e.g. Supabase's own integration naming `VITE_PUBLIC_SUPABASE_URL` / `VITE_PUBLIC_SUPABASE_ANON_KEY`), so you do not have to rename anything in Vercel. `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are server-side only and must never get a `VITE_` prefix.

> **"The deployed site loads nothing from Supabase" — checklist**
> 1. Vite inlines `VITE_`-prefixed variables **at build time**, into the JS bundle. Nothing is read at runtime, so editing a variable in Vercel does nothing until you **redeploy**, and a cached build reuses the old values — redeploy with *Use existing Build Cache* unchecked.
> 2. Open **`/api/health`** on the deployment: it lists which env-var names the deployment can see (never their values), shows which name the Supabase URL/key resolved from, and performs one anonymous read so you can tell "credentials missing" apart from "credentials fine, but RLS/rows are the problem".
> 3. Watch the Vercel **build log**: the build prints `[lixxon] Supabase env detected — url via …` or a loud warning when no credentials were visible to the build.
> 4. Only `VITE_`-prefixed names reach the browser. `SUPABASE_PUBLISHABLE_KEY` (no prefix) is fine for `api/*` but is invisible to the frontend.

### 4. GitHub Actions secrets (repo → Settings → Secrets)
`SUPABASE_FUNCTIONS_URL`, `INTERNAL_FN_SECRET`, `SITE_URL`. That's what keeps emails flowing on the free tier.

## Free-tier budget guardrails
- Resend: 100 emails/day → `EMAIL_DAILY_CAP=90`, queue drains every 20 min, digest is weekly.
- Supabase Free: 500 MB DB / 1 GB storage / project pauses after 7 idle days → images are compressed client-side, backups are rolled (`backup_snapshots`), keep-alive pings every 6 h.
- Vercel Hobby: OG images and feeds are cached with `s-maxage` headers.
- Sentry: only loaded when `VITE_SENTRY_DSN` is set; sample rates are kept low in `src/lib/monitoring.ts`.

## Security model (short)
See `UPGRADE_PLAN.md §0` for the original audit. Key invariants, all asserted by `scripts/db-assertions.sql` and the self-checking migrations:
- No anon write policies on sensitive tables; no public SELECT on orders/customers/entitlements/promo codes/gift cards/subscribers.
- PII columns on user-generated content (`comments.author_email`, `product_reviews.customer_email`, `article_questions.author_email`, fingerprints) are not selectable by `anon`/`authenticated`; admins read via `admin_*` views.
- Prices, discounts, gift-card balances and download entitlements are computed server-side only.
- All HTML from Markdown passes through DOMPurify; CSP, HSTS, frame and referrer headers are set in `vercel.json`.
