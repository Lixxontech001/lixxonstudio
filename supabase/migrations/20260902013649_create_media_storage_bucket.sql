/*
# Create media storage bucket

1. Creates a public storage bucket named 'media' for uploading editorial images.
2. Sets public read access so images can be served to the website.
3. Allows authenticated users to upload and manage files.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access
DROP POLICY IF EXISTS "public_read_media_bucket" ON storage.objects;
CREATE POLICY "public_read_media_bucket" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'media');

-- Authenticated can upload
DROP POLICY IF EXISTS "auth_upload_media_bucket" ON storage.objects;
CREATE POLICY "auth_upload_media_bucket" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media');

-- Authenticated can update
DROP POLICY IF EXISTS "auth_update_media_bucket" ON storage.objects;
CREATE POLICY "auth_update_media_bucket" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'media') WITH CHECK (bucket_id = 'media');

-- Authenticated can delete
DROP POLICY IF EXISTS "auth_delete_media_bucket" ON storage.objects;
CREATE POLICY "auth_delete_media_bucket" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'media');
