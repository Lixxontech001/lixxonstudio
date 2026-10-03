CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  author_name text NOT NULL CHECK (length(trim(author_name)) >= 2 AND length(trim(author_name)) <= 50),
  author_email text NOT NULL CHECK (position('@' in author_email) > 1 AND length(trim(author_email)) >= 5),
  content text NOT NULL CHECK (length(trim(content)) >= 3 AND length(trim(content)) <= 1000),
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_comments" ON comments;
CREATE POLICY "public_read_comments" ON comments FOR SELECT
  TO anon, authenticated USING (is_visible = true);

DROP POLICY IF EXISTS "public_insert_comments" ON comments;
CREATE POLICY "public_insert_comments" ON comments FOR INSERT
  TO anon, authenticated WITH CHECK (
    is_visible = true AND
    length(trim(author_name)) >= 2 AND
    length(trim(author_name)) <= 50 AND
    position('@' in author_email) > 1 AND
    length(trim(author_email)) >= 5 AND
    length(trim(content)) >= 3 AND
    length(trim(content)) <= 1000
  );

CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);