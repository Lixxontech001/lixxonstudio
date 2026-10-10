-- Phase 5 slice 2: the six free posting doors get their details in the existing secret catalogue.
-- Values are saved with the existing owner-only functions (automation_secret_save and friends), so they go to Vault.
-- No value is stored in a Lixxon table, and no posting happens here.
-- Adds catalogue rows only. Existing rows (telegram_bot_token, tumblr_*) are reused, not changed.
-- Additive. NOT applied to production.

INSERT INTO public.automation_secret_catalog
  (secret_name, label, category, purpose, required, sort_order, credential_type)
VALUES
  ('telegram_chat_id', 'Telegram channel or chat ID', 'social', 'Telegram door: where Buddy posts approved channel content', false, 265, 'identifier'),
  ('bluesky_handle', 'Bluesky handle', 'social', 'Bluesky door: the account name, for example name.bsky.social', false, 270, 'identifier'),
  ('bluesky_app_password', 'Bluesky app password', 'social', 'Bluesky door: an app password for posting, never the main password', false, 275, 'secret'),
  ('mastodon_instance_url', 'Mastodon server address', 'social', 'Mastodon door: the server the account lives on, for example https://mastodon.social', false, 280, 'identifier'),
  ('mastodon_access_token', 'Mastodon access token', 'social', 'Mastodon door: a token that can post from the account', false, 285, 'secret'),
  ('tumblr_consumer_key', 'Tumblr consumer key', 'social', 'Tumblr door: the app key for signed requests', false, 290, 'secret'),
  ('tumblr_blog_name', 'Tumblr blog name', 'social', 'Tumblr door: the blog Buddy posts to', false, 295, 'identifier'),
  ('discord_webhook_url', 'Discord webhook address', 'social', 'Discord door: the channel webhook Buddy posts through', false, 300, 'secret'),
  ('blogger_client_id', 'Blogger client ID', 'social', 'Blogger door: the Google app client ID', false, 305, 'identifier'),
  ('blogger_client_secret', 'Blogger client secret', 'social', 'Blogger door: the Google app client secret', false, 310, 'secret'),
  ('blogger_refresh_token', 'Blogger refresh token', 'social', 'Blogger door: lets Buddy get a fresh Google access token', false, 315, 'secret'),
  ('blogger_blog_id', 'Blogger blog ID', 'social', 'Blogger door: the blog Buddy posts to', false, 320, 'identifier')
ON CONFLICT (secret_name) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  purpose = EXCLUDED.purpose,
  credential_type = EXCLUDED.credential_type,
  enabled = true;
