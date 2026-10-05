# Lixxon Studio automation setup

This is the owner-facing setup and key-handling guide. Do not paste credentials into GitHub issues, chat, source files, browser console, `VITE_*` build variables, or public Actions logs.

## Keys page

- Owner page: `/admin/automation/keys`
- Production URL after the final merge and migration/function deployment: `https://lixxonstudio.vercel.app/admin/automation/keys`
- Edge test handler: the Supabase project URL plus `/functions/v1/automation-keys` (called by the page with the signed-in owner session; it is not an anonymous key API).
- Sign in with an active owner/founder account and complete the existing MFA gate. A team permission override does not grant access to this page.
- Paste one credential into its labelled field and choose **Save**. For an existing value, confirm **Replace**. The field clears after the save attempt. The app stores the value in Supabase Vault; the Keys page only receives the catalogue name, type, configured state and redacted test metadata. A saved value cannot be viewed or copied back. Replace it with the provider's newly issued value if it is lost or rotated.
- **Delete** asks for confirmation and permanently removes the Vault value. Saving/replacing/deleting is audited as metadata only; provider values and provider response bodies are not included.

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
| Social and messaging | `telegram_bot_token`, `meta_app_id`, `meta_app_secret`, `meta_access_token`, `instagram_user_id`, `facebook_page_id`, `threads_user_id`, `threads_access_token`, `youtube_client_id`, `youtube_client_secret`, `youtube_refresh_token`, `tiktok_client_key`, `tiktok_client_secret`, `tiktok_access_token`, `pinterest_access_token`, `pinterest_board_id`, `linkedin_client_id`, `linkedin_client_secret`, `linkedin_access_token`, `linkedin_organization_id`, `x_api_key`, `x_api_secret`, `x_access_token`, `x_access_token_secret`, `tumblr_consumer_key`, `tumblr_consumer_secret`, `tumblr_access_token`, `tumblr_token_secret`, `tumblr_blog_identifier`, `whatsapp_phone_number_id`, `whatsapp_access_token` |
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
- Flutterwave webhook hash and VAPID values receive local-format checks; the real webhook signature and push delivery are verified by their later end-to-end flows.
- Coverr's test makes one read-only video-list call and consumes one provider API request. Account limits depend on the Coverr application's status; check the provider dashboard before repeated tests.
- For other providers the test makes one HTTPS read-only request, consumes/discards the response server-side and stores only a safe result code/time. Provider response text, account data and credentials are never returned to the page.

Provider permissions, app review and no-cost quota vary by account. A saved key is not evidence of a working channel. The health screen and each adapter must use measured provider evidence before anything is marked connected. If a service is unavailable or requires a paid tier, leave it paused/manual; do not enable a paid fallback.

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
