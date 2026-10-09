-- Phase 6 slice 4: the podcast cover picture address, as a catalogue row only.
-- Additive. NOT applied to production. The secret is saved only through the existing Vault functions (automation-keys).

INSERT INTO public.automation_secret_catalog
  (secret_name, label, category, purpose, required, sort_order, credential_type)
VALUES
  ('podcast_cover_url', 'Podcast cover picture address', 'social', 'Podcast door: a secure link to your square cover picture (1400 to 3000 pixels, under 510 KB, JPEG or PNG).', false, 365, 'identifier')
ON CONFLICT (secret_name) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  purpose = EXCLUDED.purpose,
  credential_type = EXCLUDED.credential_type,
  enabled = true;
