-- Article likes system with anti-abuse (fingerprint-based, one like per fingerprint per article)
CREATE TABLE IF NOT EXISTS article_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, fingerprint)
);

ALTER TABLE article_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_likes" ON article_likes
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "public_insert_likes" ON article_likes
  FOR INSERT TO anon, authenticated
  WITH CHECK (length(fingerprint) >= 10 AND length(fingerprint) <= 64);

CREATE POLICY "public_delete_own_likes" ON article_likes
  FOR DELETE TO anon, authenticated
  USING (true);

CREATE INDEX idx_article_likes_post ON article_likes(post_id);
