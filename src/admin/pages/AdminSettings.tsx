import { useState } from 'react';
import {Settings as SettingsIcon, Info, CreditCard, BookOpen, Check, Copy} from 'lucide-react';
import SiteSettingsPanel from '../components/SiteSettingsPanel';
import SearchSynonymsPanel from '../components/SearchSynonymsPanel';
import PwaInstallPanel from '../../components/PwaInstallPanel';

export default function AdminSettings() {
  const [copied, setCopied] = useState('');

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const flutterwavePublicKey = import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY || '';
  const isPaymentConfigured = !!flutterwavePublicKey;

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-charcoal font-light">Settings</h1>
        <p className="text-sm text-charcoal-muted mt-1">Site configuration, payment setup, and admin guide</p>
      </div>

      <SiteSettingsPanel />
      <PwaInstallPanel currentApp="owner" />

      {/* ==================== SEARCH SYNONYMS ==================== */}
      <SearchSynonymsPanel />

      {/* ==================== PAYMENT CONFIGURATION ==================== */}
      <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
        <h3 className="text-sm font-medium text-charcoal mb-4 flex items-center gap-2">
          <CreditCard size={16} className="text-bronze" /> Flutterwave Payment Configuration
        </h3>

        <div className={`p-4 rounded-sm mb-4 ${isPaymentConfigured ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
          <div className="flex items-center gap-2">
            {isPaymentConfigured ? (
              <><Check size={16} className="text-green-600" /><span className="text-sm text-green-800 font-medium">Flutterwave public key is configured. Payments are active.</span></>
            ) : (
              <><Info size={16} className="text-amber-600" /><span className="text-sm text-amber-800 font-medium">Flutterwave is not configured yet. Follow the steps below to enable payments.</span></>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-charcoal mb-2">Step 1: Get your Flutterwave API keys</p>
            <p className="text-sm text-charcoal-muted leading-relaxed">
              Go to <a href="https://dashboard.flutterwave.com/dashboard/settings/apis" target="_blank" rel="noopener noreferrer" className="text-bronze underline">Flutterwave Dashboard &rarr; Settings &rarr; API Keys</a>.
              You need two keys: the <strong>Public Key</strong> (starts with <code className="text-xs bg-taupe-light px-1 rounded">FLWPUBK-...</code>) and the <strong>Secret Key</strong> (starts with <code className="text-xs bg-taupe-light px-1 rounded">FLWSECK-...</code>).
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-charcoal mb-2">Step 2: Add the Public Key to your project</p>
            <p className="text-sm text-charcoal-muted leading-relaxed mb-2">
              Open the <code className="text-xs bg-taupe-light px-1 rounded">.env</code> file in your project root and add this line (replace with your actual key):
            </p>
            <div className="bg-charcoal text-white text-sm font-mono px-4 py-3 rounded-sm flex items-center justify-between">
              <span>VITE_FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-your-key-here</span>
              <button onClick={() => copyToClipboard('VITE_FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-your-key-here', 'pubkey')} className="text-white/60 hover:text-white">
                {copied === 'pubkey' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-charcoal mb-2">Step 3: Add the Secret Key as an Edge Function secret</p>
            <p className="text-sm text-charcoal-muted leading-relaxed mb-2">
              The secret key is used server-side only to verify payments. Set it using the Supabase dashboard:
              Go to <strong>Project Settings &rarr; Edge Functions &rarr; Secrets</strong> and add:
            </p>
            <div className="bg-charcoal text-white text-sm font-mono px-4 py-3 rounded-sm flex items-center justify-between">
              <span>FLW_SECRET_KEY = FLWSECK_TEST-your-secret-key-here</span>
              <button onClick={() => copyToClipboard('FLW_SECRET_KEY', 'seckey')} className="text-white/60 hover:text-white">
                {copied === 'seckey' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-charcoal mb-2">Step 4 (Optional): Email delivery with Resend</p>
            <p className="text-sm text-charcoal-muted leading-relaxed mb-2">
              To automatically email download links to customers after purchase, create a free account at
              <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-bronze underline"> resend.com</a>,
              get your API key, and add it as another Edge Function secret:
            </p>
            <div className="bg-charcoal text-white text-sm font-mono px-4 py-3 rounded-sm flex items-center justify-between">
              <span>RESEND_API_KEY = re_your-resend-api-key</span>
              <button onClick={() => copyToClipboard('RESEND_API_KEY', 'resend')} className="text-white/60 hover:text-white">
                {copied === 'resend' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <p className="text-xs text-charcoal-muted mt-2">If Resend is not configured, download links still appear on-screen after payment — they just won't be emailed.</p>
          </div>

          <div>
            <p className="text-xs font-medium text-charcoal mb-2">Step 5: Verify your domain in Flutterwave</p>
            <p className="text-sm text-charcoal-muted leading-relaxed">
              In the Flutterwave dashboard, go to <strong>Settings &rarr; Webhooks</strong> and add your live domain.
              Also verify your website domain under <strong>Settings &rarr; Domains</strong> so the payment modal works on your live site.
            </p>
          </div>
        </div>
      </div>

      {/* ==================== ADMIN GUIDE ==================== */}
      <div className="bg-white border border-taupe/30 rounded-sm p-6 mb-6">
        <h3 className="text-sm font-medium text-charcoal mb-4 flex items-center gap-2">
          <BookOpen size={16} className="text-bronze" /> Admin Panel Guide
        </h3>

        <div className="space-y-5 text-sm">
          <div>
            <p className="font-medium text-charcoal mb-1">Dashboard</p>
            <p className="text-charcoal-muted leading-relaxed">Overview of your articles, categories, and pending comments. Quick stats at a glance.</p>
          </div>

          <div>
            <p className="font-medium text-charcoal mb-1">Articles</p>
            <p className="text-charcoal-muted leading-relaxed">Create, edit, and manage all editorial content. Set status to Draft, Published, or Scheduled. Assign categories and authors. Each article can have linked products via the "Shop This Article" feature.</p>
          </div>

          <div>
            <p className="font-medium text-charcoal mb-1">Categories</p>
            <p className="text-charcoal-muted leading-relaxed">Manage the main editorial categories (Skincare, Style, Wellness). Set sort order, banner images, and SEO metadata.</p>
          </div>

          <div>
            <p className="font-medium text-charcoal mb-1">Authors</p>
            <p className="text-charcoal-muted leading-relaxed">Add and manage authors. Each author has a name, bio, avatar, role, and optional social links.</p>
          </div>

          <div>
            <p className="font-medium text-charcoal mb-1">Products — Digital vs Affiliate</p>
            <p className="text-charcoal-muted leading-relaxed">When adding a product, choose the type first:</p>
            <ul className="list-disc list-inside text-charcoal-muted mt-2 space-y-1 ml-2">
              <li><strong>Affiliate</strong>: Link to an external store (e.g. Amazon). Write natural editorial descriptions. The product page shows a "Shop Now" button that opens the external link.</li>
              <li><strong>Digital</strong>: Upload a file (PDF, ZIP, etc.) that customers purchase through checkout. After payment via Flutterwave, the file is delivered via on-screen download and email. No "Shop Now" button — just Add to Cart and Checkout.</li>
              <li><strong>Sponsored</strong>: Mark a product as sponsored with sponsor name and disclosure text.</li>
            </ul>
          </div>

          <div>
            <p className="font-medium text-charcoal mb-1">Orders & Customers</p>
            <p className="text-charcoal-muted leading-relaxed">View all orders with payment status. Customers are auto-created from checkout. Orders show payment reference, status (pending/paid/failed), and items purchased.</p>
          </div>

          <div>
            <p className="font-medium text-charcoal mb-1">Collections</p>
            <p className="text-charcoal-muted leading-relaxed">Curated groups of articles. Create a collection, add articles to it, and it appears on the Collections page accessible from the header.</p>
          </div>

          <div>
            <p className="font-medium text-charcoal mb-1">Comments & Messages</p>
            <p className="text-charcoal-muted leading-relaxed">Approve, reply to, or delete reader comments on articles. The Messages page shows all contact form submissions — read, reply via email, or delete.</p>
          </div>

          <div>
            <p className="font-medium text-charcoal mb-1">Media</p>
            <p className="text-charcoal-muted leading-relaxed">Upload and manage images for articles and products. Images are stored in Supabase storage and referenced by URL.</p>
          </div>

          <div>
            <p className="font-medium text-charcoal mb-1">Featured & Editors Picks</p>
            <p className="text-charcoal-muted leading-relaxed">Control which articles appear in the hero section and editors picks on the homepage.</p>
          </div>

          <div>
            <p className="font-medium text-charcoal mb-1">Newsletter & Analytics</p>
            <p className="text-charcoal-muted leading-relaxed">View newsletter subscribers and site analytics (article views, likes, product clicks, top articles).</p>
          </div>
        </div>
      </div>

      {/* ==================== GENERAL ==================== */}
      <div className="bg-white border border-taupe/30 rounded-sm p-6">
        <h3 className="text-sm font-medium text-charcoal mb-4 flex items-center gap-2">
          <SettingsIcon size={16} /> General
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-charcoal-muted mb-1">Site Name</label>
            <input type="text" value="Lixxon Studio" readOnly className="w-full bg-taupe-light/30 border border-taupe/30 px-3 py-2.5 rounded text-sm" />
          </div>
          <div>
            <label className="block text-xs text-charcoal-muted mb-1">Site Description</label>
            <textarea value="A daily digital magazine covering skincare science, intentional style, and minimalist wellness." readOnly rows={2} className="w-full bg-taupe-light/30 border border-taupe/30 px-3 py-2.5 rounded text-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}
