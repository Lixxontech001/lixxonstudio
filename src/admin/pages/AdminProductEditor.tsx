import type { MediaItem } from '../../lib/types';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ArrowLeft, Save, Upload, FileText, ExternalLink, Gauge, Sparkles } from 'lucide-react';
import { MarkdownField, QualityPanel, ScoreRing, SearchPreview, SocialCardPreview, type QualityReport } from '../components/AdminEditorKit';
import { useNavigation } from '../../context/NavigationContext';
import { supabase } from '../../lib/supabaseClient';
import { useShopCategories } from '../../hooks/useCommerce';
import { useAuth } from '../../context/AuthContext';
import { optimizeAdminImage } from '../../lib/imageUpload';

interface FormData {
  name: string; brand: string; description: string; image_url: string;
  price: string; affiliate_url: string; category: string; slug: string;
  what_it_is: string; what_its_used_for: string; why_we_recommend: string; key_ingredients: string;
  is_digital: boolean; file_path: string; preview_file_path: string;
  currency: string; sku: string; product_type: string; is_featured: boolean; is_active: boolean;
  what_is_included: string; compare_price: string; seo_title: string; seo_description: string; shop_category_id: string;
  is_sponsored: boolean; sponsor_name: string; disclosure_text: string;
  focus_keyword: string; og_title: string; og_description: string; og_image: string;
  robots: string; schema_type: string; editor_notes: string;
}

export default function AdminProductEditor({ productId, isNew }: { productId?: string; isNew?: boolean }) {
  const { navigate } = useNavigation();
  const { can } = useAuth();
  const { categories } = useShopCategories();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [scoring, setScoring] = useState(false);

  const [form, setForm] = useState<FormData>({
    name: '', brand: '', description: '', image_url: '', price: '', affiliate_url: '#',
    category: '', slug: '', what_it_is: '', what_its_used_for: '', why_we_recommend: '', key_ingredients: '',
    is_digital: false, file_path: '', preview_file_path: '', currency: 'USD', sku: '', product_type: 'affiliate',
    is_featured: false, is_active: true, what_is_included: '', compare_price: '', seo_title: '', seo_description: '', shop_category_id: '',
    is_sponsored: false, sponsor_name: '', disclosure_text: '',
    focus_keyword: '', og_title: '', og_description: '', og_image: '',
    robots: 'index,follow', schema_type: 'Product', editor_notes: '',
  });

  // Add these state variables near the top of AdminProductEditor
const [showMediaPicker, setShowMediaPicker] = useState(false);
const [mediaList, setMediaList] = useState<MediaItem[]>([]);
const [uploadingImage, setUploadingImage] = useState(false);

// Function to fetch media library items when picker opens
const openMediaPicker = async () => {
  setShowMediaPicker(true);
  const { data } = await supabase.from('media').select('*').order('created_at', { ascending: false });
  if (data) setMediaList(data);
};

// Function for direct cover image upload
const handleCoverImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setUploadingImage(true);
  try {
    const { blob, width, height, contentType, extension } = await optimizeAdminImage(file, 1600, 0.78);
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const path = `media/${fileName}`;
    const { error: uploadError } = await supabase.storage.from('media').upload(path, blob, { contentType, cacheControl: '31536000' });
    if (uploadError) throw new Error(uploadError.message);

    const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
    const publicUrl = urlData.publicUrl;
    await supabase.from('media').insert({
      url: publicUrl,
      title: file.name,
      file_name: file.name,
      file_size: blob.size,
      mime_type: contentType,
      width: width || null,
      height: height || null,
    });
    update('image_url', publicUrl);
  } catch (uploadError) {
    setError(`Upload failed: ${uploadError instanceof Error ? uploadError.message : 'Could not optimize this image.'}`);
  } finally {
    setUploadingImage(false);
    e.target.value = '';
  }
};
  
  useEffect(() => {
    if (!isNew && productId) {
      supabase.from('products').select('*').eq('id', productId).maybeSingle().then(({ data }) => {
        if (data) setForm(prev => ({
          ...prev,
          ...data,
          price: data.price == null ? '' : String(data.price),
          compare_price: data.compare_price == null ? '' : String(data.compare_price),
          shop_category_id: data.shop_category_id || '',
          focus_keyword: data.focus_keyword || '',
          og_title: data.og_title || '',
          og_description: data.og_description || '',
          og_image: data.og_image || '',
          robots: data.robots || 'index,follow',
          schema_type: data.schema_type || 'Product',
          editor_notes: data.editor_notes || '',
        }));
      });
    }
  }, [productId, isNew]);

  const update = (field: keyof FormData, value: string | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  /** The score comes from admin_score_product() so the admin page, the shop and any
   *  automated review all judge a product by the same rules. */
  const patch = useMemo(() => ({
    ...form,
    price: form.price,
    price_cents: form.price.trim() && Number.isFinite(Number(form.price)) ? Math.round(Number(form.price) * 100) : null,
    compare_price: form.compare_price,
    tags: (form.category || '').split(',').map(t => t.trim()).filter(Boolean),
    shop_category_id: form.shop_category_id,
    is_sponsored: form.is_sponsored,
    product_type: form.product_type,
  }), [form]);

  const scoreRef = useRef(0);
  const runScore = useCallback(async () => {
    const mine = ++scoreRef.current;
    setScoring(true);
    const { data, error } = await supabase.rpc('admin_score_product', { p_patch: patch });
    if (mine !== scoreRef.current) return;
    setScoring(false);
    if (!error && data) setReport(data as QualityReport);
  }, [patch]);

  useEffect(() => {
    const t = setTimeout(runScore, 800);
    return () => clearTimeout(t);
  }, [runScore]);

  const applyFix = (issue: { key: string }) => {
    const targets: Record<string, string> = {
      name: 'product-name', name_length: 'product-name', description: 'product-description',
      description_short: 'product-description', image: 'product-image', gallery: 'product-image',
      price: 'product-price', compare_price: 'product-compare-price', seo_title: 'product-seo-title',
      seo_description: 'product-seo-desc', seo_description_length: 'product-seo-desc',
      slug: 'product-slug', tags: 'product-category', shop_category: 'product-shop-category',
      disclosure: 'product-disclosure', file: 'product-file',
    };
    document.getElementById(targets[issue.key] || 'product-name')?.focus();
    document.getElementById(targets[issue.key] || 'product-name')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleProductTypeChange = (type: string) => {
    update('product_type', type);
    update('is_digital', type === 'digital');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: 'file_path' | 'preview_file_path') => {
  const file = e.target.files?.[0];
  if (!file) return;

  const isPreview = field === 'preview_file_path';
  const targetBucket = isPreview ? 'previews' : 'digital-products';

  setUploading(true);
  const ext = file.name.split('.').pop();
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const filePath = isPreview ? uniqueId : `products/${uniqueId}`;

  const { data, error: upError } = await supabase.storage
    .from(targetBucket)
    .upload(filePath, file, { upsert: true });

  if (upError) {
    setError('Upload failed: ' + upError.message);
  } else {
    update(field, filePath);
    void data;
  }
  setUploading(false);
};

  const handleSave = async () => {
    if (!can('commerce.pricing')) return;
    setSaving(true); setError('');
    const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const payload = {
      ...form,
      slug,
      shop_category_id: form.shop_category_id || null,
      price: form.price || null,
      compare_price: form.compare_price || null,
      updated_at: new Date().toISOString(),
    };
    try {
      let savedId = productId;
      if (isNew) {
        const { data, error: e } = await supabase.from('products').insert(payload).select('id').single();
        if (e) throw e;
        savedId = data?.id;
      } else {
        const { error: e } = await supabase.from('products').update(payload).eq('id', productId);
        if (e) throw e;
      }
      // Persist the same quality score the editor preview uses. A scoring failure must
      // not roll back a successful product save, but it is visible to the editor.
      if (savedId) {
        const { data: quality, error: qualityError } = await supabase.rpc('admin_product_quality', { p_product_id: savedId });
        if (!qualityError && quality) setReport(quality as QualityReport);
        else if (qualityError) setError(`Saved, but quality score could not be refreshed: ${qualityError.message}`);
      }
      setSaved(true);
      setTimeout(() => navigate({ name: 'admin-products' }), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
    setSaving(false);
  };

  const inputClass = "w-full bg-white border border-taupe/50 px-3 py-2.5 text-sm text-charcoal rounded-sm focus:outline-none focus:border-bronze transition-colors";
  const labelClass = "block text-[10px] tracking-editorial uppercase text-charcoal-muted mb-1.5";
  const isDigital = form.product_type === 'digital';
  const isAffiliate = form.product_type === 'affiliate';

  return (
    <div>
      <button onClick={() => navigate({ name: 'admin-products' })} className="inline-flex items-center gap-2 text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors mb-6">
        <ArrowLeft size={14} /> Back to Products
      </button>

      <h1 className="font-serif text-3xl text-charcoal font-light mb-2">{isNew ? 'New Product' : 'Edit Product'}</h1>

      {/* Product type selector — prominent */}
      <div className="mb-8">
        <label className={labelClass}>Product Type — Choose the flow</label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { value: 'affiliate', label: 'Affiliate / Recommended', desc: 'Link to external store' },
            { value: 'digital', label: 'Digital Product', desc: 'Sell & deliver via download' },
            { value: 'physical', label: 'Physical Product', desc: 'Tangible product' },
            { value: 'sponsored', label: 'Sponsored', desc: 'Paid placement' },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleProductTypeChange(opt.value)}
              className={`text-left p-4 border rounded-sm transition-all ${form.product_type === opt.value ? 'border-bronze bg-bronze/5' : 'border-taupe/40 hover:border-taupe'}`}
            >
              <p className="text-sm font-medium text-charcoal">{opt.label}</p>
              <p className="text-xs text-charcoal-muted mt-1">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-sm mb-6">{error}</div>}

      {/* Quality — computed in Postgres by admin_score_product() */}
      <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Gauge size={16} className="text-bronze" />
          <h3 className="text-sm font-medium text-charcoal">Listing quality</h3>
          {report && <ScoreRing score={report.score} grade={report.grade} size={40} />}
          <span className="text-xs text-charcoal-muted ml-auto">{scoring ? 'Checking…' : 'Scored by the database, the same rules the shop uses'}</span>
        </div>
        <QualityPanel report={report} loading={scoring} onFix={applyFix} onRefresh={runScore} />
      </div>

      {/* ==================== COMMON FIELDS ==================== */}
      <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
        <h3 className="text-sm font-medium text-charcoal mb-4 flex items-center gap-2">
          <FileText size={16} className="text-bronze" /> Basic Information
        </h3>
        <div className="grid lg:grid-cols-2 gap-4">
          <div><label className={labelClass}>Name</label><input id="product-name" className={inputClass} value={form.name} onChange={e => update('name', e.target.value)} /></div>
          <div><label className={labelClass}>Brand</label><input className={inputClass} value={form.brand} onChange={e => update('brand', e.target.value)} /></div>
          <div><label className={labelClass}>Slug (auto-generated if empty)</label><input id="product-slug" className={inputClass} value={form.slug} onChange={e => update('slug', e.target.value)} /></div>
          <div>
            <label className={labelClass}>Shop Category</label>
            <select id="product-shop-category" className={inputClass} value={form.shop_category_id} onChange={e => update('shop_category_id', e.target.value)}>
              <option value="">None</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="lg:col-span-2">
            <MarkdownField
              id="product-description"
              label="Description (shown on cards, product page and feeds)"
              value={form.description}
              onChange={v => update('description', v)}
              rows={5}
              min={300}
              max={2000}
              hint="What it is, who it suits, why we recommend it. Markdown is supported."
            />
          </div>
          <div className="lg:col-span-2">
  <label className={labelClass}>Cover Image</label>
  <div className="flex gap-3 items-center">
    {form.image_url && (
      <img src={form.image_url} alt="Preview" className="w-12 h-12 object-cover rounded border" />
    )}
    <input
      id="product-image"
      className={inputClass}
      value={form.image_url}
      onChange={e => update('image_url', e.target.value)}
      placeholder="https://... or choose/upload below"
    />
    <label className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm cursor-pointer hover:bg-bronze transition-colors whitespace-nowrap">
      <Upload size={14} /> {uploadingImage ? 'Uploading...' : 'Upload Direct'}
      <input type="file" accept="image/*" className="hidden" onChange={handleCoverImageUpload} />
    </label>
    <button
      type="button"
      onClick={openMediaPicker}
      className="inline-flex items-center gap-1.5 px-3 py-2.5 border border-charcoal text-charcoal text-xs tracking-editorial uppercase rounded-sm hover:bg-charcoal hover:text-white transition-colors whitespace-nowrap"
    >
      Choose from Library
    </button>
  </div>
</div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelClass}>Price</label><input id="product-price" className={inputClass} value={form.price} onChange={e => update('price', e.target.value)} placeholder="0.00" inputMode="decimal" /></div>
            <div><label className={labelClass}>Compare-at price <span className="normal-case">(optional)</span></label><input id="product-compare-price" className={inputClass} value={form.compare_price} onChange={e => update('compare_price', e.target.value)} placeholder="0.00" inputMode="decimal" /></div>
          </div>
        </div>
        <div className="space-y-3 pt-4 border-t border-taupe/30 mt-4">
          <label className="flex items-center gap-3 text-sm text-charcoal"><input type="checkbox" checked={form.is_featured} onChange={e => update('is_featured', e.target.checked)} className="accent-bronze" /> Featured</label>
          <label className="flex items-center gap-3 text-sm text-charcoal"><input type="checkbox" checked={form.is_active} onChange={e => update('is_active', e.target.checked)} className="accent-bronze" /> Active (visible in shop)</label>
        </div>
      </div>

      {/* ==================== DIGITAL PRODUCT FLOW ==================== */}
      {isDigital && (
        <div className="bg-white border border-bronze/30 rounded-sm p-6 mb-6">
          <h3 className="text-sm font-medium text-charcoal mb-1 flex items-center gap-2">
            <FileText size={16} className="text-bronze" /> Digital Product Details
          </h3>
          <p className="text-xs text-charcoal-muted mb-4">This product will be sold through checkout with Flutterwave payment. After payment, the file is delivered to the customer via email and on-screen download.</p>

          <div className="space-y-4">
            <div>
              <MarkdownField label="What's included (shown on the product page)" value={form.what_is_included}
                onChange={v => update('what_is_included', v)} rows={3}
                placeholder="e.g. 1x PDF Guide (45 pages), 1x bonus checklist…" />
            </div>

            <div>
              <MarkdownField label="About this guide" value={form.what_it_is}
                onChange={v => update('what_it_is', v)} rows={3} placeholder="What this guide is about…" />
            </div>

            <div>
              <MarkdownField label="What you'll learn" value={form.what_its_used_for}
                onChange={v => update('what_its_used_for', v)} rows={3} placeholder="Key takeaways and lessons…" />
            </div>

            <div>
              <MarkdownField label="Why you'll love it" value={form.why_we_recommend}
                onChange={v => update('why_we_recommend', v)} rows={3} placeholder="What makes this special…" />
            </div>

            {/* File upload */}
            <div className="pt-4 border-t border-taupe/30">
              <label className={labelClass}>Product File (the file customers download after purchase)</label>
              <div className="flex items-center gap-3">
                <input id="product-file" className={inputClass} value={form.file_path} onChange={e => update('file_path', e.target.value)} placeholder="products/my-guide.pdf" />
                <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-charcoal text-white text-xs tracking-editorial uppercase rounded-sm cursor-pointer hover:bg-bronze transition-colors whitespace-nowrap">
                  <Upload size={14} /> {uploading ? 'Uploading...' : 'Upload'}
                  <input type="file" className="hidden" onChange={e => handleFileUpload(e, 'file_path')} accept=".pdf,.epub,.zip,.doc,.docx,.mp3,.mp4" />
                </label>
              </div>
              {form.file_path && <p className="text-xs text-green-600 mt-2">File ready: {form.file_path}</p>}
            </div>

            <div>
              <label className={labelClass}>Preview File Path (optional — free preview before purchase)</label>
              <div className="flex items-center gap-3">
                <input className={inputClass} value={form.preview_file_path} onChange={e => update('preview_file_path', e.target.value)} placeholder="previews/preview.pdf" />
                <label className="inline-flex items-center gap-2 px-4 py-2.5 border border-charcoal text-charcoal text-xs tracking-editorial uppercase rounded-sm cursor-pointer hover:bg-charcoal hover:text-white transition-colors whitespace-nowrap">
                  <Upload size={14} /> Upload
                  <input type="file" className="hidden" onChange={e => handleFileUpload(e, 'preview_file_path')} accept=".pdf,.epub,.zip,.doc,.docx" />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelClass}>SKU / Reference</label><input className={inputClass} value={form.sku} onChange={e => update('sku', e.target.value)} /></div>
              <div><label className={labelClass}>SEO Title</label><input id="product-seo-title" className={inputClass} value={form.seo_title} onChange={e => update('seo_title', e.target.value)} /></div>
            </div>
            <div><label className={labelClass}>SEO Description</label><textarea id="product-seo-desc" className={inputClass} rows={2} value={form.seo_description} onChange={e => update('seo_description', e.target.value)} /></div>
          </div>
        </div>
      )}

      {/* ==================== AFFILIATE PRODUCT FLOW ==================== */}
      {isAffiliate && (
        <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
          <h3 className="text-sm font-medium text-charcoal mb-1 flex items-center gap-2">
            <ExternalLink size={16} className="text-bronze" /> Affiliate Product Details
          </h3>
          <p className="text-xs text-charcoal-muted mb-4">These products link to an external store. Write natural, editorial-style descriptions — not a template. Each section heading can be customized.</p>

          <div className="space-y-4">
            <div>
              <label className={labelClass}>Affiliate / Destination URL (where the "Shop Now" button goes)</label>
              <input className={inputClass} value={form.affiliate_url} onChange={e => update('affiliate_url', e.target.value)} placeholder="https://amazon.com/product..." />
            </div>

            <div>
              <MarkdownField label="Overview (its own section on the product page)" value={form.what_it_is}
                onChange={v => update('what_it_is', v)} rows={3}
                placeholder="Write this like a magazine editor would — what it is, who it's for, in your own voice." />
            </div>

            <div>
              <MarkdownField label="How it fits into your routine" value={form.what_its_used_for}
                onChange={v => update('what_its_used_for', v)} rows={3}
                placeholder="When and how to use it. Practical and specific beats flowery." />
            </div>

            <div>
              <MarkdownField label="What makes it work" value={form.key_ingredients}
                onChange={v => update('key_ingredients', v)} rows={3}
                placeholder="Ingredients, materials or technology — if it is relevant to this product." />
            </div>

            <div>
              <MarkdownField label="Our take (your recommendation)" value={form.why_we_recommend}
                onChange={v => update('why_we_recommend', v)} rows={3}
                placeholder="Be honest and specific — what stood out to you." />
            </div>

            <div><label className={labelClass}>Tags / category (for homepage grouping and search)</label><input id="product-category" className={inputClass} value={form.category} onChange={e => update('category', e.target.value)} placeholder="skincare, wellness, style" /></div>
            <div><label className={labelClass}>SEO Title</label><input id="product-seo-title" className={inputClass} value={form.seo_title} onChange={e => update('seo_title', e.target.value)} /></div>
            <div><label className={labelClass}>SEO Description</label><textarea id="product-seo-desc" className={inputClass} rows={2} value={form.seo_description} onChange={e => update('seo_description', e.target.value)} /></div>
          </div>
        </div>
      )}

      {/* ==================== SPONSORED FIELDS ==================== */}
      {form.is_sponsored && (
        <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
          <h3 className="text-sm font-medium text-charcoal mb-4">Sponsored Details</h3>
          <div className="space-y-4">
            <div><label className={labelClass}>Sponsor Name</label><input className={inputClass} value={form.sponsor_name} onChange={e => update('sponsor_name', e.target.value)} /></div>
            <div><label className={labelClass}>Disclosure Text</label><input id="product-disclosure" className={inputClass} value={form.disclosure_text} onChange={e => update('disclosure_text', e.target.value)} /></div>
            <label className="flex items-center gap-3 text-sm text-charcoal"><input type="checkbox" checked={form.is_sponsored} onChange={e => update('is_sponsored', e.target.checked)} className="accent-bronze" /> Mark as sponsored</label>
          </div>
        </div>
      )}

      {/* ==================== PHYSICAL PRODUCT FLOW ==================== */}
      {!isDigital && !isAffiliate && !form.is_sponsored && (
        <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
          <h3 className="text-sm font-medium text-charcoal mb-4">Product Details</h3>
          <div className="space-y-4">
            <div><label className={labelClass}>SKU / Reference</label><input className={inputClass} value={form.sku} onChange={e => update('sku', e.target.value)} /></div>
            <MarkdownField label="What it is" value={form.what_it_is} onChange={v => update('what_it_is', v)} rows={3} />
            <MarkdownField label="What it's used for" value={form.what_its_used_for} onChange={v => update('what_its_used_for', v)} rows={3} />
            <MarkdownField label="Why we recommend it" value={form.why_we_recommend} onChange={v => update('why_we_recommend', v)} rows={3} />
          </div>
        </div>
      )}

      {/* ==================== SEO / SOCIAL ==================== */}
      <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
        <h3 className="text-sm font-medium text-charcoal mb-4 flex items-center gap-2"><Sparkles size={15} className="text-bronze" /> Search &amp; social</h3>
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div><label className={labelClass}>Focus keyword</label><input className={inputClass} value={form.focus_keyword} onChange={e => update('focus_keyword', e.target.value)} placeholder="e.g. niacinamide serum" /></div>
            <div><label className={labelClass}>Social title (og:title)</label><input className={inputClass} value={form.og_title} onChange={e => update('og_title', e.target.value)} placeholder={form.name} /></div>
            <div><label className={labelClass}>Social description (og:description)</label><textarea className={inputClass} rows={2} value={form.og_description} onChange={e => update('og_description', e.target.value)} placeholder={form.seo_description || form.description} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Robots</label>
                <select className={inputClass} value={form.robots} onChange={e => update('robots', e.target.value)}>
                  <option value="index,follow">index, follow</option>
                  <option value="noindex,follow">noindex, follow</option>
                  <option value="index,nofollow">index, nofollow</option>
                  <option value="noindex,nofollow">noindex, nofollow</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Schema</label>
                <select className={inputClass} value={form.schema_type} onChange={e => update('schema_type', e.target.value)}>
                  {['Product', 'IndividualProduct', 'Review', 'Article'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div><label className={labelClass}>Internal note (never shown to shoppers)</label><textarea className={inputClass} rows={2} value={form.editor_notes} onChange={e => update('editor_notes', e.target.value)} placeholder="Supplier, restock date, why the price changed…" /></div>
          </div>
          <div className="space-y-4">
            <SearchPreview
              title={form.seo_title || form.name}
              description={form.seo_description || form.description}
              url={`https://lixxonstudio.com/product/${form.slug || 'product-slug'}`}
            />
            <SocialCardPreview
              title={form.og_title || form.seo_title || form.name}
              description={form.og_description || form.seo_description || form.description}
              image={form.og_image || form.image_url}
            />
            <div className="flex gap-2">
              <input className={inputClass} value={form.og_image} onChange={e => update('og_image', e.target.value)} placeholder="Social image URL (falls back to the cover)" />
            </div>
            <button type="button" onClick={() => { update('og_title', form.og_title || form.name); update('og_description', form.og_description || form.description.slice(0, 160)); update('seo_title', form.seo_title || form.name); update('seo_description', form.seo_description || form.description.slice(0, 155)); }} className="text-xs text-bronze hover:underline">Fill empty SEO fields from the listing</button>
          </div>
        </div>
      </div>

      {/* ==================== SAVE ==================== */}
      <div className="sticky bottom-0 flex items-center gap-4 mt-8 py-4 border-t border-taupe/30 bg-white backdrop-blur">
        <button onClick={handleSave} disabled={saving || !can('commerce.pricing')} className="inline-flex items-center gap-2 px-6 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-60">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Product'}
        </button>
        {report && <span className="inline-flex items-center gap-2 text-xs text-charcoal-muted"><ScoreRing score={report.score} grade={report.grade} size={34} /> quality {report.score}/100</span>}
        {saved && <span className="text-sm text-green-600">Saved!</span>}
        {!can('commerce.pricing') && <span className="text-xs text-charcoal-muted">Your role can view the store but not edit it.</span>}
        <button onClick={() => navigate({ name: 'admin-products' })} className="text-xs text-charcoal-muted hover:text-charcoal tracking-editorial uppercase ml-auto">Cancel</button>
      </div>
      
{showMediaPicker && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowMediaPicker(false)}>
    <div className="bg-white rounded-md max-w-3xl w-full max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
      <div className="p-4 border-b flex justify-between items-center">
        <h3 className="font-medium text-sm text-charcoal uppercase tracking-editorial">Select Image from Media Library</h3>
        <button onClick={() => setShowMediaPicker(false)} className="text-gray-400 hover:text-charcoal">✕</button>
      </div>
      <div className="p-4 overflow-y-auto grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
        {mediaList.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              update('image_url', item.url);
              setShowMediaPicker(false);
            }}
            className="group aspect-square rounded overflow-hidden border border-gray-200 hover:border-bronze focus:outline-none relative"
          >
            <img src={item.url} alt={item.alt_text || ''} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          </button>
        ))}
      </div>
    </div>
  </div>
)}
      
    </div>
  );
}
