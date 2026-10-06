# Lixxon Studio automation setup

This is the owner-facing setup and key-handling guide. Do not paste credentials into GitHub issues, chat, source files, browser console, `VITE_*` build variables, or public Actions logs.

## Keys page

- Owner page: `/admin/automation/keys`
- Production URL after the final merge and migration/function deployment: `https://lixxonstudio.vercel.app/admin/automation/keys`
- Edge test handler: the Supabase project URL plus `/functions/v1/automation-keys` (called by the page with the signed-in owner session; it is not an anonymous key API).
- Sign in with an active owner/founder account and complete the existing MFA gate. A team permission override does not grant access to this page.
- Paste one credential into its labelled field and choose **Save**. For an existing value, confirm **Replace**. The field clears after the save attempt. The app stores the value in Supabase Vault; the Keys page only receives the catalogue name, type, configured state and redacted test metadata. A saved value cannot be viewed or copied back. Replace it with the provider's newly issued value if it is lost or rotated.
- **Delete** asks for confirmation and permanently removes the Vault value. Saving/replacing/deleting is audited as metadata only; provider values and provider response bodies are not included.

## Article intake and calendar

- Admin page: `/admin/automation/articles`
- Production test URL after the final merge and migration deployment: `https://lixxonstudio.vercel.app/admin/automation/articles`. This branch is not deployed; do not treat the production URL as proof that the new page is live.
- Sign in as an active admin and complete MFA. `content.read` opens the page; `content.write` is required to import/edit queue metadata; scheduling or rescheduling an actual post additionally requires the existing database-enforced `content.publish` capability.
- Choose up to ten Microsoft Word `.docx` files in one batch (15 MB each, 60 MB total). Text extraction and SHA-256 checks run in the browser. The original document bytes are not retained or uploaded; keep your source DOCX files safely. Password-protected, multipart/ZIP64, damaged, or tracked-change documents must be reviewed/re-saved in Word before import.
- The page imports only the extracted article text into the existing unpublished `posts.content` draft. It does not call an AI model, summarize or transform prose, or store a second article-body copy. Verify the read-only preview, then enter the owner-written title, category, tags, selected image with owner-written alt text and a proposed Lagos date. To upload a new image, open **Media library** in a new tab and return; the picker refreshes when the intake tab becomes visible. Complete the excerpt and SEO title/description in **Edit article** before scheduling; the database blocks an intake draft from scheduling until required metadata is complete. The 3,500–4,000-word band is a warning target, not an instruction to change prose.
- Proposed dates are Africa/Lagos (WAT) and stored as UTC. A database guard allows at most two published/scheduled/active-proposal articles per Lagos day. A proposal is not a schedule or publishing approval.
- **To schedule:** review the draft in the existing Article editor, make any owner-authorized correction there, and explicitly choose its schedule/publish action with `content.publish`. The existing five-minute publisher remains the only article publisher. Channel-distribution approval is separate. Dragging a scheduled calendar entry always asks for confirmation and is subject to the same database daily cap.
- **Correction/rejection:** use **Edit article** to open the existing editor. An owner/editor can explicitly select a replacement DOCX and confirm **Replace article prose**; the normal article revision history retains the earlier body. **Reject item** keeps the unpublished draft and all prose, marks the intake record rejected and releases its proposed-day slot. Reopening requires a future date with available capacity.
- Local/preview test URL: `http://localhost:5173/admin/automation/articles` after `npm run dev`; sign in using the configured Supabase test project. Do not use production for destructive tests.

## Daily orchestration and run monitor (Phase 2)

- The scheduled job is `lixxon_automation_daily_pipeline`; it runs at **07:00 UTC / 08:00 Africa/Lagos (WAT)** using Supabase `pg_cron` + `pg_net`. It only claims already-scheduled, owner-approved articles for that Lagos date. The existing five-minute `publish_scheduled_posts()` remains the sole article publisher.
- GitHub workflow status: `https://github.com/Lixxontech001/lixxonstudio/actions/workflows/automation.yml`. The workflow is dispatched with a non-secret run UUID only. GitHub OIDC and a four-minute, run-bound, single-use capability protect the runner; no article prose, provider key or bearer capability is placed in the public dispatch payload or retained in the one-day redacted artifact.
- Owner run monitor: `/admin/automation/runs`; production URL after final merge and deployment: `https://lixxonstudio.vercel.app/admin/automation/runs`. Local/preview URL: `http://localhost:5173/admin/automation/runs` after `npm run dev`, using a non-production Supabase test project. The route is not proof of production deployment. The monitor shows safe run stages/log metadata, Lagos schedule and UTC timestamps, duration, retries, quota usage, configured alert routes, and verified workflow/article links. Article prose and credential/provider response data are not returned.
- The master `automation.enabled` and `automation.daily_pipeline` flags are **off by default**. Only an active owner/founder can change either switch in the run monitor; each change asks for confirmation and is audited. Keep both off until migration/function/workflow configuration and the read-only preview have been reviewed. Saving the GitHub dispatch credential does not enable either switch.
- **Read-only preview** checks the saved article's owner schedule approval, metadata, image/link safety, risk/disclaimer flags and source presence. It does not return article prose and makes no provider calls, email, payment, publish, or write. A warning requires owner review; it does not generate disclaimer or attribution text.
- Pause, resume, retry and cancel are confirmed owner-only actions and are database-authorized/audited. Resume and retry queue the approved article for the next daily tick; retry is restricted to allow-listed transient infrastructure failures and has a bounded attempt count. Cancel is terminal and revokes the pending review kit. None of these controls changes `posts.content` or bypasses the existing publisher.
- For setup, save `github_dispatch_token` in the Keys page using a fine-grained token restricted to this repository and Actions write permission. Do not use a classic broad-scope token. Confirm the account/repository and policy before enabling any dispatch.
- The deployment workflow provisions the internal scheduling URL and `lixxon_internal_fn_secret` in Vault from existing infrastructure-only GitHub secrets. These internal runtime credentials are not provider API keys and are not entered in the browser. See “Existing infrastructure-only values” below; never print them in Actions logs or issue comments.
- Failure alerts contain only the run UUID and safe error code. A configured owner email is attempted first through Resend; if it is unavailable or fails, the runner attempts the private Telegram bot/chat configured by `resend_api_key`, `telegram_bot_token` and `telegram_chat_id` in the Keys page. Delivery outcomes log only safe channel/status metadata. If neither route is configured, the run remains safely failed and the monitor explains the missing destination. Push fallback is not yet enabled; it belongs to the later PWA/push phase.
- The runner currently performs only bounded database preflight, source hashing, safe-link/metadata checks and owner-kit preparation. Video, external channel posting and article-body updates are disabled. If a flag is unavailable, quota is exhausted, a provider is not connected, or a run fails, it stops and preserves the existing article draft; do not treat that as a successful publish.

## Daily Distribution Kit (Phase 3.1)

- Owner page: `/admin/automation/distribution`
- Production URL after the one final merge, migration and Edge Function deployment: `https://lixxonstudio.vercel.app/admin/automation/distribution`. This integration branch is not deployed; the production link is a target URL, not evidence of a live feature.
- Local/preview URL: `http://localhost:5173/admin/automation/distribution` after `npm run dev`; sign in to the configured non-production Supabase project with an active owner/founder account and MFA.
- Edge Function test endpoint: `https://<project-ref>.supabase.co/functions/v1/automation-distribution`. The page calls it with the signed-in user session. Gateway JWT, owner RPC, strict origin allowlist, rate limit, and the database approval/checksum gate are all enforced; do not call it with a service-role key or publish it as an anonymous API.
- First run: apply the migration and deploy `automation-distribution` only in the intended environment; keep `automation.enabled` and `automation.distribution` off. Choose an already scheduled or published article with a non-empty owner-written excerpt, prepare the kit, inspect each caption/link/image, save edits, then approve each channel copy separately. Approval does not publish. Copy/open-platform workflows remain owner-confirmed manual actions.
- Direct Telegram delivery is the only API sender in this step. Configure `telegram_bot_token` and the numeric private `telegram_chat_id` in the Keys page; ensure the bot can access the intended private chat. Run **Read-only check** and verify the destination, then turn on the general `automation.enabled` switch in `/admin/automation/runs` and the separate `automation.distribution` switch on this page only when ready. The send button requires both switches, a readback less than 24 hours old, a saved checksum-approved Telegram copy, an available owner-set cap (10 messages/day, Lagos time), and a final confirmation. The database rechecks all conditions and prevents replay. A network timeout can be ambiguous: inspect the private chat before saving/re-approving a retry to avoid a duplicate.
- The 13 targets are: Instagram, Facebook Pages, YouTube Shorts, TikTok, Pinterest, Telegram, Threads, LinkedIn, X, Tumblr, WhatsApp share/Business, an owner-only newsletter test preview plus manual subscriber kit, and the site's content-widget kit. A provider credential/readback checks account access only; it does not grant write permissions or complete provider app review. Shorts/TikTok remain manual uploads; WhatsApp's user share link is not an opt-in marketing broadcast; `/admin/newsletter` is subscriber management, not a campaign sender; the widget is a safe, copyable snippet and does not edit the site.
- Currently manual-only by design: X API readback is not attempted because its request may consume paid credit; Tumblr is held until a signed OAuth 1.0a adapter is verified; the site widget has no external provider. Other configured check adapters use these exact pairs: Instagram `meta_access_token` + `instagram_user_id`; Facebook `meta_access_token` + `facebook_page_id`; Shorts `youtube_client_id` + `youtube_client_secret` + `youtube_refresh_token`; TikTok `tiktok_access_token`; Pinterest `pinterest_access_token` + `pinterest_board_id`; Telegram `telegram_bot_token` + `telegram_chat_id`; Threads `threads_access_token` + `threads_user_id`; LinkedIn `linkedin_access_token` + `linkedin_organization_id`; WhatsApp Business `whatsapp_access_token` + `whatsapp_phone_number_id`; newsletter credential readback `resend_api_key`. Provider states are not considered live/connected until the owner runs the real check with authorized credentials. No real credentials or account readbacks have been used for this repository test.
- Resend `/domains` readback is considered connected only when the account has a verified domain. Configure `resend_api_key` in Vault and `EMAIL_FROM` only in Supabase Edge Function secrets (default: `Lixxon Studio <onboarding@resend.dev>`). The newsletter card can preview/copy the approved subject/body and send one `[TEST]` message to the signed-in owner's confirmed email after explicit confirmation, a fresh readback, an approved checksum and the three-per-Lagos-day safety cap. One attempt is allowed per approved copy. It never contacts subscribers. Bulk subscriber campaign sending is deliberately disabled; `/admin/newsletter` remains the subscriber-management screen, so do not treat its link as a campaign sender.
- Direct distribution receipts store only a safe Telegram message ID or Resend test receipt ID, payload checksum, channel/status and safe error code. The test ledger never stores the recipient address. Provider response bodies, message text and credentials are not logged or returned. Pausing a channel, rejecting copy, changing content, and disabling either switch remain owner-audited controls; auto-publishing and bulk newsletter delivery are disabled for all 13 targets.

## System Check

- Owner/admin page: `/admin/automation/check`
- API: the same site's `/api/automation/health`; it requires the signed-in session and the database-enforced `automation.check` permission.
- The check reads only safe database metadata. It does not read or return Vault values, call provider endpoints, dispatch jobs, publish content or enable any feature flag. “Healthy” requires measured evidence; quota, channel readback, webhook-signature and push-delivery checks remain warnings until their real end-to-end flows are implemented and verified.
- Production URL after the final merge and deployment: `https://lixxonstudio.vercel.app/admin/automation/check`.

The key catalogue includes these exact Vault names:

| Group | Names |
|---|---|
| AI | `openai_api_key`, `gemini_api_key`, `anthropic_api_key` |
| Actions | `github_dispatch_token` |
| Commerce | `flutterwave_secret_key`, `flutterwave_webhook_hash` |
| Email | `resend_api_key` |
| Social and messaging | `telegram_bot_token`, `telegram_chat_id`, `meta_app_id`, `meta_app_secret`, `meta_access_token`, `instagram_user_id`, `facebook_page_id`, `threads_user_id`, `threads_access_token`, `youtube_client_id`, `youtube_client_secret`, `youtube_refresh_token`, `tiktok_client_key`, `tiktok_client_secret`, `tiktok_access_token`, `pinterest_access_token`, `pinterest_board_id`, `linkedin_client_id`, `linkedin_client_secret`, `linkedin_access_token`, `linkedin_organization_id`, `x_api_key`, `x_api_secret`, `x_access_token`, `x_access_token_secret`, `tumblr_consumer_key`, `tumblr_consumer_secret`, `tumblr_access_token`, `tumblr_token_secret`, `tumblr_blog_identifier`, `whatsapp_phone_number_id`, `whatsapp_access_token` |
| Video | `coverr_api_key` |
| Web Push | `vapid_public_key`, `vapid_private_key`, `vapid_subject` |

Client IDs, account IDs, public keys and other identifiers are also stored encrypted in the same Vault catalogue. Their values are not shown again after saving.

## What a key test does

- **Read-only provider check passed** means one minimal provider read succeeded (YouTube also exchanges the stored refresh token for a short-lived access token). It does not verify publishing/write permissions, platform review, channel readiness, or billing/quota eligibility. No test posts, sends email, makes a payment, or edits account content.
- **Local check passed** is only a format/presence check. It is not labelled as a connected provider.
- The GitHub check reads workflow metadata; it does not exercise Actions write/dispatch permission.
- YouTube uses the stored client ID, client secret and refresh token together for an OAuth refresh, then reads the channel ID. It does not upload a video.
- WhatsApp uses the stored phone-number ID and token together for a read-only Graph API lookup when both are present.
- X is deliberately not contacted: an API request can consume paid credit. Its credentials receive a local-format check only until a zero-cost provider test is available and explicitly approved.
- Tumblr OAuth credentials receive a local-format check until the signed OAuth 1.0a adapter is implemented.
- Flutterwave webhook hash and VAPID values receive local-format checks. The webhook signature still has no live end-to-end test.
- **Web Push** has a real delivery check: `/admin/settings` → *Owner notifications* → **Register this device** (browser asks for notification permission), then **Send test notification** → **Confirm: send the test now**. The confirmation sends exactly one fixed test payload to your own confirmed devices and records the real result; nothing else is ever pushed. `automation.push` stays off until you turn it on, and with it off the test still works but scheduled alerts stay silent. Blocked notifications degrade honestly — allow them again in the browser's site settings, and owner alerts still arrive on Telegram in the meantime. Revoke (or Revoke all devices) erases a device's endpoint and keys immediately.
- Coverr's test makes one read-only video-list call and consumes one provider API request. Account limits depend on the Coverr application's status; check the provider dashboard before repeated tests.
- For other providers the test makes one HTTPS read-only request, consumes/discards the response server-side and stores only a safe result code/time. Provider response text, account data and credentials are never returned to the page.

Provider permissions, app review and no-cost quota vary by account. A saved key is not evidence of a working channel. The health screen and each adapter must use measured provider evidence before anything is marked connected. If a service is unavailable or requires a paid tier, leave it paused/manual; do not enable a paid fallback.

## Buddy (`/buddy`)

Buddy is an owner/admin surface behind the existing Admin sign-in, role checks and MFA. It accepts only four typed operations: `status`, `daily kit`, `help`, and `pause automation` / `resume automation` (the 08:00 Lagos daily schedule). Command phrases are matched exactly; product/price/payment/refund requests and every publishing, sending, approval or editorial request are blocked before they can become a draft, and **no publishing operation exists** for Buddy to run.

- A queued entry is a **draft**: an operation name, its typed arguments and a timestamp. Typed text is never stored, and drafts never run automatically — loading the app or reconnecting only updates the online/offline indicator.
- Any state change needs a **live preview** first (a fresh server read showing the current value and the exact change), and then an explicit confirmation. The preview expires after two minutes, is refreshed rather than reused, and is refused while offline or without the required permission.
- The only state change Buddy can make is pausing/resuming the scheduled daily pipeline through the existing owner-only audited flag RPC. It is reversible with the same command and publishes nothing; distribution still requires your per-item approval in the Daily Kit.
- Clearing the queue removes only Buddy's own storage key; reader bookmarks and other site data are untouched.
- Cold offline launch is not guaranteed: the service worker deliberately does not cache navigations, so Buddy must have loaded at least once.

## Existing infrastructure-only values

The Keys page stores credentials for the new automation runtime; it does not silently replace existing deployment settings. Until a later migration is implemented and verified:

- Supabase Edge Function secrets used by the existing checkout/email paths are deployed from GitHub repository secrets: `FLW_SECRET_KEY`, `FLW_WEBHOOK_HASH`, `RESEND_API_KEY`, `INTERNAL_FN_SECRET`, and `RATE_LIMIT_SALT`. The deploy workflow also consumes `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and (where configured) `SUPABASE_DB_PASSWORD`. Do not paste these into the browser build or Actions output.
- `SUPABASE_SERVICE_ROLE_KEY` / the Supabase server secret is server-side only. It is never an owner-entered browser value and must never be prefixed `VITE_`.
- Vercel's browser build may contain only public values such as `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (or its publishable-key alias), and `VITE_FLUTTERWAVE_PUBLIC_KEY`. These are not private API secrets. Never put an AI, payment secret, OAuth secret, webhook hash, VAPID private key or provider token in any `VITE_*` variable.
- The existing checkout reads `FLW_SECRET_KEY` and `FLW_WEBHOOK_HASH` from Supabase Function secrets; the new `flutterwave_secret_key` and `flutterwave_webhook_hash` Vault entries do not change legacy checkout until that integration is separately migrated and tested.
- Existing scheduled email sends read `RESEND_API_KEY` from Supabase Function secrets. Saving `resend_api_key` in Vault enables the automation credential check/runtime path, not an unverified change to the existing email queue.

These infrastructure credentials remain under the existing deployment workflow until an explicitly tested migration removes that dependency. Do not report the Keys page as controlling a legacy path it has not yet been connected to.

## Safety invariants

- Article prose is owner-authored. Automation must never write, edit, restore or improve `posts.content`.
- Publishing and distribution require the existing owner approval flow. Auto-publishing remains off until separately enabled per channel after the required clean-measurement period.
- All automation feature flags start off. A stored key does not enable a workflow, schedule, distribution channel or paid service.
- Branch work is not production proof. This route becomes a production test URL only after the single planned merge and deployment; use sandbox/mock credentials before then, and never run destructive production tests.
