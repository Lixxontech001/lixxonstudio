/*
# M6 · Editor workflow, quality scoring and revisions

The article editor was a textarea with a toolbar and a hand-rolled version list. This
migration gives every editor page a real backend:

1. `posts` gains a **workflow** (`draft → in_review → approved → scheduled → published →
   archived`), review notes, professional SEO fields (`focus_keyword`, `og_*`, `robots`,
   `schema_type`), `word_count`, `seo_score`, `editor_notes`, `content_warnings`,
   `pinned_until`, `is_evergreen` and an autosave marker. `products` gains the same SEO
   fields so both editors behave identically.
2. `article_versions` becomes a real revision log: captured by **trigger** (nobody can
   skip it), typed (`manual | autosave | publish | restore`), scored, coalesced while
   typing, pruned to the newest 50 per post — and no longer world-writable.
3. `admin_score_draft()` is the single quality engine (readability, structure, SEO,
   linking, alt text, keyword use) used by the live editor panel and by the stored
   `seo_score`; `admin_post_quality()` scores a stored post.
4. Workflow RPCs (`admin_submit_review`, `admin_approve_post`, `admin_reject_post`),
   revision RPCs (`admin_save_revision`, `admin_restore_revision`), autosave
   (`admin_autosave_post`), bulk actions, duplicate, internal-link suggestions and the
   editorial dashboard.

Every write goes through the M5 capability layer (`content.write` / `content.publish` /
`content.delete`) and lands in the audit trail; autosaves coalesce so the log stays readable.
*/

-- =====================================================================
-- 1. COLUMNS
-- =====================================================================
ALTER TABLE posts ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'draft';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS reviewed_by uuid;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS focus_keyword text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS og_title text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS og_description text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS og_image text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS robots text NOT NULL DEFAULT 'index,follow';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS schema_type text NOT NULL DEFAULT 'BlogPosting';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS word_count integer NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS seo_score integer;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS editor_notes text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_warnings text[] NOT NULL DEFAULT '{}';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_evergreen boolean NOT NULL DEFAULT false;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pinned_until timestamptz;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS last_edited_by uuid;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS autosave_at timestamptz;

ALTER TABLE products ADD COLUMN IF NOT EXISTS focus_keyword text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS og_title text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS og_description text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS og_image text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS robots text NOT NULL DEFAULT 'index,follow';
ALTER TABLE products ADD COLUMN IF NOT EXISTS schema_type text NOT NULL DEFAULT 'Product';
ALTER TABLE products ADD COLUMN IF NOT EXISTS editor_notes text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS last_edited_by uuid;
ALTER TABLE products ADD COLUMN IF NOT EXISTS autosave_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_score integer;

-- backfill the workflow from the legacy status without touching newer rows
UPDATE posts SET workflow_status = CASE status
    WHEN 'published' THEN 'published'
    WHEN 'scheduled' THEN 'scheduled'
    WHEN 'archived' THEN 'archived'
    ELSE 'draft' END
 WHERE workflow_status = 'draft' AND status <> 'draft';
UPDATE posts SET word_count = COALESCE(array_length(regexp_split_to_array(btrim(regexp_replace(COALESCE(content, ''), '[*_`#>\[\]()!-]', ' ', 'g')), '\s+'), 1), 0)
 WHERE word_count = 0 AND COALESCE(content, '') <> '';
UPDATE products SET schema_type = 'Product' WHERE schema_type IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_workflow_status_check') THEN
    ALTER TABLE posts ADD CONSTRAINT posts_workflow_status_check
      CHECK (workflow_status IN ('draft', 'in_review', 'approved', 'scheduled', 'published', 'archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_robots_check') THEN
    ALTER TABLE posts ADD CONSTRAINT posts_robots_check
      CHECK (robots IN ('index,follow', 'noindex,follow', 'index,nofollow', 'noindex,nofollow'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_schema_type_check') THEN
    ALTER TABLE posts ADD CONSTRAINT posts_schema_type_check
      CHECK (schema_type IN ('Article', 'NewsArticle', 'BlogPosting', 'HowTo', 'FAQPage', 'Review', 'Recipe'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_robots_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_robots_check
      CHECK (robots IN ('index,follow', 'noindex,follow', 'index,nofollow', 'noindex,nofollow'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_seo_score_check') THEN
    ALTER TABLE posts ADD CONSTRAINT posts_seo_score_check CHECK (seo_score IS NULL OR seo_score BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_workflow ON posts(workflow_status);
CREATE INDEX IF NOT EXISTS idx_posts_editor_last_edited ON posts(last_edited_by);

-- =====================================================================
-- 2. QUALITY ENGINE (one implementation, used by the editor and by the DB)
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_score_draft(
  p_title text,
  p_excerpt text,
  p_content text,
  p_focus text DEFAULT NULL,
  p_seo_title text DEFAULT NULL,
  p_seo_description text DEFAULT NULL,
  p_cover_image text DEFAULT NULL,
  p_cover_alt text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  c text := COALESCE(p_content, '');
  plain text;
  words int; sentences int; paragraphs int; syllables int;
  h2 int; h3 int; first_heading_level int;
  internal_links int; external_links int;
  images int; images_missing_alt int;
  kw text := lower(btrim(COALESCE(p_focus, '')));
  kw_count int := 0; kw_density numeric := 0; kw_first100 boolean := false;
  flesch numeric; avg_sentence numeric; reading_time int;
  title_len int := length(btrim(COALESCE(p_title, '')));
  desc_len int := length(btrim(COALESCE(p_seo_description, '')));
  seo_title_len int := length(btrim(COALESCE(p_seo_title, '')));
  excerpt_len int := length(btrim(COALESCE(p_excerpt, '')));
  issues jsonb := '[]'::jsonb;
  score int := 100;
  add_issue text;
  grade text;
BEGIN
  plain := regexp_replace(c, '```[\s\S]*?```', ' ', 'g');
  plain := regexp_replace(plain, '!\[[^\]]*\]\([^)]*\)', ' ', 'g');
  plain := regexp_replace(plain, '\[([^\]]*)\]\([^)]*\)', '\1', 'g');
  plain := regexp_replace(plain, '[*_`#>|]', ' ', 'g');
  plain := btrim(regexp_replace(plain, '\s+', ' ', 'g'));

  words := (SELECT count(*) FROM regexp_matches(plain, '\S+', 'g'));
  sentences := GREATEST((SELECT count(*) FROM regexp_matches(plain, '[.!?]+(\s|$)', 'g')), CASE WHEN words > 0 THEN 1 ELSE 0 END);
  paragraphs := GREATEST((SELECT count(*) FROM regexp_matches(c, E'\\n\\s*\\n', 'g')), CASE WHEN btrim(c) <> '' THEN 1 ELSE 0 END);
  syllables := GREATEST((SELECT count(*) FROM regexp_matches(lower(plain), '[aeiouy]+', 'g')), 1);
  reading_time := GREATEST(1, CEIL(words::numeric / 200));
  avg_sentence := CASE WHEN sentences > 0 THEN round(words::numeric / sentences, 1) ELSE 0 END;
  flesch := CASE WHEN words > 0 THEN round(206.835 - 1.015 * (words::numeric / GREATEST(sentences, 1)) - 84.6 * (syllables::numeric / GREATEST(words, 1)), 1) ELSE 0 END;

  h2 := (SELECT count(*) FROM regexp_matches(c, '^##\s+\S', 'gm'));
  h3 := (SELECT count(*) FROM regexp_matches(c, '^###\s+\S', 'gm'));
  SELECT (regexp_match(c, '^(#{2,4})\s+\S', 'm'))[1] INTO add_issue;
  first_heading_level := COALESCE(length(add_issue), 0);

  internal_links := (SELECT count(*) FROM regexp_matches(c, '\]\(/[^)]*\)', 'g'));
  external_links := (SELECT count(*) FROM regexp_matches(c, '\]\(https?://[^)]*\)', 'g'));
  images := (SELECT count(*) FROM regexp_matches(c, '!\[[^\]]*\]\([^)]*\)', 'g'));
  images_missing_alt := (SELECT count(*) FROM regexp_matches(c, '!\[\s*\]\([^)]*\)', 'g'));

  IF kw <> '' THEN
    kw_count := (SELECT count(*) FROM regexp_matches(lower(plain), '(^|[^a-z0-9])' || regexp_replace(kw, '([.\\+*?\[\]^$(){}=!<>|:\\-])', '\\\1', 'g') || '($|[^a-z0-9])', 'g'));
    kw_density := CASE WHEN words > 0 THEN round(kw_count::numeric * 100 / words, 2) ELSE 0 END;
    kw_first100 := position(kw in lower(left(plain, 700))) > 0;
  END IF;

  -- ---- issues + penalties -------------------------------------------------
  IF title_len = 0 THEN
    score := score - 30;
    issues := issues || jsonb_build_object('key', 'title', 'severity', 'error', 'message', 'The article has no title.', 'fix', 'Add a specific, benefit-led title.');
  ELSIF title_len < 30 OR title_len > 65 THEN
    score := score - 6;
    issues := issues || jsonb_build_object('key', 'title_length', 'severity', 'warn',
      'message', 'The title is ' || title_len || ' characters — search results cut around 30–65.',
      'fix', 'Aim for 30–65 characters.');
  END IF;

  IF excerpt_len = 0 THEN
    score := score - 10;
    issues := issues || jsonb_build_object('key', 'excerpt', 'severity', 'warn', 'message', 'No excerpt — cards, feeds and social previews will be bare.', 'fix', 'Write a 110–170 character summary.');
  ELSIF excerpt_len < 60 OR excerpt_len > 220 THEN
    score := score - 4;
    issues := issues || jsonb_build_object('key', 'excerpt_length', 'severity', 'info', 'message', 'The excerpt is ' || excerpt_len || ' characters.', 'fix', 'Keep it between 110 and 170.');
  END IF;

  IF desc_len = 0 THEN
    score := score - 8;
    issues := issues || jsonb_build_object('key', 'seo_description', 'severity', 'error', 'message', 'The meta description is empty.', 'fix', 'Describe the article in 110–160 characters.');
  ELSIF desc_len < 110 OR desc_len > 160 THEN
    score := score - 5;
    issues := issues || jsonb_build_object('key', 'seo_description_length', 'severity', 'warn', 'message', 'The meta description is ' || desc_len || ' characters.', 'fix', 'Trim to 110–160 characters.');
  END IF;

  IF seo_title_len = 0 THEN
    score := score - 4;
    issues := issues || jsonb_build_object('key', 'seo_title', 'severity', 'info', 'message', 'No SEO title — the article title is used.', 'fix', 'Set one if the title is longer than 60 characters.');
  ELSIF seo_title_len < 30 OR seo_title_len > 65 THEN
    score := score - 4;
    issues := issues || jsonb_build_object('key', 'seo_title_length', 'severity', 'info', 'message', 'The SEO title is ' || seo_title_len || ' characters.', 'fix', 'Aim for 30–65.');
  END IF;

  IF kw = '' THEN
    score := score - 6;
    issues := issues || jsonb_build_object('key', 'focus_keyword', 'severity', 'warn', 'message', 'No focus keyword set.', 'fix', 'Pick the phrase a reader would search for.');
  ELSE
    IF position(kw in lower(COALESCE(p_title, ''))) = 0 AND position(kw in lower(COALESCE(p_seo_title, ''))) = 0 THEN
      score := score - 5;
      issues := issues || jsonb_build_object('key', 'kw_title', 'severity', 'warn', 'message', 'The focus keyword "' || kw || '" is not in the title.', 'fix', 'Work it into the title or the SEO title.');
    END IF;
    IF desc_len > 0 AND position(kw in lower(COALESCE(p_seo_description, ''))) = 0 THEN
      score := score - 4;
      issues := issues || jsonb_build_object('key', 'kw_description', 'severity', 'info', 'message', 'The focus keyword is missing from the meta description.', 'fix', 'Add it naturally.');
    END IF;
    IF NOT kw_first100 THEN
      score := score - 3;
      issues := issues || jsonb_build_object('key', 'kw_intro', 'severity', 'info', 'message', 'The focus keyword does not appear in the opening.', 'fix', 'Use it in the first paragraph.');
    END IF;
    IF kw_density > 2.5 THEN
      score := score - 5;
      issues := issues || jsonb_build_object('key', 'kw_stuffing', 'severity', 'warn', 'message', 'Keyword density is ' || kw_density || '% — that reads as stuffing.', 'fix', 'Keep it under 2%.');
    ELSIF kw_density < 0.3 AND words > 200 THEN
      score := score - 3;
      issues := issues || jsonb_build_object('key', 'kw_density', 'severity', 'info', 'message', 'Keyword density is only ' || kw_density || '%.', 'fix', 'Mention the phrase once or twice more.');
    END IF;
  END IF;

  IF words < 300 THEN
    score := score - 15;
    issues := issues || jsonb_build_object('key', 'thin', 'severity', 'error', 'message', 'Only ' || words || ' words — search engines treat this as thin.', 'fix', 'Aim for 800+ words for a guide, 400+ for news.');
  ELSIF words < 600 THEN
    score := score - 5;
    issues := issues || jsonb_build_object('key', 'short', 'severity', 'warn', 'message', words || ' words so far.', 'fix', 'Longer pieces rank and convert better for evergreen topics.');
  END IF;

  IF h2 = 0 THEN
    score := score - 8;
    issues := issues || jsonb_build_object('key', 'headings', 'severity', 'warn', 'message', 'No section headings (##) — the piece is one long block.', 'fix', 'Break it into 3–6 sections.');
  END IF;
  IF first_heading_level > 3 THEN
    score := score - 4;
    issues := issues || jsonb_build_object('key', 'heading_order', 'severity', 'info', 'message', 'A level-' || first_heading_level || ' heading starts the article.', 'fix', 'Open with an ## heading, then nest.');
  END IF;

  IF internal_links = 0 THEN
    score := score - 8;
    issues := issues || jsonb_build_object('key', 'internal_links', 'severity', 'warn', 'message', 'No internal links.', 'fix', 'Link 2–4 related articles (the panel suggests them).');
  ELSIF internal_links = 1 THEN
    score := score - 3;
    issues := issues || jsonb_build_object('key', 'internal_links_low', 'severity', 'info', 'message', 'Only one internal link.', 'fix', 'Two to four is the sweet spot.');
  END IF;

  IF COALESCE(btrim(p_cover_image), '') = '' THEN
    score := score - 6;
    issues := issues || jsonb_build_object('key', 'cover', 'severity', 'warn', 'message', 'No cover image.', 'fix', 'Pick one from the media library.');
  END IF;
  IF images_missing_alt > 0 THEN
    score := score - 6;
    issues := issues || jsonb_build_object('key', 'image_alt', 'severity', 'warn', 'message', images_missing_alt || ' inline image(s) have no alt text.', 'fix', 'Describe each image for screen readers.');
  END IF;
  IF COALESCE(btrim(p_cover_alt), '') = '' AND COALESCE(btrim(p_cover_image), '') <> '' THEN
    score := score - 2;
    issues := issues || jsonb_build_object('key', 'cover_alt', 'severity', 'info', 'message', 'The cover image has no alt text.', 'fix', 'Add a short description.');
  END IF;

  IF avg_sentence > 32 THEN
    score := score - 10;
    issues := issues || jsonb_build_object('key', 'sentence_length', 'severity', 'warn', 'message', 'Average sentence is ' || avg_sentence || ' words.', 'fix', 'Split long sentences — aim under 20.');
  ELSIF avg_sentence > 25 THEN
    score := score - 5;
    issues := issues || jsonb_build_object('key', 'sentence_length', 'severity', 'info', 'message', 'Average sentence is ' || avg_sentence || ' words.', 'fix', 'Shorter sentences read faster.');
  END IF;
  IF paragraph_words_avg(plain, paragraphs) > 120 THEN
    score := score - 4;
    issues := issues || jsonb_build_object('key', 'paragraph_length', 'severity', 'info', 'message', 'Paragraphs average ' || paragraph_words_avg(plain, paragraphs) || ' words.', 'fix', 'Keep paragraphs under 90 words on mobile.');
  END IF;
  IF words > 200 AND flesch < 30 THEN
    score := score - 4;
    issues := issues || jsonb_build_object('key', 'readability', 'severity', 'info', 'message', 'Flesch reading ease is ' || flesch || ' (very hard).', 'fix', 'Plain words and shorter sentences lift this.');
  END IF;

  score := GREATEST(0, LEAST(100, score));
  grade := CASE WHEN score >= 90 THEN 'A' WHEN score >= 75 THEN 'B' WHEN score >= 60 THEN 'C' WHEN score >= 40 THEN 'D' ELSE 'F' END;

  RETURN jsonb_build_object(
    'score', score, 'grade', grade,
    'metrics', jsonb_build_object(
      'words', words, 'sentences', sentences, 'paragraphs', paragraphs, 'syllables', syllables,
      'h2', h2, 'h3', h3, 'internal_links', internal_links, 'external_links', external_links,
      'images', images, 'images_missing_alt', images_missing_alt,
      'reading_time_minutes', reading_time, 'flesch_reading_ease', flesch,
      'avg_sentence_words', avg_sentence, 'keyword', NULLIF(kw, ''), 'keyword_count', kw_count,
      'keyword_density', kw_density, 'title_chars', title_len, 'excerpt_chars', excerpt_len,
      'seo_title_chars', seo_title_len, 'seo_description_chars', desc_len
    ),
    'issues', issues,
    'passed', score >= 75
  );
END $fn$;

-- average words per paragraph, shared by the scorer above
CREATE OR REPLACE FUNCTION paragraph_words_avg(p_plain text, p_paragraphs int)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_paragraphs > 0
    THEN round((SELECT count(*) FROM regexp_matches(p_plain, '\S+', 'g'))::numeric / p_paragraphs, 1)
    ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION admin_post_quality(p_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p posts; result jsonb;
BEGIN
  IF NOT admin_can('content.read') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO p FROM posts WHERE id = p_post_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article not found'; END IF;
  result := admin_score_draft(p.title, p.excerpt, p.content, p.focus_keyword, p.seo_title, p.seo_description, p.cover_image, p.cover_image_alt);
  -- keep the stored score fresh so lists and dashboards can sort by it
  UPDATE posts SET seo_score = (result ->> 'score')::int WHERE id = p_post_id;
  RETURN result;
END $$;

-- =====================================================================
-- 3. REVISION LOG (trigger-captured, coalesced, pruned)
-- =====================================================================
ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual';
ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS word_count integer;
ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS seo_score integer;
ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS restored_from uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'article_versions_kind_check') THEN
    ALTER TABLE article_versions ADD CONSTRAINT article_versions_kind_check
      CHECK (kind IN ('manual', 'autosave', 'publish', 'restore', 'ai'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_av_post_saved ON article_versions(post_id, saved_at DESC);

/**
 * Capture a revision whenever a tracked field changes.
 *  * autosaves during typing coalesce into one row per 10 minutes;
 *  * publishing always writes a row;
 *  * at most 50 versions are kept per post.
 */
CREATE OR REPLACE FUNCTION capture_post_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_source text := COALESCE(NULLIF(current_setting('lixxon.audit_source', true), ''), 'trigger');
  v_kind text;
  v_words int;
  v_prev uuid;
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'published' THEN
      -- going live is always worth a revision, even when the text did not move
      v_kind := 'publish';
    ELSIF NEW.title IS NOT DISTINCT FROM OLD.title
       AND NEW.content IS NOT DISTINCT FROM OLD.content
       AND NEW.excerpt IS NOT DISTINCT FROM OLD.excerpt
       AND NEW.seo_title IS NOT DISTINCT FROM OLD.seo_title
       AND NEW.seo_description IS NOT DISTINCT FROM OLD.seo_description THEN
      RETURN NEW;
    ELSIF v_source = 'autosave' THEN
      v_kind := 'autosave';
    ELSE
      v_kind := 'manual';
    END IF;
  ELSE
    v_kind := 'manual';
  END IF;

  v_words := COALESCE(array_length(regexp_split_to_array(btrim(regexp_replace(COALESCE(NEW.content, ''), '[*_`#>\[\]()!-]', ' ', 'g')), '\s+'), 1), 0);

  IF v_kind = 'autosave' THEN
    SELECT id INTO v_prev FROM article_versions
     WHERE post_id = NEW.id AND kind = 'autosave' AND saved_at > now() - interval '10 minutes'
       AND created_by IS NOT DISTINCT FROM v_actor
     ORDER BY saved_at DESC LIMIT 1;
    IF v_prev IS NOT NULL THEN
      UPDATE article_versions
         SET title = NEW.title, content = NEW.content, excerpt = NEW.excerpt,
             saved_at = now(), word_count = v_words
       WHERE id = v_prev;
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO article_versions (post_id, title, content, excerpt, saved_by, version_note, kind, word_count, created_by)
  VALUES (NEW.id, NEW.title, NEW.content, NEW.excerpt,
          COALESCE(auth.jwt() ->> 'email', 'system'),
          CASE v_kind WHEN 'publish' THEN 'Published' WHEN 'autosave' THEN 'Autosave' ELSE 'Saved' END,
          v_kind, v_words, v_actor);

  DELETE FROM article_versions v
   WHERE v.post_id = NEW.id
     AND v.id NOT IN (SELECT id FROM article_versions WHERE post_id = NEW.id ORDER BY saved_at DESC LIMIT 50);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_capture_post_version ON posts;
CREATE TRIGGER trg_capture_post_version AFTER INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION capture_post_version();

-- revisions are editorial material: readers must never read or write them
DROP POLICY IF EXISTS "rl_av_select" ON article_versions;
DROP POLICY IF EXISTS "rl_av_insert" ON article_versions;
DROP POLICY IF EXISTS "rl_av_delete" ON article_versions;
DROP POLICY IF EXISTS article_versions_admin_all ON article_versions;
DROP POLICY IF EXISTS article_versions_rbac_read ON article_versions;
DROP POLICY IF EXISTS article_versions_rbac_write ON article_versions;
CREATE POLICY article_versions_rbac_read ON article_versions FOR SELECT TO authenticated
  USING ((SELECT admin_can('content.read')) OR (SELECT admin_can('content.write')));
CREATE POLICY article_versions_rbac_write ON article_versions FOR ALL TO authenticated
  USING ((SELECT admin_can('content.write')))
  WITH CHECK ((SELECT admin_can('content.write')));

-- autosave rows coalesce in the audit log too (before insert, so the log stays readable)
CREATE OR REPLACE FUNCTION coalesce_autosave_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prev uuid;
BEGIN
  IF current_setting('lixxon.audit_source', true) IS DISTINCT FROM 'autosave' THEN RETURN NEW; END IF;
  NEW.source := 'autosave';
  SELECT id INTO v_prev FROM admin_activity_log
   WHERE source = 'autosave' AND entity_type = NEW.entity_type AND entity_id = NEW.entity_id
     AND actor_id IS NOT DISTINCT FROM NEW.actor_id AND created_at > now() - interval '10 minutes'
   ORDER BY seq DESC LIMIT 1;
  IF v_prev IS NULL THEN RETURN NEW; END IF;
  UPDATE admin_activity_log
     SET changes = NEW.changes, after = NEW.after, created_at = NEW.created_at,
         description = NEW.description, ip = COALESCE(NEW.ip, ip)
   WHERE id = v_prev;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_audit_coalesce_autosave ON admin_activity_log;
CREATE TRIGGER trg_audit_coalesce_autosave BEFORE INSERT ON admin_activity_log
  FOR EACH ROW EXECUTE FUNCTION coalesce_autosave_audit();

-- =====================================================================
-- 4. AUTOSAVE
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_autosave_post(p_post_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  allowed text[] := ARRAY['title','slug','excerpt','content','cover_image','cover_image_alt','category_id',
    'author_id','tags','seo_title','seo_description','canonical_url','focus_keyword','og_title','og_description',
    'og_image','robots','schema_type','takeaways','faq','alt_title','series_id','series_order','allow_comments',
    'content_warnings','is_evergreen','editor_notes','workflow_status'];
  clean jsonb := '{}'::jsonb;
  k text;
  v_words int;
BEGIN
  IF NOT admin_can('content.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_post_id IS NULL THEN RAISE EXCEPTION 'post id required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM posts WHERE id = p_post_id) THEN RAISE EXCEPTION 'Article not found'; END IF;

  FOR k IN SELECT jsonb_object_keys(COALESCE(p_patch, '{}'::jsonb)) LOOP
    IF k = ANY(allowed) THEN clean := clean || jsonb_build_object(k, p_patch -> k); END IF;
  END LOOP;
  IF clean = '{}'::jsonb THEN RETURN jsonb_build_object('ok', true, 'saved_at', now(), 'changed', 0); END IF;

  -- the workflow status may not jump straight to published from an autosave
  IF clean ? 'workflow_status' AND (clean ->> 'workflow_status') = 'published'
     AND NOT admin_can('content.publish') THEN
    clean := clean - 'workflow_status';
  END IF;

  PERFORM set_config('lixxon.audit_source', 'autosave', true);

  UPDATE posts SET
    title = COALESCE(clean ->> 'title', title),
    slug = COALESCE(NULLIF(clean ->> 'slug', ''), slug),
    excerpt = CASE WHEN clean ? 'excerpt' THEN clean ->> 'excerpt' END,
    content = CASE WHEN clean ? 'content' THEN clean ->> 'content' END,
    cover_image = CASE WHEN clean ? 'cover_image' THEN NULLIF(clean ->> 'cover_image', '') END,
    cover_image_alt = CASE WHEN clean ? 'cover_image_alt' THEN NULLIF(clean ->> 'cover_image_alt', '') END,
    category_id = CASE WHEN clean ? 'category_id' THEN NULLIF(clean ->> 'category_id', '')::uuid END,
    author_id = CASE WHEN clean ? 'author_id' THEN NULLIF(clean ->> 'author_id', '')::uuid END,
    tags = CASE WHEN clean ? 'tags' THEN ARRAY(SELECT jsonb_array_elements_text(clean -> 'tags')) ELSE tags END,
    seo_title = CASE WHEN clean ? 'seo_title' THEN NULLIF(clean ->> 'seo_title', '') END,
    seo_description = CASE WHEN clean ? 'seo_description' THEN NULLIF(clean ->> 'seo_description', '') END,
    canonical_url = CASE WHEN clean ? 'canonical_url' THEN NULLIF(clean ->> 'canonical_url', '') END,
    focus_keyword = CASE WHEN clean ? 'focus_keyword' THEN NULLIF(lower(clean ->> 'focus_keyword'), '') END,
    og_title = CASE WHEN clean ? 'og_title' THEN NULLIF(clean ->> 'og_title', '') END,
    og_description = CASE WHEN clean ? 'og_description' THEN NULLIF(clean ->> 'og_description', '') END,
    og_image = CASE WHEN clean ? 'og_image' THEN NULLIF(clean ->> 'og_image', '') END,
    robots = COALESCE(clean ->> 'robots', robots),
    schema_type = COALESCE(clean ->> 'schema_type', schema_type),
    takeaways = CASE WHEN clean ? 'takeaways' THEN ARRAY(SELECT jsonb_array_elements_text(clean -> 'takeaways')) ELSE takeaways END,
    faq = CASE WHEN clean ? 'faq' THEN clean -> 'faq' ELSE faq END,
    alt_title = CASE WHEN clean ? 'alt_title' THEN NULLIF(clean ->> 'alt_title', '') END,
    series_id = CASE WHEN clean ? 'series_id' THEN NULLIF(clean ->> 'series_id', '')::uuid END,
    series_order = CASE WHEN clean ? 'series_order' THEN NULLIF(clean ->> 'series_order', '')::int END,
    allow_comments = COALESCE((clean ->> 'allow_comments')::boolean, allow_comments),
    content_warnings = CASE WHEN clean ? 'content_warnings' THEN ARRAY(SELECT jsonb_array_elements_text(clean -> 'content_warnings')) ELSE content_warnings END,
    is_evergreen = COALESCE((clean ->> 'is_evergreen')::boolean, is_evergreen),
    editor_notes = CASE WHEN clean ? 'editor_notes' THEN clean ->> 'editor_notes' END,
    workflow_status = COALESCE(clean ->> 'workflow_status', workflow_status),
    autosave_at = now(),
    last_edited_by = auth.uid(),
    word_count = COALESCE(array_length(regexp_split_to_array(btrim(regexp_replace(COALESCE(clean ->> 'content', content, ''), '[*_`#>\[\]()!-]', ' ', 'g')), '\s+'), 1), 0)
  WHERE id = p_post_id;

  PERFORM set_config('lixxon.audit_source', '', true);
  v_words := (SELECT word_count FROM posts WHERE id = p_post_id);
  RETURN jsonb_build_object('ok', true, 'saved_at', now(), 'words', v_words);
END $$;

-- =====================================================================
-- 5. WORKFLOW + REVISIONS
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_submit_review(p_post_id uuid, p_note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT admin_can('content.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE posts SET workflow_status = 'in_review', review_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
                   last_edited_by = auth.uid()
   WHERE id = p_post_id AND workflow_status IN ('draft', 'in_review');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only drafts can be sent for review'; END IF;
  RETURN 'in_review';
END $$;

CREATE OR REPLACE FUNCTION admin_approve_post(p_post_id uuid, p_publish boolean DEFAULT false, p_note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_slug text;
BEGIN
  IF NOT admin_can('content.publish') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT slug INTO v_slug FROM posts WHERE id = p_post_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article not found'; END IF;

  UPDATE posts SET workflow_status = CASE WHEN p_publish THEN 'published' ELSE 'approved' END,
                   status = CASE WHEN p_publish THEN 'published' ELSE status END,
                   published_at = CASE WHEN p_publish THEN COALESCE(published_at, now()) ELSE published_at END,
                   reviewed_by = auth.uid(), reviewed_at = now(),
                   review_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), review_note),
                   seo_score = COALESCE((admin_score_draft(title, excerpt, content, focus_keyword, seo_title, seo_description, cover_image, cover_image_alt) ->> 'score')::int, seo_score)
   WHERE id = p_post_id;

  RETURN CASE WHEN p_publish THEN 'published' ELSE 'approved' END;
END $$;

CREATE OR REPLACE FUNCTION admin_reject_post(p_post_id uuid, p_note text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT admin_can('content.publish') AND NOT admin_can('content.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF COALESCE(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'Say what needs changing'; END IF;
  UPDATE posts SET workflow_status = 'draft', review_note = btrim(p_note),
                   reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = p_post_id;
  RETURN 'draft';
END $$;

CREATE OR REPLACE FUNCTION admin_save_revision(p_post_id uuid, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT admin_can('content.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO article_versions (post_id, title, content, excerpt, saved_by, version_note, kind, word_count, created_by)
  SELECT p.id, p.title, p.content, p.excerpt, COALESCE(auth.jwt() ->> 'email', 'system'),
         COALESCE(NULLIF(btrim(p_note), ''), 'Manual snapshot'), 'manual',
         COALESCE(array_length(regexp_split_to_array(btrim(regexp_replace(COALESCE(p.content, ''), '[*_`#>\[\]()!-]', ' ', 'g')), '\s+'), 1), 0),
         auth.uid()
    FROM posts p WHERE p.id = p_post_id
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Article not found'; END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION admin_list_revisions(p_post_id uuid, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT admin_can('content.read') THEN '[]'::jsonb ELSE
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'title', v.title, 'excerpt', v.excerpt, 'saved_at', v.saved_at,
      'saved_by', v.saved_by, 'note', v.version_note, 'kind', v.kind,
      'word_count', v.word_count, 'chars', length(COALESCE(v.content, ''))
    ) ORDER BY v.saved_at DESC)
    FROM (SELECT * FROM article_versions WHERE post_id = p_post_id ORDER BY saved_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) v), '[]'::jsonb)
  END
$$;

CREATE OR REPLACE FUNCTION admin_restore_revision(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v article_versions;
BEGIN
  IF NOT admin_can('content.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v FROM article_versions WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Revision not found'; END IF;

  UPDATE posts SET title = v.title, content = v.content, excerpt = v.excerpt,
                   word_count = COALESCE(v.word_count, word_count), last_edited_by = auth.uid()
   WHERE id = v.post_id;

  INSERT INTO article_versions (post_id, title, content, excerpt, saved_by, version_note, kind, created_by, restored_from)
  VALUES (v.post_id, v.title, v.content, v.excerpt, COALESCE(auth.jwt() ->> 'email', 'system'),
          'Restored the version from ' || to_char(v.saved_at, 'YYYY-MM-DD HH24:MI'), 'restore', auth.uid(), v.id);

  RETURN jsonb_build_object('ok', true, 'post_id', v.post_id, 'title', v.title);
END $$;

-- =====================================================================
-- 6. BULK ACTIONS, DUPLICATE, INTERNAL LINKS, DASHBOARD
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_bulk_post_action(p_ids uuid[], p_action text, p_value jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids uuid[] := COALESCE(p_ids, ARRAY[]::uuid[]); n int := 0; v_when timestamptz;
BEGIN
  IF array_length(v_ids, 1) IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Select at least one article'); END IF;

  IF p_action IN ('publish', 'unpublish', 'schedule', 'archive') AND NOT admin_can('content.publish') THEN
    RAISE EXCEPTION 'forbidden';
  ELSIF p_action IN ('feature', 'unfeature', 'editors_pick', 'unpick', 'pin', 'unpin') AND NOT (admin_can('collections.manage') OR admin_can('content.publish')) THEN
    RAISE EXCEPTION 'forbidden';
  ELSIF p_action IN ('delete', 'duplicate') AND NOT admin_can('content.delete') THEN
    RAISE EXCEPTION 'forbidden';
  ELSIF p_action = 'submit_review' THEN
    IF NOT admin_can('content.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  ELSIF NOT admin_can('content.write') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  CASE p_action
    WHEN 'publish' THEN
      UPDATE posts SET status = 'published', workflow_status = 'published',
                       published_at = COALESCE(published_at, now()) WHERE id = ANY(v_ids);
    WHEN 'unpublish' THEN
      UPDATE posts SET status = 'draft', workflow_status = 'draft' WHERE id = ANY(v_ids);
    WHEN 'schedule' THEN
      v_when := COALESCE(NULLIF(p_value ->> 'when', '')::timestamptz, now() + interval '1 day');
      UPDATE posts SET status = 'scheduled', workflow_status = 'scheduled', scheduled_at = v_when WHERE id = ANY(v_ids);
    WHEN 'archive' THEN
      UPDATE posts SET status = 'archived', workflow_status = 'archived' WHERE id = ANY(v_ids);
    WHEN 'submit_review' THEN
      UPDATE posts SET workflow_status = 'in_review' WHERE id = ANY(v_ids) AND workflow_status = 'draft';
    WHEN 'feature' THEN UPDATE posts SET featured = true WHERE id = ANY(v_ids);
    WHEN 'unfeature' THEN UPDATE posts SET featured = false WHERE id = ANY(v_ids);
    WHEN 'editors_pick' THEN UPDATE posts SET editors_pick = true WHERE id = ANY(v_ids);
    WHEN 'unpick' THEN UPDATE posts SET editors_pick = false WHERE id = ANY(v_ids);
    WHEN 'pin' THEN UPDATE posts SET is_pinned = true, pinned_until = COALESCE(NULLIF(p_value ->> 'until', '')::timestamptz, now() + interval '7 days') WHERE id = ANY(v_ids);
    WHEN 'unpin' THEN UPDATE posts SET is_pinned = false, pinned_until = NULL WHERE id = ANY(v_ids);
    WHEN 'set_category' THEN UPDATE posts SET category_id = NULLIF(p_value ->> 'category_id', '')::uuid WHERE id = ANY(v_ids);
    WHEN 'set_author' THEN UPDATE posts SET author_id = NULLIF(p_value ->> 'author_id', '')::uuid WHERE id = ANY(v_ids);
    WHEN 'add_tag' THEN
      IF COALESCE(p_value ->> 'tag', '') <> '' THEN
        UPDATE posts SET tags = (SELECT array_agg(DISTINCT t) FROM unnest(tags || ARRAY[lower(btrim(p_value ->> 'tag'))]) t) WHERE id = ANY(v_ids);
      END IF;
    WHEN 'remove_tag' THEN
      IF COALESCE(p_value ->> 'tag', '') <> '' THEN
        UPDATE posts SET tags = array_remove(tags, lower(btrim(p_value ->> 'tag'))) WHERE id = ANY(v_ids);
      END IF;
    WHEN 'delete' THEN
      DELETE FROM posts WHERE id = ANY(v_ids);
    WHEN 'duplicate' THEN
      PERFORM admin_duplicate_post(x) FROM unnest(v_ids) x;
    ELSE
      RAISE EXCEPTION 'Unknown action %', p_action;
  END CASE;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'action', p_action, 'count', n);
END $$;

CREATE OR REPLACE FUNCTION admin_duplicate_post(p_post_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; p posts; v_slug text; v_n int := 1;
BEGIN
  IF NOT admin_can('content.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO p FROM posts WHERE id = p_post_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article not found'; END IF;

  v_slug := p.slug || '-copy';
  WHILE EXISTS (SELECT 1 FROM posts WHERE slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := p.slug || '-copy-' || v_n;
  END LOOP;

  INSERT INTO posts (title, slug, excerpt, content, cover_image, cover_image_alt, category_id, author_id,
                     tags, status, workflow_status, published_at, seo_title, seo_description, canonical_url,
                     featured, editors_pick, reading_time_minutes, takeaways, faq, alt_title, series_id,
                     series_order, allow_comments, focus_keyword, schema_type, content_warnings, is_evergreen,
                     last_edited_by)
  VALUES (p.title || ' (copy)', v_slug, p.excerpt, p.content, p.cover_image, p.cover_image_alt, p.category_id,
          p.author_id, p.tags, 'draft', 'draft', now(), p.seo_title, p.seo_description, NULL,
          false, false, p.reading_time_minutes, p.takeaways, p.faq, p.alt_title, p.series_id,
          p.series_order, p.allow_comments, p.focus_keyword, p.schema_type, p.content_warnings, p.is_evergreen,
          auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

/**
 * Internal link candidates for the draft: posts that share tags or words with the text,
 * ranked by overlap, excluding itself and anything already linked.
 */
CREATE OR REPLACE FUNCTION admin_internal_link_suggestions(p_post_id uuid DEFAULT NULL, p_query text DEFAULT NULL, p_limit integer DEFAULT 6)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT p.id, p.tags, lower(COALESCE(p.content, '') || ' ' || COALESCE(p.title, '') || ' ' || COALESCE(p_query, '')) AS haystack
    FROM posts p WHERE p.id = p_post_id
  ), terms AS (
    SELECT DISTINCT t FROM (
      SELECT unnest(COALESCE((SELECT tags FROM me), ARRAY[]::text[])) AS t
      UNION ALL
      SELECT m[1] FROM regexp_matches(COALESCE((SELECT haystack FROM me), lower(COALESCE(p_query, ''))), '[a-z]{5,}', 'g') AS m
    ) x WHERE length(t) BETWEEN 5 AND 24
  ), linked AS (
    SELECT m[1] AS slug
      FROM posts p, regexp_matches(COALESCE(p.content, ''), '/blog/([a-z0-9-]+)', 'g') AS m
     WHERE p.id = p_post_id
  ), scored AS (
    SELECT c.id, c.title, c.slug, c.excerpt, c.tags, c.published_at, c.view_count,
           (SELECT count(*) FROM terms t WHERE c.tags @> ARRAY[t.t] OR c.title ILIKE '%' || t.t || '%') AS overlap
      FROM posts c
     WHERE c.status = 'published'
       AND (p_post_id IS NULL OR c.id <> p_post_id)
       AND NOT EXISTS (SELECT 1 FROM linked l WHERE l.slug = c.slug)
  )
  SELECT CASE WHEN NOT admin_can('content.read') THEN '[]'::jsonb ELSE
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'title', s.title, 'url', '/blog/' || s.slug, 'excerpt', left(COALESCE(s.excerpt, ''), 160),
      'tags', s.tags, 'overlap', s.overlap, 'views', COALESCE(s.view_count, 0),
      'anchor', COALESCE(NULLIF(left(s.title, 60), ''), s.slug)
    ) ORDER BY s.overlap DESC, COALESCE(s.view_count, 0) DESC)
    FROM (SELECT * FROM scored ORDER BY overlap DESC, view_count DESC NULLS LAST LIMIT LEAST(GREATEST(COALESCE(p_limit, 6), 1), 20)) s), '[]'::jsonb)
  END
$$;

CREATE OR REPLACE FUNCTION admin_content_dashboard()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT admin_can('content.read') THEN '{}'::jsonb ELSE jsonb_build_object(
    'counts', (SELECT jsonb_build_object(
      'draft', count(*) FILTER (WHERE workflow_status = 'draft'),
      'in_review', count(*) FILTER (WHERE workflow_status = 'in_review'),
      'approved', count(*) FILTER (WHERE workflow_status = 'approved'),
      'scheduled', count(*) FILTER (WHERE status = 'scheduled'),
      'published', count(*) FILTER (WHERE status = 'published'),
      'archived', count(*) FILTER (WHERE status = 'archived')) FROM posts),
    'stale_drafts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'updated_at', updated_at, 'words', word_count, 'score', seo_score,
        'days', round(EXTRACT(epoch FROM now() - updated_at) / 86400)) ORDER BY updated_at)
      FROM (SELECT * FROM posts WHERE workflow_status IN ('draft', 'in_review') AND updated_at < now() - interval '14 days'
             ORDER BY updated_at LIMIT 10) d), '[]'::jsonb),
    'scheduled', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'when', scheduled_at) ORDER BY scheduled_at)
      FROM (SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at IS NOT NULL ORDER BY scheduled_at LIMIT 10) s), '[]'::jsonb),
    'low_quality_published', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'score', COALESCE(seo_score, 0), 'words', word_count) ORDER BY COALESCE(seo_score, 0))
      FROM (SELECT * FROM posts WHERE status = 'published' AND COALESCE(seo_score, 0) < 60 AND published_at > now() - interval '180 days'
             ORDER BY COALESCE(seo_score, 0) LIMIT 10) q), '[]'::jsonb),
    'missing_meta', (SELECT count(*) FROM posts WHERE status = 'published'
                      AND (COALESCE(seo_description, '') = '' OR COALESCE(cover_image, '') = '' OR COALESCE(focus_keyword, '') = '')),
    'avg_score', (SELECT round(avg(seo_score)) FROM posts WHERE status = 'published' AND seo_score IS NOT NULL),
    'words_30d', (SELECT COALESCE(sum(word_count), 0) FROM posts WHERE status = 'published' AND published_at > now() - interval '30 days'),
    'cadence_8w', COALESCE((SELECT jsonb_agg(jsonb_build_object('week', w, 'posts', c) ORDER BY w)
      FROM (SELECT date_trunc('week', published_at)::date AS w, count(*) AS c FROM posts
             WHERE status = 'published' AND published_at > now() - interval '8 weeks' GROUP BY 1) x), '[]'::jsonb),
    'by_category', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', name, 'posts', c) ORDER BY c DESC)
      FROM (SELECT COALESCE(c2.name, 'Uncategorised') AS name, count(*) AS c FROM posts p
              LEFT JOIN categories c2 ON c2.id = p.category_id
             WHERE p.status = 'published' GROUP BY 1 ORDER BY c DESC LIMIT 12) y), '[]'::jsonb)
  ) END
$$;

-- =====================================================================
-- 6b. PRODUCT QUALITY (same contract as the article scorer, so both editors share a panel)
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_score_product(p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  j jsonb := COALESCE(p_patch, '{}'::jsonb);
  name text := COALESCE(j ->> 'name', '');
  descr text := COALESCE(j ->> 'description', '');
  image_url text := COALESCE(j ->> 'image_url', '');
  price_cents numeric := COALESCE(NULLIF(j ->> 'price_cents', '')::numeric, NULLIF(j ->> 'price', '')::numeric * 100);
  compare_cents numeric := COALESCE(NULLIF(j ->> 'compare_price', '')::numeric * 100, NULLIF(j ->> 'compare_cents', '')::numeric);
  seo_title text := COALESCE(j ->> 'seo_title', '');
  seo_desc text := COALESCE(j ->> 'seo_description', '');
  slug text := COALESCE(j ->> 'slug', '');
  gallery jsonb := COALESCE(j -> 'gallery', '[]'::jsonb);
  tags jsonb := COALESCE(j -> 'tags', '[]'::jsonb);
  sponsored boolean := COALESCE((j ->> 'is_sponsored')::boolean, false);
  disclosure text := COALESCE(j ->> 'disclosure_text', '');
  product_type text := COALESCE(j ->> 'product_type', '');
  file_path text := COALESCE(j ->> 'file_path', '');
  issues jsonb := '[]'::jsonb;
  score int := 100;
  gallery_count int := jsonb_array_length(gallery);
BEGIN
  IF btrim(name) = '' THEN
    score := score - 30;
    issues := issues || jsonb_build_object('key', 'name', 'severity', 'error', 'message', 'The product has no name.', 'fix', 'Give it the name a shopper would search for.');
  ELSIF length(btrim(name)) > 70 THEN
    score := score - 5;
    issues := issues || jsonb_build_object('key', 'name_length', 'severity', 'info', 'message', 'The name is ' || length(btrim(name)) || ' characters — cards will truncate it.', 'fix', 'Keep names under 60 characters.');
  END IF;

  IF length(btrim(descr)) < 120 THEN
    score := score - 18;
    issues := issues || jsonb_build_object('key', 'description', 'severity', 'error', 'message', 'The description is only ' || length(btrim(descr)) || ' characters.', 'fix', 'Write at least 300 characters: what it is, who it suits, why we recommend it.');
  ELSIF length(btrim(descr)) < 400 THEN
    score := score - 8;
    issues := issues || jsonb_build_object('key', 'description_short', 'severity', 'warn', 'message', 'The description is on the short side.', 'fix', 'Add ingredients, how to use it, or what is included.');
  END IF;

  IF image_url = '' THEN
    score := score - 15;
    issues := issues || jsonb_build_object('key', 'image', 'severity', 'error', 'message', 'No product image.', 'fix', 'Pick one from the media library.');
  END IF;
  IF gallery_count = 0 THEN
    score := score - 4;
    issues := issues || jsonb_build_object('key', 'gallery', 'severity', 'info', 'message', 'No gallery images.', 'fix', 'Two or three extra shots lift conversion.');
  END IF;

  IF price_cents IS NULL OR price_cents <= 0 THEN
    score := score - 12;
    issues := issues || jsonb_build_object('key', 'price', 'severity', 'error', 'message', 'No price set (or it is zero).', 'fix', 'Set the price in cents so the storefront and Stripe agree.', 'fix_field', 'price');
  ELSIF compare_cents IS NOT NULL AND compare_cents <= price_cents THEN
    score := score - 4;
    issues := issues || jsonb_build_object('key', 'compare_price', 'severity', 'warn', 'message', 'The compare-at price is not above the price, so no discount shows.', 'fix', 'Raise it above the price or clear it.');
  END IF;

  IF seo_desc = '' THEN
    score := score - 8;
    issues := issues || jsonb_build_object('key', 'seo_description', 'severity', 'warn', 'message', 'No meta description.', 'fix', '110–160 characters describing the product.');
  ELSIF length(seo_desc) < 110 OR length(seo_desc) > 160 THEN
    score := score - 3;
    issues := issues || jsonb_build_object('key', 'seo_description_length', 'severity', 'info', 'message', 'The meta description is ' || length(seo_desc) || ' characters.', 'fix', 'Trim to 110–160.');
  END IF;
  IF seo_title = '' THEN
    score := score - 4;
    issues := issues || jsonb_build_object('key', 'seo_title', 'severity', 'info', 'message', 'No SEO title.', 'fix', 'Short titles read better in results.');
  END IF;
  IF slug = '' THEN
    score := score - 6;
    issues := issues || jsonb_build_object('key', 'slug', 'severity', 'warn', 'message', 'No URL slug.', 'fix', 'Use the product name, hyphenated.');
  END IF;
  IF jsonb_array_length(tags) = 0 THEN
    score := score - 5;
    issues := issues || jsonb_build_object('key', 'tags', 'severity', 'info', 'message', 'No tags — collections and search rely on them.', 'fix', 'Add three or four.');
  END IF;
  IF COALESCE(j ->> 'shop_category_id', '') = '' THEN
    score := score - 4;
    issues := issues || jsonb_build_object('key', 'shop_category', 'severity', 'info', 'message', 'Not filed under a shop category.', 'fix', 'Pick one so it appears in the shop.');
  END IF;
  IF sponsored AND btrim(disclosure) = '' THEN
    score := score - 10;
    issues := issues || jsonb_build_object('key', 'disclosure', 'severity', 'error', 'message', 'Sponsored product without a disclosure.', 'fix', 'Add the disclosure text — ad rules require it.');
  END IF;
  IF product_type = 'digital' AND file_path = '' THEN
    score := score - 12;
    issues := issues || jsonb_build_object('key', 'file', 'severity', 'error', 'message', 'Digital product with no file attached.', 'fix', 'Upload the deliverable so buyers can download it.');
  END IF;

  score := GREATEST(0, LEAST(100, score));
  RETURN jsonb_build_object(
    'score', score,
    'grade', CASE WHEN score >= 90 THEN 'A' WHEN score >= 75 THEN 'B' WHEN score >= 60 THEN 'C' WHEN score >= 40 THEN 'D' ELSE 'F' END,
    'metrics', jsonb_build_object(
      'description_chars', length(btrim(descr)), 'gallery_images', gallery_count,
      'tags', jsonb_array_length(tags), 'has_image', image_url <> '',
      'price_cents', price_cents, 'words', (SELECT count(*) FROM regexp_matches(btrim(descr), '\S+', 'g'))
    ),
    'issues', issues,
    'passed', score >= 75
  );
END $$;

CREATE OR REPLACE FUNCTION admin_product_quality(p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT admin_can('commerce.read') AND NOT admin_can('content.read') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT admin_score_product(to_jsonb(p)) INTO result FROM products p WHERE p.id = p_product_id;
  IF result IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
  UPDATE products SET seo_score = (result ->> 'score')::int WHERE id = p_product_id;
  RETURN result;
END $$;

-- =====================================================================
-- 7. SCHEDULED PUBLISHING understands the workflow too
-- =====================================================================
CREATE OR REPLACE FUNCTION publish_scheduled_posts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE posts
     SET status = 'published', workflow_status = 'published',
         published_at = COALESCE(published_at, scheduled_at, now()),
         reviewed_at = COALESCE(reviewed_at, now())
   WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= now();

  UPDATE posts SET is_pinned = false, pinned_until = NULL
   WHERE is_pinned AND pinned_until IS NOT NULL AND pinned_until <= now();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- =====================================================================
-- 8. GRANTS
-- =====================================================================
REVOKE ALL ON FUNCTION admin_score_draft(text, text, text, text, text, text, text, text) FROM public;
REVOKE ALL ON FUNCTION admin_post_quality(uuid) FROM public;
REVOKE ALL ON FUNCTION admin_autosave_post(uuid, jsonb) FROM public;
REVOKE ALL ON FUNCTION admin_submit_review(uuid, text) FROM public;
REVOKE ALL ON FUNCTION admin_approve_post(uuid, boolean, text) FROM public;
REVOKE ALL ON FUNCTION admin_reject_post(uuid, text) FROM public;
REVOKE ALL ON FUNCTION admin_save_revision(uuid, text) FROM public;
REVOKE ALL ON FUNCTION admin_list_revisions(uuid, integer) FROM public;
REVOKE ALL ON FUNCTION admin_restore_revision(uuid) FROM public;
REVOKE ALL ON FUNCTION admin_bulk_post_action(uuid[], text, jsonb) FROM public;
REVOKE ALL ON FUNCTION admin_duplicate_post(uuid) FROM public;
REVOKE ALL ON FUNCTION admin_internal_link_suggestions(uuid, text, integer) FROM public;
REVOKE ALL ON FUNCTION admin_content_dashboard() FROM public;
REVOKE ALL ON FUNCTION admin_score_product(jsonb) FROM public;
REVOKE ALL ON FUNCTION admin_product_quality(uuid) FROM public;

GRANT EXECUTE ON FUNCTION admin_score_draft(text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_post_quality(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_autosave_post(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_submit_review(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_approve_post(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reject_post(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_save_revision(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_list_revisions(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_restore_revision(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_bulk_post_action(uuid[], text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_duplicate_post(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_internal_link_suggestions(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_content_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_score_product(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_product_quality(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
