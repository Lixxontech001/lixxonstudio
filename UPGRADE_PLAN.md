# Lixxon Studio — Thorough Upgrade Plan

> Constraint honoured throughout: **$0 budget.** Every service below is used only on its permanent free tier
> (Supabase Free, Vercel Hobby, Flutterwave pay-as-you-go [no monthly fee], Resend Free 3k emails/mo,
> GitHub Actions free minutes, Google Fonts, Pexels images). Nothing requires a card on file to start.

---

## 0. Current state (audit summary)

| Area | Finding |
|---|---|
| Build | `vite build` passes; **`tsc` fails with 100 errors**; **ESLint 58 errors** |
| Dead code | Routes `gift-cards`, `order-tracking`, `product-comparison` parsed but never rendered; unused imports |
| 🔴 **CRITICAL** Price tampering | Checkout computes `amount` in the browser and sends `expected_amount` to `verify-payment`. The edge function trusts it → attacker can pay $0.01 for any product and receive download entitlements |
| 🔴 **CRITICAL** Open write RLS | `promo_codes`, `product_reviews`, `article_polls`, `newsletter_preferences`, `poll_votes`, `reactions` etc. allow **anon INSERT/UPDATE/DELETE with `CHECK (true)`** → anyone can create 100% promo codes, delete reviews, rewrite polls |
| 🔴 **HIGH** Entitlement tampering | `download_entitlements` UPDATE policy is `USING(true) WITH CHECK(true)` for anon → reset `download_count`, extend `expires_at`, change `file_path` |
| 🔴 **HIGH** Unauthenticated customer area | `/account` trusts an email typed into localStorage → anyone can view another customer's orders and download links |
| 🟠 Admin = any auth user | No role claim; any Supabase user who signs up is a full admin |
| 🟠 Promo/gift-card validation client-side | `use_count` checks and discounts applied in browser; never re-validated server-side |
| 🟠 `dangerouslySetInnerHTML` | Article body rendered raw (`ArticleReader.tsx:379`) with no sanitiser → stored XSS if an editor pastes bad HTML or admin creds leak |
| 🟠 No security headers | No CSP, HSTS, X-Frame-Options, Referrer-Policy in `vercel.json` |
| 🟡 Spam surfaces | Comments, contact, newsletter, feedback, reviews: no rate limit, no honeypot, no CAPTCHA |
| 🟡 Analytics tables | Views/clicks/reader counts writable by anon without constraints (inflatable) |
| 🟡 Hygiene | No tests, no CI, no `.env.example`, 1-line README, starter package name, broken favicon path |

---

## 1. Phases & order of work

Security first (it's exploitable today), then correctness, then features, then polish.
Each phase ends with `typecheck + lint + build` green and a commit on `arena/01a10132-lixxonstudio`.

### Phase 1 — Lock down payments & data (security) 
**New migration `fix_security_hardening.sql`:**
1. **Admin role model** — `app_admins(user_id)` table + `is_admin()` SQL function (`SECURITY DEFINER`). Rewrite every "TO authenticated" write policy to `USING (is_admin())`. Seed with your existing admin user.
2. **Revoke anon writes** on: `promo_codes`, `product_reviews` (keep INSERT only, with `is_approved = false` forced via trigger), `article_polls`, `gift_cards`, `collections`, `shop_categories`, `content_templates`, `sponsored_content`, `featured_slots`, `refund_requests` (status admin-only), `abandoned_carts` (`recovered` admin-only).
3. **`download_entitlements`**: remove anon UPDATE entirely; downloads go through a new edge function.
4. **Orders**: anon can INSERT only `pending`; anon **cannot SELECT** orders by email anymore (see customer auth below). Add `CHECK (amount >= 0)`.
5. **One-vote constraints**: unique `(post_id, fingerprint)` on likes/reactions/ratings/poll votes/review helpfulness; DB-level — not just client.
6. **Rate-limit table** `request_log(ip_hash, action, created_at)` + `check_rate_limit()` function used by edge functions.

**Edge functions (Supabase Free: 500k invocations/mo — plenty):**
- `create-order` — server computes price from `products` table, validates promo/gift-card server-side (atomic `use_count` increment via `UPDATE … WHERE use_count < max_uses`), writes `orders`/`order_items`, returns `order_id` + authoritative amount. Browser never decides price.
- `verify-payment` — rewrite to compare Flutterwave amount against **DB `orders.amount`**, drop `expected_amount` param, add Flutterwave webhook handler (`verif-hash` header) so payments confirm even if the user closes the tab.
- `download-file` — takes `download_token`, checks expiry + count, increments atomically, returns 60-second signed URL. Replaces the client-side `createSignedUrl`.
- `submit-form` — comments / contact / feedback / newsletter / reviews go through here with honeypot + per-IP rate limit + length limits, instead of direct table inserts.

**Customer authentication (free):** Supabase **magic-link / email OTP** (built into Supabase Auth; emails via Supabase's free SMTP or Resend). `/account` requires a session; orders RLS becomes `customer_email = auth.jwt()->>'email'`. Guest checkout stays — a magic-link is sent after purchase so they can log in later.

**Client hardening:**
- Add `dompurify` (MIT, free) and sanitise article HTML on render **and** on save in the editor.
- `vercel.json` headers: CSP (allowlist Supabase, Flutterwave, GA, fonts, Pexels), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- Admin: require `is_admin()` server-side AND hide UI if not admin; add sign-out on 401; `logAdminAction` moved to DB trigger so it can't be skipped.
- `.env.example`, never commit keys; `npm audit` + Dependabot (free).

### Phase 2 — Fix every error & build what's missing
- Fix all **100 TS errors** (route narrowing in `App.tsx`, Supabase join typings via generated DB types `supabase gen types`, unused vars).
- Fix all **58 ESLint errors**; add `lint` + `typecheck` to CI.
- Build the 3 **dead routes** as real pages: Gift Cards storefront, Order Tracking, Product Comparison.
- Wire unused `MostReadThisWeek`; fix favicon path; rename package; proper README.
- Add **GitHub Actions** workflow (free): typecheck → lint → build → Vitest on every push.
- Add **Vitest + Testing Library** (free): unit tests for router parse/serialize, cart math, promo logic, sanitiser; smoke-render tests for each page.
- Add `ErrorBoundary` per route and a global one; proper 404 for unknown admin paths.
- Replace per-hook `useState/useEffect` fetching with a tiny shared `useQuery` cache (no new deps) to stop duplicate requests and enable offline fallback.

### Phase 3 — 40+ new authentic features (all free-tier)

> **Status (3 Oct 2026): all 48 items implemented** — commits `e11ace5` (batch 1) and `847b59d` (batch 2). Phase 4 verification is next.

**Reader experience (12)**
1. Progressive Web App — installable, offline reading of visited articles (`vite-plugin-pwa`, free)
2. Reading progress bar + estimated time remaining in the article header
3. "Continue reading" resume — returns you to scroll position across sessions
4. Table of contents auto-generated from headings, sticky on desktop
5. In-article highlight → share quote as image card (Canvas API, no service)
6. Series / multi-part articles with prev/next navigation (`article_series` table)
7. Key Takeaways box auto-rendered from a `takeaways[]` field
8. Glossary tooltips — hover skincare terms (`glossary` table, admin-managed)
9. Related-articles engine by shared tags + category (SQL, no AI service)
10. Print-friendly stylesheet & "Save as PDF" (browser print API)
11. Keyboard shortcuts (`/` search, `j/k` next/prev article, `b` bookmark)
12. Accessibility pass: skip links, focus traps in drawers, reduced-motion mode, WCAG AA contrast (free Lighthouse/axe)

**Community & engagement (8)**
13. Customer accounts via magic link — profile, avatar initials, saved data synced across devices (replaces localStorage-only bookmarks/lists)
14. Comment threading upgrades: edit window, report button, admin "pinned" reply, Markdown-lite
15. Reader Q&A on articles ("Ask the editor") with admin answer panel
16. Reading challenges / badges (7-day streak, 10 articles in a category) stored per account
17. Public reader profiles with reading lists shareable by URL
18. Weekly digest **actually emailed** via Resend free tier + Supabase `pg_cron` (free) — not just a page
19. Newsletter double opt-in + one-click unsubscribe (CAN-SPAM compliant)
20. "Notify me" for article series / product restock (email via Resend)

**Commerce (10)**
21. Secure server-side checkout (Phase 1) + Flutterwave **webhook** reconciliation
22. Gift cards storefront: buy, send to recipient by email, redeem at checkout (server-validated)
23. Order tracking page by order number + email (OTP-verified)
24. Product comparison (up to 3 products side-by-side)
25. Product bundles with bundle pricing (tables already exist, no UI yet)
26. Pay-what-you-want / tiered pricing for digital products
27. Automatic invoice/receipt PDF emailed on purchase (HTML → PDF via browser print or `pdf-lib`, free)
28. Abandoned-cart recovery email (1 email, 24h later, via `pg_cron` + Resend) with recovery link
29. Multi-currency display (NGN/USD/GBP/EUR) using free `exchangerate.host`-style public API cached daily in DB; Flutterwave charges in NGN or USD as configured
30. Customer refund request form + admin workflow (table exists, no customer UI)

**Content / SEO / growth (6)**
31. Dynamic `sitemap.xml` + `rss.xml` generated by an edge function from the DB (currently static)
32. JSON-LD structured data: `Article`, `Product`, `BreadcrumbList`, `FAQPage`, `Organization`
33. Open-Graph image generation per article (Vercel OG / Satori — free on Hobby)
34. Prerendering for crawlers: Vercel rewrite to a Supabase edge function that returns server-rendered HTML for `/blog/:slug` when `User-Agent` is a bot (fixes SPA SEO without paying for SSR hosting)
35. Scheduled publishing (`publish_at` + `pg_cron`)
36. A/B headline testing — two titles, pick winner by CTR from `article_views`

**Admin / CMS (8)**
37. Role-based admin (owner / editor / moderator) via `app_admins.role`
38. Admin 2FA — Supabase Auth TOTP MFA (free)
39. Rich-text/Markdown editor upgrade with image paste-upload to Storage, autosave drafts, diff view against `article_versions`
40. Bulk actions (publish, tag, delete) and CSV export for orders / subscribers / customers
41. Real-time dashboard (Supabase Realtime, free): live orders, live readers, today's revenue
42. Media library: image compression on upload (browser `canvas`), alt-text enforcement, usage tracking
43. Site settings in DB (announcement bar, maintenance mode, feature flags) instead of code
44. Audit log driven by DB triggers (tamper-proof) with filter/search UI

**Reliability (4)**
45. Error tracking with **Sentry free tier** (5k events/mo) or self-hosted-free GlitchTip — optional flag
46. Uptime ping + daily DB backup export to Storage via `pg_cron` (Supabase Free has no PITR)
47. Lighthouse CI in GitHub Actions with performance budget
48. Legal: cookie consent actually gates GA; privacy page updated for accounts/emails

### Phase 4 — Verification ("make sure everything works")
- `npm run typecheck && npm run lint && npm run build && npm run test` all green in CI.
- Manual + scripted smoke test of every route (public + admin) in the live preview.
- Security re-test: attempt price tamper, promo forge, entitlement edit, cross-customer order read, XSS payload in article — all must fail.
- RLS audit script: query `pg_policies` and fail if any write policy is `WITH CHECK (true)` for `anon`.
- Lighthouse ≥ 90 on Performance / A11y / Best Practices / SEO for home + article + product.
- Dependency audit (`npm audit --production`) with zero high/critical.

---

## 2. Decisions (confirmed 2026-10-03)

| # | Decision | Answer |
|---|---|---|
| 1 | Applying migrations / edge functions | **Supabase CLI**, linked to the project (`supabase link`, `db push`, `functions deploy`) |
| 2 | Customer auth | **Magic-link login** for `/account`; guest checkout preserved |
| 3 | Checkout currency | **USD** (Flutterwave) |
| 4 | Email sender | **No custom DNS yet** — Supabase default sender for auth mail; Resend onboarding sender for transactional until domain is verified |
| 5 | Error tracking | **Sentry free tier** — gated behind `VITE_SENTRY_DSN`, no-op when unset |

### Original questions (for reference)

1. **Supabase access** — I can write migrations + edge functions into the repo, but applying them needs the Supabase CLI linked to your project (or you paste the SQL into the dashboard). Which do you prefer?
2. **Customer login** — OK to require magic-link login for `/account`? (Guest checkout remains.)
3. **Currency** — Flutterwave settlement currency: NGN or USD?
4. **Email sender** — do you own `lixxonstudio.com` DNS so Resend can verify the domain (free)? Otherwise emails go from Supabase's default sender.
5. **Error tracking** — include Sentry free tier (needs you to create a free account) or skip?

---

## 3. Free-tier limits to keep in mind

| Service | Free limit | Our usage |
|---|---|---|
| Supabase | 500 MB DB, 1 GB storage, 500k edge invocations, 50k MAU, projects pause after 7 days idle | Fine; add `pg_cron` keep-alive ping |
| Vercel Hobby | 100 GB bandwidth, OG image fn | Fine; non-commercial clause — confirm acceptable |
| Resend | 3,000 emails/mo, 100/day | Digest to ≤ 100 subs/day; batch across days if more |
| Flutterwave | No fixed fee; per-transaction % | Standard |
| GitHub Actions | 2,000 min/mo | ~5 min/push |
| Sentry | 5k errors/mo | Optional |
