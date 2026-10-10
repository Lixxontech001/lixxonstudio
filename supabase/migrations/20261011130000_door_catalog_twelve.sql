-- Phase 6 slice 2: the six new auto doors get their details in the existing secret catalogue.
-- Values are saved with the existing owner-only functions (automation_secret_save and friends), so they go to Vault.
-- No value is stored in a Lixxon table, and no posting happens here.
-- YouTube's three names (youtube_client_id, youtube_client_secret, youtube_refresh_token) already exist from
-- 20261005090000 and 20261005100000, so they are reused, not added again.
-- Podcast's two details are not secrets. They are still saved in Vault, so one save path serves every door.
-- Additive. NOT applied to production.

INSERT INTO public.automation_secret_catalog
  (secret_name, label, category, purpose, required, sort_order, credential_type)
VALUES
  ('medium_integration_token', 'Medium integration token', 'social', 'Medium door: an integration token you already have. Medium no longer issues new ones.', false, 325, 'secret'),
  ('pixelfed_instance_url', 'Pixelfed server address', 'social', 'Pixelfed door: the server the account lives on, for example https://pixelfed.social', false, 330, 'identifier'),
  ('pixelfed_access_token', 'Pixelfed access token', 'social', 'Pixelfed door: a token that can post from the account', false, 335, 'secret'),
  ('wordpress_com_site', 'WordPress.com site address', 'social', 'WordPress.com door: the site Buddy posts to, for example yourname.wordpress.com', false, 340, 'identifier'),
  ('wordpress_com_access_token', 'WordPress.com access token', 'social', 'WordPress.com door: a token that can publish to the site', false, 345, 'secret'),
  ('vimeo_access_token', 'Vimeo access token', 'social', 'Vimeo door: a token with upload rights', false, 350, 'secret'),
  ('podcast_show_title', 'Podcast show title', 'social', 'Podcast door: the show name in the feed', false, 355, 'identifier'),
  ('podcast_show_author', 'Podcast show author', 'social', 'Podcast door: the name the show is credited to', false, 360, 'identifier')
ON CONFLICT (secret_name) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  purpose = EXCLUDED.purpose,
  credential_type = EXCLUDED.credential_type,
  enabled = true;
