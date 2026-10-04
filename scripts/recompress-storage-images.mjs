import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
const bucket = process.env.STORAGE_BUCKET?.trim() || 'media';
const maxFiles = Math.max(1, Math.min(Number.parseInt(process.env.MAX_FILES || '4', 10) || 4, 20));
const dryRun = process.env.DRY_RUN === 'true';
const minBytes = 250_000;
const maxDimension = 1600;
const quality = 78;

if (!supabaseUrl) throw new Error('SUPABASE_URL is required.');
if (!secretKey) throw new Error('The SUPABASE_SECRET_KEY repository secret is not configured.');

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const storage = supabase.storage.from(bucket);
const folders = [''];
const images = [];

while (folders.length > 0) {
  const prefix = folders.shift();
  let offset = 0;
  while (true) {
    const { data, error } = await storage.list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`Could not list ${bucket}/${prefix}: ${error.message}`);
    const entries = data || [];
    for (const entry of entries) {
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!entry.id && !entry.metadata) {
        folders.push(objectPath);
        continue;
      }
      const contentType = String(entry.metadata?.mimetype || entry.metadata?.contentType || '');
      const looksLikeImage = contentType.startsWith('image/') || /\.(avif|gif|jpe?g|png|webp|tiff?)$/i.test(entry.name);
      const size = Number(entry.metadata?.size || entry.metadata?.contentLength || 0);
      if (looksLikeImage && size > minBytes) images.push({ path: objectPath, size, contentType });
    }
    offset += entries.length;
    if (entries.length < 1000) break;
  }
}

const selected = images.sort((a, b) => b.size - a.size).slice(0, maxFiles);
if (selected.length === 0) {
  throw new Error(`No image objects larger than ${minBytes} bytes were found in bucket "${bucket}".`);
}

console.log(`Bucket: ${bucket}; selected ${selected.length} of ${images.length} oversized image objects; dry run: ${dryRun}`);
for (const image of selected) {
  console.log(`Selected ${image.path}: ${image.size} bytes (${image.contentType || 'unknown type'})`);
}
if (dryRun) process.exit(0);

for (const image of selected) {
  const { data: file, error: downloadError } = await storage.download(image.path);
  if (downloadError || !file) throw new Error(`Could not download ${image.path}: ${downloadError?.message || 'empty response'}`);
  const original = Buffer.from(await file.arrayBuffer());
  const { data: optimized, info } = await sharp(original)
    .rotate()
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });

  if (optimized.length >= original.length) {
    console.log(`Skipped ${image.path}: WebP output was not smaller (${original.length} → ${optimized.length} bytes).`);
    continue;
  }

  const { error: uploadError } = await storage.upload(image.path, optimized, {
    upsert: true,
    contentType: 'image/webp',
    cacheControl: '3600',
  });
  if (uploadError) throw new Error(`Could not replace ${image.path}: ${uploadError.message}`);
  console.log(`Recompressed ${image.path} in place: ${original.length} → ${optimized.length} bytes; ${info.width}×${info.height} WebP q${quality}.`);
}
