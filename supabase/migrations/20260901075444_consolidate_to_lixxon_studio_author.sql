-- Create the single editorial identity "Lixxon Studio"
INSERT INTO authors (name, slug, bio, role)
VALUES (
  'Lixxon Studio',
  'lixxon-studio',
  'A daily digital magazine covering skincare science, intentional style, and minimalist wellness. Expert-written, beautifully edited, designed to be read slowly.',
  'Editorial Team'
)
ON CONFLICT (slug) DO NOTHING;

-- Point all existing posts to the Lixxon Studio author
UPDATE posts
SET author_id = (SELECT id FROM authors WHERE slug = 'lixxon-studio')
WHERE author_id IS NOT NULL
  AND author_id != (SELECT id FROM authors WHERE slug = 'lixxon-studio');
