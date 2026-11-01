import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { Upload, Image as ImageIcon, X, Link2, Check, Loader2, Trash2, FolderOpen } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { optimizeAdminImage } from '../../lib/imageUpload';
import { MediaPicker } from './AdminEditorKit';

export interface AdminImageUploadFieldProps {
  label: string;
  value: string;
  onChange: (url: string) => void;
  altText?: string;
  onAltChange?: (alt: string) => void;
  folder?: 'series' | 'collections' | 'categories' | 'authors' | 'articles' | 'products' | 'general' | 'branding';
  hint?: string;
  className?: string;
  required?: boolean;
}

export default function AdminImageUploadField({
  label,
  value,
  onChange,
  altText,
  onAltChange,
  folder = 'general',
  hint,
  className = '',
  required = false,
}: AdminImageUploadFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [mediaItems, setMediaItems] = useState<{ id: string; url: string; alt_text?: string | null; title?: string | null; file_name?: string | null }[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing media items when picker is opened
  const openMediaLibrary = async () => {
    setShowMediaPicker(true);
    setLoadingMedia(true);
    try {
      const { data } = await supabase.from('media').select('id, url, alt_text, title, file_name').order('created_at', { ascending: false }).limit(60);
      if (Array.isArray(data)) {
        setMediaItems(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMedia(false);
    }
  };

  const handleFileProcess = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (JPEG, PNG, WebP, GIF, SVG, AVIF)');
      return;
    }
    setError(null);
    setUploading(true);

    try {
      // Optimize image in-browser to WebP if raster
      const { blob, width, height, contentType, extension } = await optimizeAdminImage(file, 1600, 0.82);
      const safeName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 30);
      const storagePath = `${folder}/${Date.now()}-${safeName}.${extension}`;

      let publicUrl = '';
      const { error: upErr } = await supabase.storage.from('media').upload(storagePath, blob, {
        contentType,
        cacheControl: '31536000',
        upsert: true,
      });

      if (!upErr) {
        const { data: urlData } = supabase.storage.from('media').getPublicUrl(storagePath);
        publicUrl = urlData.publicUrl;
      } else {
        // Fallback: create an object URL or data URL if storage bucket is not available
        publicUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }

      const cleanAlt = altText || file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');

      // Save to media table for future reuse in the library
      await supabase.from('media').insert({
        url: publicUrl,
        alt_text: cleanAlt,
        file_name: file.name,
        file_size: blob.size,
        mime_type: contentType,
        width: width || null,
        height: height || null,
        title: cleanAlt,
      }).then(() => undefined, () => undefined);

      onChange(publicUrl);
      if (onAltChange && !altText) {
        onAltChange(cleanAlt);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please check network or try entering a direct URL.');
    } finally {
      setUploading(false);
    }
  }, [folder, altText, onChange, onAltChange]);

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileProcess(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileProcess(file);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <label className="block text-[11px] font-medium tracking-editorial uppercase text-charcoal-muted">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openMediaLibrary}
            className="inline-flex items-center gap-1 text-[11px] text-bronze hover:underline"
            title="Choose from previously uploaded media"
          >
            <FolderOpen size={12} /> Choose from Library
          </button>
          <span className="text-gray-300">·</span>
          <button
            type="button"
            onClick={() => setShowUrlInput(!showUrlInput)}
            className="inline-flex items-center gap-1 text-[11px] text-charcoal-muted hover:text-charcoal"
          >
            <Link2 size={12} /> {showUrlInput ? 'Hide URL' : 'Paste URL'}
          </button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onFileInputChange}
        className="hidden"
      />

      {/* Error banner */}
      {error && (
        <div className="p-2.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X size={12} /></button>
        </div>
      )}

      {/* When an image is selected/set */}
      {value ? (
        <div className="relative group rounded-md border border-taupe/40 bg-taupe-light/30 p-2 flex items-center gap-4 overflow-hidden">
          <div className="w-20 h-20 flex-shrink-0 bg-white rounded border border-taupe/30 overflow-hidden relative">
            <img
              src={value}
              alt={altText || label}
              className="w-full h-full object-cover"
              onError={(e) => {
                // If broken image, fallback visual
                (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100%" height="100%" fill="%23eee"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="10" fill="%23aaa">Invalid image</text></svg>';
              }}
            />
          </div>
          <div className="flex-1 min-w-0 pr-8">
            <p className="text-xs font-mono text-charcoal truncate" title={value}>{value}</p>
            <p className="text-[11px] text-charcoal-muted mt-0.5">Image active · Click Replace to upload a new one</p>
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white border border-taupe rounded hover:border-bronze text-charcoal transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 size={12} className="animate-spin text-bronze" /> : <Upload size={12} className="text-bronze" />}
                Replace
              </button>
              <button
                type="button"
                onClick={openMediaLibrary}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white border border-taupe rounded hover:border-bronze text-charcoal transition-colors"
              >
                <FolderOpen size={12} />
                Library
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { onChange(''); if (onAltChange) onAltChange(''); }}
            className="absolute top-2 right-2 p-1.5 text-charcoal-muted hover:text-red-600 bg-white/80 hover:bg-white rounded-full transition-colors shadow-sm"
            title="Remove image"
            aria-label="Remove image"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        /* Dropzone / Upload trigger */
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-md border-2 border-dashed p-6 text-center transition-all ${
            dragOver
              ? 'border-bronze bg-bronze/5'
              : 'border-taupe/50 hover:border-bronze hover:bg-taupe-light/20 bg-white'
          }`}
        >
          {uploading ? (
            <div className="py-2 flex flex-col items-center gap-2">
              <Loader2 size={24} className="animate-spin text-bronze" />
              <p className="text-xs text-charcoal font-medium">Optimizing &amp; uploading image…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-bronze/10 text-bronze flex items-center justify-center">
                <Upload size={18} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-xs font-medium text-charcoal">
                  Click to upload <span className="font-normal text-charcoal-muted">or drag and drop</span>
                </p>
                <p className="text-[10px] text-charcoal-muted mt-0.5">
                  WebP, JPG, PNG, GIF up to 10MB (automatically compressed)
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Optional URL input toggle */}
      {showUrlInput && (
        <div className="pt-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="https://images.pexels.com/... or https://..."
              className="flex-1 border border-taupe/60 px-3 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze bg-white"
            />
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="p-2 text-charcoal-muted hover:text-red-600"
                title="Clear URL"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Alt text field if onAltChange provided */}
      {onAltChange && (
        <div className="pt-1">
          <label className="block text-[10px] tracking-wide uppercase text-charcoal-muted mb-1">
            Alt Text (Accessibility &amp; SEO)
          </label>
          <input
            type="text"
            value={altText || ''}
            onChange={(e) => onAltChange(e.target.value)}
            placeholder="Descriptive explanation of the image..."
            className="w-full border border-taupe/60 px-3 py-1.5 text-xs rounded-sm focus:outline-none focus:border-bronze bg-white"
          />
        </div>
      )}

      {hint && <p className="text-[11px] text-charcoal-muted mt-1">{hint}</p>}

      {/* Media Picker modal */}
      <MediaPicker
        open={showMediaPicker}
        items={mediaItems}
        mode="cover"
        onPick={({ url, alt }) => {
          onChange(url);
          if (onAltChange && alt) onAltChange(alt);
          setShowMediaPicker(false);
        }}
        onClose={() => setShowMediaPicker(false)}
      />
    </div>
  );
}
