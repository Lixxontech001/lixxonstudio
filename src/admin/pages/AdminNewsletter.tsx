import { useState, useMemo, useEffect } from 'react';
import { Mail, Search, Download, Send, Sparkles, Copy, Check, Users, ShieldCheck, UserX, Eye, Smartphone, Monitor } from 'lucide-react';
import { useAdminNewsletterSubscribers } from '../../hooks/useCommerce';
import { supabase } from '../../lib/supabaseClient';

interface PublishedArticle {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image: string | null;
  category?: { name: string } | null;
}

export default function AdminNewsletter() {
  const { subscribers, loading } = useAdminNewsletterSubscribers();
  const [activeTab, setActiveTab] = useState<'subscribers' | 'broadcast'>('subscribers');
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');

  // Broadcast Composer State
  const [broadcastSubject, setBroadcastSubject] = useState('The Sunday Reset: Intentional Living & Slow Skincare');
  const [broadcastPreheader, setBroadcastPreheader] = useState('Editor’s curated notes, scientific perspectives, and weekly reading list.');
  const [broadcastLetter, setBroadcastLetter] = useState(
    `Dear Readers,\n\nIn a world dominated by rapid consumption and relentless cycles of new launches, true luxury lies in restraint. This week, we examine the philosophy of minimal formulations and intentional skincare rituals.\n\nTake fifteen minutes for yourself, brew something warm, and enjoy this week’s selection.\n\nWarm regards,\nThe Editorial Team at Lixxon Studio`
  );
  const [selectedPostId, setSelectedPostId] = useState<string>('');
  const [publishedPosts, setPublishedPosts] = useState<PublishedArticle[]>([]);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testSent, setTestSent] = useState(false);

  // Fetch published articles for the composer
  useEffect(() => {
    supabase
      .from('posts')
      .select('id, title, slug, excerpt, cover_image, category:categories(name)')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const list = data as unknown as PublishedArticle[];
          setPublishedPosts(list);
          setSelectedPostId(list[0]?.id || '');
        }
      });
  }, []);

  const featuredStory = useMemo(() => {
    return publishedPosts.find(p => p.id === selectedPostId) || publishedPosts[0] || null;
  }, [publishedPosts, selectedPostId]);

  // Unique sources
  const availableSources = useMemo(() => {
    const set = new Set<string>();
    subscribers.forEach(s => {
      if (s.source) set.add(s.source);
    });
    return Array.from(set);
  }, [subscribers]);

  const filtered = useMemo(() => subscribers.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (sourceFilter !== 'all' && (s.source || 'direct') !== sourceFilter) return false;
    if (filter) return s.email?.toLowerCase().includes(filter.toLowerCase());
    return true;
  }), [subscribers, filter, statusFilter, sourceFilter]);

  // Executive KPI calculations
  const totalSubscribers = subscribers.length;
  const activeCount = subscribers.filter(s => s.status === 'active').length;
  const unsubCount = subscribers.filter(s => s.status === 'unsubscribed').length;
  const activeRate = totalSubscribers > 0 ? Math.round((activeCount / totalSubscribers) * 100) : 100;

  const exportCsv = () => {
    const csv = ['email,status,source,subscribed_date'];
    filtered.forEach(s => {
      csv.push(`"${s.email}","${s.status}","${s.source || 'direct'}","${new Date(s.created_at).toISOString()}"`);
    });
    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lixxon-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Generate production HTML for email clients
  const generateEmailHtml = () => {
    const siteUrl = window.location.origin;
    const storyUrl = featuredStory ? `${siteUrl}/article/${featuredStory.slug}?utm_source=newsletter&utm_medium=email` : siteUrl;
    const paragraphs = broadcastLetter.split('\n\n').map(p => `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #333333;">${p.replace(/\n/g, '<br/>')}</p>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${broadcastSubject}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background-color: #F8F6F0; font-family: -apple-system, BlinkMacSystemFont, 'Georgia', serif; color: #1F1F1F; }
    .wrapper { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border: 1px solid #E8E2D9; }
    .header { padding: 32px 24px; text-align: center; border-bottom: 1px solid #E8E2D9; background-color: #FDFBF7; }
    .logo { font-size: 22px; font-weight: 300; letter-spacing: 4px; text-transform: uppercase; color: #1F1F1F; text-decoration: none; }
    .body-content { padding: 36px 32px; }
    .story-card { margin-top: 32px; border: 1px solid #E8E2D9; border-radius: 4px; overflow: hidden; background-color: #FCFBF9; }
    .btn { display: inline-block; background-color: #9C6647; color: #FFFFFF; padding: 12px 24px; text-decoration: none; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; border-radius: 2px; font-weight: 600; margin-top: 16px; }
    .footer { padding: 28px; text-align: center; font-size: 12px; color: #8C827A; background-color: #1F1F1F; color: #E8E2D9; }
  </style>
</head>
<body>
  <div style="display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${broadcastPreheader}
  </div>
  <div class="wrapper">
    <div class="header">
      <a href="${siteUrl}" class="logo">Lixxon Studio</a>
      <p style="font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #9C6647; margin-top: 8px;">The Daily Reset · Editorial Dispatch</p>
    </div>
    <div class="body-content">
      <h1 style="font-size: 24px; font-weight: 400; color: #1F1F1F; margin: 0 0 20px 0; font-family: 'Georgia', serif;">${broadcastSubject}</h1>
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        ${paragraphs}
      </div>

      ${featuredStory ? `
      <div class="story-card">
        ${featuredStory.cover_image ? `<img src="${featuredStory.cover_image}" alt="${featuredStory.title}" style="width: 100%; height: auto; max-height: 240px; object-fit: cover; display: block;" />` : ''}
        <div style="padding: 24px;">
          <span style="font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #9C6647; font-weight: 600;">Featured Editorial</span>
          <h2 style="font-size: 18px; margin: 8px 0; color: #1F1F1F; font-family: 'Georgia', serif;">${featuredStory.title}</h2>
          <p style="font-size: 13px; color: #666666; line-height: 1.5; margin: 0 0 16px 0;">${featuredStory.excerpt || ''}</p>
          <a href="${storyUrl}" class="btn">Read Full Article →</a>
        </div>
      </div>
      ` : ''}
    </div>
    <div class="footer">
      <p style="margin: 0 0 8px 0;">Published with intention by Lixxon Studio · New York · Paris</p>
      <p style="margin: 0; font-size: 11px; opacity: 0.7;">You are receiving this because you subscribed to The Daily Reset. <a href="${siteUrl}/newsletter-preferences" style="color: #DDB892; text-decoration: underline;">Manage preferences</a> or <a href="${siteUrl}/newsletter-preferences" style="color: #DDB892; text-decoration: underline;">unsubscribe</a>.</p>
    </div>
  </div>
</body>
</html>`;
  };

  const handleCopyHtml = async () => {
    try {
      await navigator.clipboard.writeText(generateEmailHtml());
      setCopiedHtml(true);
      setTimeout(() => setCopiedHtml(false), 2500);
    } catch {
      // ignore
    }
  };

  const handleSendTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmail.trim()) return;
    setTestSent(true);
    setTimeout(() => {
      setTestSent(false);
      setTestEmail('');
    }, 4000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-3xl text-charcoal font-light">Newsletter & Dispatch</h1>
            <span className="text-[10px] tracking-editorial uppercase px-2 py-0.5 rounded-full bg-bronze/10 text-bronze font-medium">
              Editorial Studio
            </span>
          </div>
          <p className="text-sm text-charcoal-muted mt-1">
            Audience intelligence, subscriber retention, and publication dispatch studio
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex items-center bg-white border border-taupe/40 p-1 rounded-sm text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('subscribers')}
            className={`px-4 py-2 font-medium tracking-editorial uppercase rounded-sm transition-all flex items-center gap-2 ${
              activeTab === 'subscribers' ? 'bg-charcoal text-white shadow-xs' : 'text-charcoal-muted hover:text-charcoal'
            }`}
          >
            <Users size={14} /> Subscribers ({totalSubscribers})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('broadcast')}
            className={`px-4 py-2 font-medium tracking-editorial uppercase rounded-sm transition-all flex items-center gap-2 ${
              activeTab === 'broadcast' ? 'bg-bronze text-white shadow-xs' : 'text-charcoal-muted hover:text-charcoal'
            }`}
          >
            <Sparkles size={14} /> Dispatch Studio
          </button>
        </div>
      </div>

      {/* KPI Metric Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-taupe/40 p-4 rounded-sm shadow-xs">
          <p className="text-[10px] tracking-editorial uppercase text-charcoal-muted font-medium flex items-center gap-1.5">
            <Users size={12} className="text-bronze" /> Total Audience
          </p>
          <p className="font-serif text-2xl text-charcoal mt-1">{totalSubscribers.toLocaleString()}</p>
          <p className="text-[11px] text-charcoal-muted mt-0.5">Global readers subscribed</p>
        </div>

        <div className="bg-white border border-taupe/40 p-4 rounded-sm shadow-xs">
          <p className="text-[10px] tracking-editorial uppercase text-charcoal-muted font-medium flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-emerald-600" /> Active Deliverability
          </p>
          <p className="font-serif text-2xl text-emerald-700 mt-1">{activeCount.toLocaleString()}</p>
          <p className="text-[11px] text-emerald-600 font-medium mt-0.5">{activeRate}% healthy list health</p>
        </div>

        <div className="bg-white border border-taupe/40 p-4 rounded-sm shadow-xs">
          <p className="text-[10px] tracking-editorial uppercase text-charcoal-muted font-medium flex items-center gap-1.5">
            <UserX size={12} className="text-amber-600" /> Unsubscribed
          </p>
          <p className="font-serif text-2xl text-charcoal mt-1">{unsubCount.toLocaleString()}</p>
          <p className="text-[11px] text-charcoal-muted mt-0.5">{totalSubscribers > 0 ? ((unsubCount / totalSubscribers) * 100).toFixed(1) : 0}% churn rate</p>
        </div>

        <div className="bg-white border border-taupe/40 p-4 rounded-sm shadow-xs">
          <p className="text-[10px] tracking-editorial uppercase text-charcoal-muted font-medium flex items-center gap-1.5">
            <Mail size={12} className="text-bronze" /> Acquisition Channels
          </p>
          <p className="font-serif text-2xl text-bronze mt-1">{availableSources.length || 1}</p>
          <p className="text-[11px] text-charcoal-muted mt-0.5">Footers, modals, reader lounges</p>
        </div>
      </div>

      {activeTab === 'subscribers' ? (
        <>
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="flex flex-wrap gap-2 flex-1">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-muted" />
                <input
                  type="text"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="Search emails..."
                  className="w-full bg-white border border-taupe/50 pl-9 pr-4 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze"
                />
              </div>

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-white border border-taupe/50 px-3 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="unsubscribed">Unsubscribed</option>
              </select>

              {availableSources.length > 0 && (
                <select
                  value={sourceFilter}
                  onChange={e => setSourceFilter(e.target.value)}
                  className="bg-white border border-taupe/50 px-3 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze"
                >
                  <option value="all">All Sources</option>
                  {availableSources.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}
            </div>

            {subscribers.length > 0 && (
              <button
                type="button"
                onClick={exportCsv}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-taupe/50 text-charcoal text-xs tracking-editorial uppercase font-medium rounded-sm hover:border-bronze transition-all"
              >
                <Download size={13} /> Export Clean CSV
              </button>
            )}
          </div>

          {/* Table */}
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="skeleton h-14 rounded-sm" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-sm border border-taupe/30">
              <Mail size={32} strokeWidth={1.5} className="text-charcoal-muted mx-auto mb-4" />
              <p className="text-charcoal-muted text-sm">No subscribers matched your filters.</p>
            </div>
          ) : (
            <div className="bg-white rounded-sm border border-taupe/30 overflow-x-auto shadow-xs">
              <table className="w-full text-xs">
                <thead className="bg-taupe-light/40 border-b border-taupe/30">
                  <tr className="text-left text-[10px] tracking-editorial uppercase text-charcoal-muted">
                    <th className="px-4 py-3 font-medium">Subscriber Email</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Acquisition Source</th>
                    <th className="px-4 py-3 font-medium">Joined Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-taupe/20">
                  {filtered.map(s => (
                    <tr key={s.id} className="hover:bg-taupe-light/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-charcoal font-medium">{s.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium tracking-editorial uppercase ${
                          s.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-charcoal-muted capitalize">{s.source || 'Direct / Site'}</td>
                      <td className="px-4 py-3 text-charcoal-muted">
                        {new Date(s.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        /* Dispatch & Broadcast Studio */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Form Side */}
          <div className="lg:col-span-6 bg-white border border-taupe/40 rounded-sm p-6 space-y-5 shadow-xs">
            <div className="flex items-center justify-between border-b border-taupe/30 pb-3">
              <h2 className="font-serif text-lg text-charcoal font-medium flex items-center gap-2">
                <Sparkles size={16} className="text-bronze" /> Compose Dispatch
              </h2>
              <span className="text-[10px] tracking-editorial uppercase text-charcoal-muted font-mono">
                {activeCount} Active Recipients
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-medium tracking-editorial uppercase text-charcoal-muted mb-1.5">
                Email Subject Line
              </label>
              <input
                type="text"
                value={broadcastSubject}
                onChange={e => setBroadcastSubject(e.target.value)}
                placeholder="Subject line..."
                className="w-full bg-taupe-light/20 border border-taupe/50 p-2.5 text-xs text-charcoal rounded-sm focus:outline-none focus:border-bronze"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium tracking-editorial uppercase text-charcoal-muted mb-1.5">
                Preheader Preview Snippet
              </label>
              <input
                type="text"
                value={broadcastPreheader}
                onChange={e => setBroadcastPreheader(e.target.value)}
                placeholder="Inbox preheader text..."
                className="w-full bg-taupe-light/20 border border-taupe/50 p-2.5 text-xs text-charcoal rounded-sm focus:outline-none focus:border-bronze"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium tracking-editorial uppercase text-charcoal-muted mb-1.5">
                Feature Published Article (Hero Card)
              </label>
              <select
                value={selectedPostId}
                onChange={e => setSelectedPostId(e.target.value)}
                className="w-full bg-taupe-light/20 border border-taupe/50 p-2.5 text-xs text-charcoal rounded-sm focus:outline-none focus:border-bronze"
              >
                <option value="">-- No Article Attached --</option>
                {publishedPosts.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.category?.name || 'General'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium tracking-editorial uppercase text-charcoal-muted mb-1.5">
                Letter from the Editor
              </label>
              <textarea
                rows={8}
                value={broadcastLetter}
                onChange={e => setBroadcastLetter(e.target.value)}
                placeholder="Write your editorial thoughts here..."
                className="w-full bg-taupe-light/20 border border-taupe/50 p-2.5 text-xs text-charcoal rounded-sm focus:outline-none focus:border-bronze leading-relaxed font-sans"
              />
            </div>

            {/* Test Send Box */}
            <div className="pt-4 border-t border-taupe/30">
              <label className="block text-[11px] font-medium tracking-editorial uppercase text-charcoal-muted mb-2">
                Send Test Preview
              </label>
              <form onSubmit={handleSendTest} className="flex gap-2">
                <input
                  type="email"
                  value={testEmail}
                  onChange={e => setTestEmail(e.target.value)}
                  placeholder="editor@yourdomain.com"
                  className="flex-1 bg-taupe-light/20 border border-taupe/50 px-3 py-2 text-xs text-charcoal rounded-sm focus:outline-none focus:border-bronze"
                />
                <button
                  type="submit"
                  disabled={testSent || !testEmail.trim()}
                  className="px-4 py-2 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Send size={12} /> {testSent ? 'Sent Test!' : 'Send Test'}
                </button>
              </form>
              {testSent && (
                <p className="text-emerald-700 text-[11px] mt-1.5">
                  ✓ Preview payload generated for {testEmail}.
                </p>
              )}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleCopyHtml}
                className="w-full flex items-center justify-center gap-2 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-semibold rounded-sm hover:bg-bronze-dark transition-all shadow-sm"
              >
                {copiedHtml ? <Check size={14} /> : <Copy size={14} />}
                {copiedHtml ? 'Copied Full HTML Template!' : 'Copy Production HTML for Email Provider'}
              </button>
              <p className="text-center text-[10px] text-charcoal-muted mt-2">
                Paste directly into Resend, Mailchimp, Postmark, Substack, or Brevo.
              </p>
            </div>
          </div>

          {/* Luxury Preview Side */}
          <div className="lg:col-span-6 bg-[#1F1F1F] p-6 rounded-sm space-y-4">
            <div className="flex items-center justify-between text-white border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Eye size={15} className="text-bronze-light" />
                <span className="text-xs tracking-editorial uppercase font-medium">Live Email Render</span>
              </div>
              <div className="flex items-center gap-1 bg-white/10 p-1 rounded-sm text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewDevice('desktop')}
                  className={`p-1.5 rounded-xs transition-colors ${previewDevice === 'desktop' ? 'bg-bronze text-white' : 'text-white/60 hover:text-white'}`}
                  title="Desktop View"
                >
                  <Monitor size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewDevice('mobile')}
                  className={`p-1.5 rounded-xs transition-colors ${previewDevice === 'mobile' ? 'bg-bronze text-white' : 'text-white/60 hover:text-white'}`}
                  title="Mobile View"
                >
                  <Smartphone size={14} />
                </button>
              </div>
            </div>

            {/* Email Canvas */}
            <div className={`mx-auto bg-white rounded-xs shadow-2xl overflow-hidden transition-all duration-300 ${
              previewDevice === 'mobile' ? 'max-w-sm' : 'max-w-xl'
            }`}>
              {/* Header */}
              <div className="bg-[#FAF7F2] p-6 text-center border-b border-[#E8E2D9]">
                <span className="font-serif text-xl tracking-widest uppercase text-charcoal block">
                  Lixxon Studio
                </span>
                <span className="text-[9px] tracking-editorial uppercase text-bronze font-medium block mt-1">
                  The Daily Reset · Editorial Dispatch
                </span>
              </div>

              {/* Body */}
              <div className="p-6 md:p-8 space-y-5 bg-white">
                <h3 className="font-serif text-xl text-charcoal font-normal leading-snug">
                  {broadcastSubject}
                </h3>

                <div className="text-xs text-charcoal/80 leading-relaxed whitespace-pre-wrap font-sans">
                  {broadcastLetter}
                </div>

                {/* Featured Story Box */}
                {featuredStory && (
                  <div className="border border-taupe/40 rounded-xs overflow-hidden bg-[#FCFBF9] mt-6">
                    {featuredStory.cover_image && (
                      <div className="aspect-[16/9] w-full bg-taupe-light overflow-hidden">
                        <img
                          src={featuredStory.cover_image}
                          alt={featuredStory.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="p-4 space-y-2">
                      <span className="text-[9px] tracking-editorial uppercase text-bronze font-semibold block">
                        Featured Read
                      </span>
                      <h4 className="font-serif text-base text-charcoal font-normal">
                        {featuredStory.title}
                      </h4>
                      {featuredStory.excerpt && (
                        <p className="text-[11px] text-charcoal-muted line-clamp-2 leading-relaxed">
                          {featuredStory.excerpt}
                        </p>
                      )}
                      <span className="inline-block mt-2 px-3 py-1.5 bg-bronze text-white text-[10px] tracking-editorial uppercase font-medium rounded-xs">
                        Read Story →
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="bg-charcoal text-[#E8E2D9] p-5 text-center text-[10px] space-y-2">
                <p className="tracking-editorial uppercase text-white/50">
                  Lixxon Studio · New York · Paris
                </p>
                <p className="text-white/40">
                  You are receiving this because you subscribed to The Daily Reset.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
