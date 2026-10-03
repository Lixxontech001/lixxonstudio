/*
# Create digital-products storage bucket

Creates a private storage bucket for hosting digital product files (PDFs, ebooks, etc.).
This bucket is private — files are only accessible via signed URLs generated after
verified purchase, preventing unauthorized downloads.

## Changes
- New storage bucket: `digital-products` (private)
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('digital-products', 'digital-products', false)
ON CONFLICT (id) DO NOTHING;
