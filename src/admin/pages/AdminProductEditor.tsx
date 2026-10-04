import type { MediaItem } from '../../lib/types';
import { useState, useEffect } from 'react';
import { ArrowLeft, Save, Upload, FileText, ExternalLink } from 'lucide-react';
import { useNavigation } from '../../context/NavigationContext';
import { supabase } from '../../lib/supabaseClient';
import { useShopCategories } from '../../hooks/useCommerce';
import { optimizeAdminImage } from '../../lib/imageUpload';

interface FormData {
  name: string; brand: string; description: string; image_url: string;
  price: string; affiliate_url: string; category: string; slug: string;
  what_it_is: string; what_its_used_for: string; why_we_recommend: string; key_ingredients: string;
  is_digital: boolean; file_path: string; preview_file_path: string;
  currency: string; sku: string; product_type: string; is_featured: boolean; is_active: boolean;
  what_is_included: string; seo_title: string; seo_description: string; shop_category_id: string;
  is_sponsored: boolean; sponsor_name: string; disclosure_text: string;
}

export default function AdminProductEditor({ productId, isNew }: { productId?: string; isNew?: boolean }) {
  const { navigate } = useNavigation();
  const { categories } = useShopCategories();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState<FormData>({
    name: '', brand: '', description: '', image_url: '', price: '', affiliate_url: '#',
    category: '', slug: '', what_it_is: '', what_its_used_for: '', why_we_recommend: '', key_ingredients: '',
    is_digital: false, file_path: '', preview_file_path: '', currency: 'USD', sku: '', product_type: 'affiliate',
    is_featured: false, is_active: true, what_is_included: '', seo_title: '', seo_description: '', shop_category_id: '',
    is_sponsored: false, sponsor_name: '', disclosure_text: '',
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
    alert(`Upload failed: ${uploadError instanceof Error ? uploadError.message : 'Could not optimize this image.'}`);
  } finally {
    setUploadingImage(false);
    e.target.value = '';
  }
};
  
  useEffect(() => {
    if (!isNew && productId) {
      supabase.from('products').select('*').eq('id', productId).maybeSingle().then(({ data }) => {
        if (data) setForm(prev => ({ ...prev, ...data, shop_category_id: data.shop_category_id || '' }));
      });
    }
  }, [productId, isNew]);

  const update = (field: keyof FormData, value: string | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleProductTypeChange = (type: string) => {
    update('product_type', type);
    update('is_digital', type === 'digital');
  };

//   const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: 'file_path' | 'preview_file_path') => {
//   const file = e.target.files?.[0];
//   if (!file) return;
//   setUploading(true);

//   const ext = file.name.split('.').pop();
//   const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

//   // Previews go to the 'previews' bucket; paid products go to 'digital-products'
//   const isPreview = field === 'preview_file_path';
//   const targetBucket = isPreview ? 'previews' : 'digital-products';
//   const filePath = isPreview ? uniqueId : `products/${uniqueId}`;

//   const { error: upError } = await supabase.storage
//     .from(targetBucket)
//     .upload(filePath, file, { upsert: true });

//   if (upError) {
//     setError('Upload failed: ' + upError.message);
//   } else {
//     update(field, filePath);
//   }
//   setUploading(false);
// };
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: 'file_path' | 'preview_file_path') => {
  const file = e.target.files?.[0];
  if (!file) return;

  const isPreview = field === 'preview_file_path';
  const targetBucket = isPreview ? 'previews' : 'digital-products';

  // Temporary check: Pops up target bucket name on click
  alert(`Attempting upload to bucket: "${targetBucket}"`);

  setUploading(true);
  const ext = file.name.split('.').pop();
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const filePath = isPreview ? uniqueId : `products/${uniqueId}`;

  const { data, error: upError } = await supabase.storage
    .from(targetBucket)
    .upload(filePath, file, { upsert: true });

  if (upError) {
    console.error('Supabase upload error:', upError);
    setError('Upload failed: ' + upError.message);
    alert('Upload Error: ' + upError.message);
  } else {
    console.log('Upload successful:', data);
    update(field, filePath);
  }
  setUploading(false);
};

  const handleSave = async () => {
    setSaving(true); setError('');
    const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const payload = {
      ...form,
      slug,
      shop_category_id: form.shop_category_id || null,
      price: form.price || null,
      updated_at: new Date().toISOString(),
    };
    try {
      if (isNew) {
        const { error: e } = await supabase.from('products').insert(payload);
        if (e) throw e;
      } else {
        const { error: e } = await supabase.from('products').update(payload).eq('id', productId);
        if (e) throw e;
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

      {/* ==================== COMMON FIELDS ==================== */}
      <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
        <h3 className="text-sm font-medium text-charcoal mb-4 flex items-center gap-2">
          <FileText size={16} className="text-bronze" /> Basic Information
        </h3>
        <div className="grid lg:grid-cols-2 gap-4">
          <div><label className={labelClass}>Name</label><input className={inputClass} value={form.name} onChange={e => update('name', e.target.value)} /></div>
          <div><label className={labelClass}>Brand</label><input className={inputClass} value={form.brand} onChange={e => update('brand', e.target.value)} /></div>
          <div><label className={labelClass}>Slug (auto-generated if empty)</label><input className={inputClass} value={form.slug} onChange={e => update('slug', e.target.value)} /></div>
          <div>
            <label className={labelClass}>Shop Category</label>
            <select className={inputClass} value={form.shop_category_id} onChange={e => update('shop_category_id', e.target.value)}>
              <option value="">None</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="lg:col-span-2"><label className={labelClass}>Description (short summary shown on cards)</label><textarea className={inputClass} rows={3} value={form.description} onChange={e => update('description', e.target.value)} /></div>
          <div className="lg:col-span-2">
  <label className={labelClass}>Cover Image</label>
  <div className="flex gap-3 items-center">
    {form.image_url && (
      <img src={form.image_url} alt="Preview" className="w-12 h-12 object-cover rounded border" />
    )}
    <input
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
            <div><label className={labelClass}>Price</label><input className={inputClass} value={form.price} onChange={e => update('price', e.target.value)} placeholder="0.00" /></div>
            <div><label className={labelClass}>Currency</label><input className={inputClass} value={form.currency} onChange={e => update('currency', e.target.value)} /></div>
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
              <label className={labelClass}>What's Included (shown on product page)</label>
              <textarea className={inputClass} rows={3} value={form.what_is_included} onChange={e => update('what_is_included', e.target.value)} placeholder="e.g., 1x PDF Guide (45 pages), 1x Bonus Checklist..." />
            </div>

            <div>
              <label className={labelClass}>About This Guide (what_it_is field)</label>
              <textarea className={inputClass} rows={3} value={form.what_it_is} onChange={e => update('what_it_is', e.target.value)} placeholder="What this guide is about..." />
            </div>

            <div>
              <label className={labelClass}>What You'll Learn (what_its_used_for field)</label>
              <textarea className={inputClass} rows={3} value={form.what_its_used_for} onChange={e => update('what_its_used_for', e.target.value)} placeholder="Key takeaways and lessons..." />
            </div>

            <div>
              <label className={labelClass}>Why You'll Love It (why_we_recommend field)</label>
              <textarea className={inputClass} rows={3} value={form.why_we_recommend} onChange={e => update('why_we_recommend', e.target.value)} placeholder="What makes this special..." />
            </div>

            {/* File upload */}
            <div className="pt-4 border-t border-taupe/30">
              <label className={labelClass}>Product File (the file customers download after purchase)</label>
              <div className="flex items-center gap-3">
                <input className={inputClass} value={form.file_path} onChange={e => update('file_path', e.target.value)} placeholder="products/my-guide.pdf" />
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
              <div><label className={labelClass}>SEO Title</label><input className={inputClass} value={form.seo_title} onChange={e => update('seo_title', e.target.value)} /></div>
            </div>
            <div><label className={labelClass}>SEO Description</label><textarea className={inputClass} rows={2} value={form.seo_description} onChange={e => update('seo_description', e.target.value)} /></div>
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
              <label className={labelClass}>Overview (shown as "Overview" section)</label>
              <textarea className={inputClass} rows={3} value={form.what_it_is} onChange={e => update('what_it_is', e.target.value)} placeholder="A natural description of the product. Write this like a magazine editor would — what it is, who it's for, in your own voice." />
            </div>

            <div>
              <label className={labelClass}>How It Fits Into Your Routine (shown as its own section)</label>
              <textarea className={inputClass} rows={3} value={form.what_its_used_for} onChange={e => update('what_its_used_for', e.target.value)} placeholder="When and how to use it. Make it practical and specific to the product." />
            </div>

            <div>
              <label className={labelClass}>What Makes It Work (shown as its own section)</label>
              <textarea className={inputClass} rows={3} value={form.key_ingredients} onChange={e => update('key_ingredients', e.target.value)} placeholder="The ingredients, materials, or technology behind it. Only fill this in if it's relevant to the product." />
            </div>

            <div>
              <label className={labelClass}>Our Take (shown as its own section — your recommendation)</label>
              <textarea className={inputClass} rows={3} value={form.why_we_recommend} onChange={e => update('why_we_recommend', e.target.value)} placeholder="Why you recommend it personally. Be honest and specific — what stood out to you." />
            </div>

            <div><label className={labelClass}>Category (for homepage grouping)</label><input className={inputClass} value={form.category} onChange={e => update('category', e.target.value)} placeholder="skincare, wellness, style" /></div>
            <div><label className={labelClass}>SEO Title</label><input className={inputClass} value={form.seo_title} onChange={e => update('seo_title', e.target.value)} /></div>
            <div><label className={labelClass}>SEO Description</label><textarea className={inputClass} rows={2} value={form.seo_description} onChange={e => update('seo_description', e.target.value)} /></div>
          </div>
        </div>
      )}

      {/* ==================== SPONSORED FIELDS ==================== */}
      {form.is_sponsored && (
        <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
          <h3 className="text-sm font-medium text-charcoal mb-4">Sponsored Details</h3>
          <div className="space-y-4">
            <div><label className={labelClass}>Sponsor Name</label><input className={inputClass} value={form.sponsor_name} onChange={e => update('sponsor_name', e.target.value)} /></div>
            <div><label className={labelClass}>Disclosure Text</label><input className={inputClass} value={form.disclosure_text} onChange={e => update('disclosure_text', e.target.value)} /></div>
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
            <div><label className={labelClass}>What It Is</label><textarea className={inputClass} rows={3} value={form.what_it_is} onChange={e => update('what_it_is', e.target.value)} /></div>
            <div><label className={labelClass}>What It's Used For</label><textarea className={inputClass} rows={3} value={form.what_its_used_for} onChange={e => update('what_its_used_for', e.target.value)} /></div>
            <div><label className={labelClass}>Why We Recommend It</label><textarea className={inputClass} rows={3} value={form.why_we_recommend} onChange={e => update('why_we_recommend', e.target.value)} /></div>
          </div>
        </div>
      )}

      {/* ==================== SEO COMMON ==================== */}
      <div className="flex items-center gap-4 mt-8 pt-6 border-t border-taupe/30">
        <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-6 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-60">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Product'}
        </button>
        {saved && <span className="text-sm text-green-600">Saved!</span>}
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
