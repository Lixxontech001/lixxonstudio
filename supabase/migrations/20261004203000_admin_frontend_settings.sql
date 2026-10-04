/*
# M5 · Front-end control from the database

The storefront reads `site_settings` rows (public ones) on load — the announcement bar and
maintenance mode already work that way. This migration adds the rest of the "edit the
front end" surface, all as data the panel can change without a deploy:

* `nav_menu`    — the header menu (label + href pairs).
* `footer`      — footer columns and the closing note.
* `homepage`    — which homepage sections render, and in what order.
* `theme`       — the brand accent (the two AA-safe values from THEME.md).
* `seo_defaults`— title suffix, default description, OG image, robots.
* `redirects`   — client-side redirect rules for retired URLs.
* `custom_head` — sanitized HTML injected into <head> (owner/`settings.frontend` only).
* `flags`       — feature switches beyond the original five.

Reading is public (the storefront needs it); writing goes through `admin_set_setting()`,
which validates the key and requires the right capability, so a compromised editor
account cannot rewrite the header.
*/

-- =====================================================================
-- 1. SEEDS
-- =====================================================================
INSERT INTO site_settings (key, value, is_public) VALUES
  ('nav_menu', '{"items": []}'::jsonb, true),
  ('footer', '{"columns": [], "note": ""}'::jsonb, true),
  ('homepage', '{"sections": [
      {"id": "hero", "enabled": true},
      {"id": "trending", "enabled": true},
      {"id": "editors_picks", "enabled": true},
      {"id": "for_you", "enabled": true},
      {"id": "latest", "enabled": true},
      {"id": "shop", "enabled": true},
      {"id": "newsletter", "enabled": true}
    ]}'::jsonb, true),
  ('theme', '{"accent": "#9C6647", "accent_text": "#85543A"}'::jsonb, true),
  ('seo_defaults', '{"title_suffix": " | Lixxon Studio",
      "description": "A daily digital magazine covering skincare science, intentional style and minimalist wellness.",
      "og_image": "", "robots": "index,follow", "twitter": ""}'::jsonb, true),
  ('redirects', '{"rules": []}'::jsonb, true),
  ('custom_head', '{"html": ""}'::jsonb, true),
  ('flags', '{"comments": true, "shop": true, "newsletter": true, "qa": true, "glossary": true,
      "tts": true, "personalisation": true, "picks": true, "search": true}'::jsonb, true)
ON CONFLICT (key) DO NOTHING;

-- keep the legacy `features` row in step with the new `flags` row on first run
UPDATE site_settings SET value = value || (SELECT value FROM site_settings WHERE key = 'flags')
 WHERE key = 'features' AND NOT value ? 'tts';

-- =====================================================================
-- 2. PUBLIC READ (one round trip for the whole storefront)
-- =====================================================================
CREATE OR REPLACE FUNCTION site_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM site_settings WHERE is_public = true;
$$;
REVOKE ALL ON FUNCTION site_config() FROM public;
GRANT EXECUTE ON FUNCTION site_config() TO anon, authenticated;

-- =====================================================================
-- 3. ADMIN READ / WRITE
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_site_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT admin_can('settings.read') THEN '[]'::jsonb ELSE
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'key', key, 'value', value, 'is_public', is_public, 'updated_at', updated_at
    ) ORDER BY key) FROM site_settings), '[]'::jsonb) END;
$$;

CREATE OR REPLACE FUNCTION admin_set_setting(p_key text, p_value jsonb, p_is_public boolean DEFAULT true)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text := lower(trim(COALESCE(p_key, '')));
BEGIN
  IF v_key !~ '^[a-z][a-z0-9_]{1,39}$' THEN RAISE EXCEPTION 'Setting keys use a-z, 0-9 and _'; END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN RAISE EXCEPTION 'A setting is a JSON object'; END IF;
  IF length(p_value::text) > 100000 THEN RAISE EXCEPTION 'That setting is too large (100 KB max)'; END IF;

  -- front-end keys need the dedicated capability; everything else needs settings.write
  IF v_key IN ('nav_menu', 'footer', 'homepage', 'theme', 'redirects', 'custom_head', 'seo_defaults') THEN
    IF NOT admin_can('settings.frontend') THEN RAISE EXCEPTION 'forbidden'; END IF;
  ELSE
    IF NOT admin_can('settings.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  END IF;

  -- shape checks for the keys the storefront iterates over
  IF v_key = 'nav_menu' AND jsonb_typeof(p_value -> 'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'nav_menu needs an "items" array';
  END IF;
  IF v_key = 'footer' AND jsonb_typeof(p_value -> 'columns') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'footer needs a "columns" array';
  END IF;
  IF v_key = 'homepage' AND jsonb_typeof(p_value -> 'sections') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'homepage needs a "sections" array';
  END IF;
  IF v_key = 'redirects' AND jsonb_typeof(p_value -> 'rules') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'redirects needs a "rules" array';
  END IF;
  IF v_key = 'redirects' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_value -> 'rules') r
      WHERE COALESCE(r ->> 'from', '') !~ '^/' OR COALESCE(r ->> 'to', '') = ''
    ) THEN RAISE EXCEPTION 'Every redirect rule needs a "from" starting with / and a "to"'; END IF;
  END IF;
  IF v_key = 'theme' AND jsonb_typeof(p_value -> 'accent') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'theme needs an "accent" colour';
  END IF;

  INSERT INTO site_settings (key, value, is_public, updated_at)
  VALUES (v_key, p_value, COALESCE(p_is_public, true), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_public = EXCLUDED.is_public, updated_at = now();

  IF v_key = 'flags' THEN
    -- keep the legacy key in step so older components keep working
    UPDATE site_settings SET value = site_settings.value || p_value, updated_at = now() WHERE key = 'features';
  END IF;

  RETURN 'ok';
END $$;

CREATE OR REPLACE FUNCTION admin_reset_setting(p_key text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT admin_can('settings.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF lower(COALESCE(p_key, '')) IN ('nav_menu', 'footer', 'homepage', 'theme', 'redirects', 'custom_head', 'seo_defaults')
     AND NOT admin_can('settings.frontend') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM site_settings WHERE key = lower(trim(COALESCE(p_key, '')));
  RETURN 'ok';
END $$;

REVOKE ALL ON FUNCTION admin_site_settings() FROM public;
REVOKE ALL ON FUNCTION admin_set_setting(text, jsonb, boolean) FROM public;
REVOKE ALL ON FUNCTION admin_reset_setting(text) FROM public;
GRANT EXECUTE ON FUNCTION admin_site_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_setting(text, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reset_setting(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
