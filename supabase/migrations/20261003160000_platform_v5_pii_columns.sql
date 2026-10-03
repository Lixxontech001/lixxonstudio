-- =============================================================================
-- v5 — column-level PII hardening for user-generated content
-- Public policies allow reading approved comments / reviews / questions, but the
-- rows also carry the author's email and device fingerprint. Those columns must
-- never reach the browser of other visitors. Column privileges are revoked from
-- anon + authenticated and admins read through is_admin()-guarded views instead.
-- =============================================================================

-- A column-level REVOKE is a no-op while a table-level SELECT grant exists, so the
-- table grant is dropped and re-issued for the safe columns only. Clients therefore
-- must select explicit columns on these tables (select('*') would fail for anon).
REVOKE SELECT ON comments FROM anon, authenticated;
GRANT SELECT (id, post_id, parent_id, author_name, content, is_visible, is_approved, admin_reply,
              is_pinned, edited_at, report_count, created_at) ON comments TO anon, authenticated;

REVOKE SELECT ON product_reviews FROM anon, authenticated;
GRANT SELECT (id, product_id, author_name, rating, content, is_approved, verified_purchase, created_at)
  ON product_reviews TO anon, authenticated;

REVOKE SELECT ON article_questions FROM anon, authenticated;
GRANT SELECT (id, post_id, author_name, question, answer, answered_by, answered_at, is_public, upvotes, created_at)
  ON article_questions TO anon, authenticated;

-- Admin-only full views (SECURITY DEFINER semantics: owned by postgres, gated by is_admin())
CREATE OR REPLACE VIEW admin_comments AS
  SELECT c.* FROM comments c WHERE is_admin();
CREATE OR REPLACE VIEW admin_reviews AS
  SELECT r.* FROM product_reviews r WHERE is_admin();
CREATE OR REPLACE VIEW admin_questions AS
  SELECT q.* FROM article_questions q WHERE is_admin();

REVOKE ALL ON admin_comments, admin_reviews, admin_questions FROM anon;
GRANT SELECT ON admin_comments, admin_reviews, admin_questions TO authenticated;

-- Assertion: anon must not be able to see any of the PII columns
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
     WHERE grantee IN ('anon','authenticated') AND privilege_type = 'SELECT'
       AND ((table_name = 'comments' AND column_name IN ('author_email','fingerprint'))
         OR (table_name = 'product_reviews' AND column_name = 'customer_email')
         OR (table_name = 'article_questions' AND column_name = 'author_email'))
  ) THEN RAISE EXCEPTION 'Security assertion failed: PII columns still readable by public roles'; END IF;
END $$;
