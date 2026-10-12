-- Phase H slice 3: the Keys page is not a junkyard. This turns off the catalogue rows that have no job left:
-- the two dead thinking keys (OpenAI, Anthropic), and the social rows the site never offers: Instagram, Facebook,
-- TikTok and Pinterest are posted by the owner by hand, and Threads, LinkedIn and X have no sender in the day run.
-- WhatsApp was already retired in 20261018010000_retire_old_sender_keys.sql.
--
-- A disabled row is not listed on the Keys page, and a save or test for it is refused by the database
-- ("Unknown or disabled secret name"). Existing Vault values are NOT deleted here: the owner can still find them in
-- the Supabase Vault screen and remove them by hand. Nothing else changes.
--
-- NOT applied to production. The site hides these names with or without this migration
-- (see supabase/functions/_shared/notOfferedKeys.ts).

UPDATE public.automation_secret_catalog
SET enabled = false
WHERE secret_name IN (
  'openai_api_key',
  'anthropic_api_key',
  'claude_api_key',
  'meta_app_secret',
  'meta_access_token',
  'facebook_page_id',
  'facebook_page_token',
  'threads_access_token',
  'tiktok_client_secret',
  'tiktok_client_key',
  'tiktok_access_token',
  'pinterest_access_token',
  'pinterest_board_id',
  'linkedin_client_secret',
  'linkedin_client_key',
  'linkedin_access_token',
  'x_api_secret',
  'x_api_key',
  'x_access_token'
);
