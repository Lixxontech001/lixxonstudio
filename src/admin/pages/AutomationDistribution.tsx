import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clipboard, ExternalLink, ImageDown, Loader2,
  Pause, Play, RefreshCw, ShieldCheck, Share2, Sparkles,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import {
  DISTRIBUTION_CHANNELS,
  downloadDistributionImage,
  distributionShareUrl,
  parseDistributionArticles,
  parseDistributionSnapshot,
  type DistributionArticleOption,
  type DistributionChannel,
  type DistributionPayload,
  type DistributionSnapshot,
} from '../../lib/automationDistribution';

const STATE_LABELS: Record<DistributionChannel['state'], string> = {
  connected: 'Connected · approval required',
  approval_required: 'Connected · approval required',
  manual_kit: 'Manual kit',
  paused: 'Paused',
  blocked_by_provider_review: 'Blocked by provider review',
  quota_exhausted: 'Quota exhausted',
  not_configured: 'Not configured · manual kit available',
};
const STATE_STYLES: Record<DistributionChannel['state'], string> = {
  connected: 'border-amber-200 bg-amber-50 text-amber-950',
  approval_required: 'border-amber-200 bg-amber-50 text-amber-950',
  manual_kit: 'border-sky-200 bg-sky-50 text-sky-950',
  paused: 'border-gray-300 bg-gray-100 text-gray-800',
  blocked_by_provider_review: 'border-red-200 bg-red-50 text-red-900',
  quota_exhausted: 'border-amber-300 bg-amber-100 text-amber-950',
  not_configured: 'border-gray-200 bg-gray-50 text-gray-700',
};

function isFreshReadback(value: string | null): boolean {
  if (!value) return false;
  const checkedAt = Date.parse(value);
  return Number.isFinite(checkedAt) && checkedAt >= Date.now() - 24 * 60 * 60 * 1000;
}

function timeLabel(value: string | null): string {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  const lagos = date.toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });
  return `${lagos} WAT · ${date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')} UTC`;
}

function errorMessage(): string {
  return 'The database-verified distribution operation could not be completed. No provider response or credential details are shown.';
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function widgetSnippet(payload: DistributionPayload): string {
  return `<article class="lixxon-article-card"><h3><a href="${htmlEscape(payload.link)}">${htmlEscape(payload.title)}</a></h3><p>${htmlEscape(payload.caption.slice(0, 320))}</p><a href="${htmlEscape(payload.link)}">${htmlEscape(payload.cta)}</a></article>`;
}

function hasDraftEdits(edit: { title: string; subject: string; caption: string; hashtags: string } | undefined, draft: NonNullable<DistributionChannel['draft']>): boolean {
  return Boolean(edit && (
    edit.title !== draft.payload.title
    || edit.subject !== draft.payload.subject
    || edit.caption !== draft.payload.caption
    || edit.hashtags !== draft.payload.hashtags.join(' ')
  ));
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Use the accessible selection fallback below for restricted browser contexts.
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  return copied;
}

export default function AutomationDistribution() {
  const { adminAccess, email, session } = useAuth();
  const canManage = adminAccess?.status === 'active' && (adminAccess.is_owner || adminAccess.is_founder);
  const [articles, setArticles] = useState<DistributionArticleOption[]>([]);
  const [selectedPostId, setSelectedPostId] = useState('');
  const [snapshot, setSnapshot] = useState<DistributionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { title: string; subject: string; caption: string; hashtags: string }>>({});

  const loadArticles = useCallback(async () => {
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('automation_distribution_articles');
      if (rpcError) throw rpcError;
      const safe = parseDistributionArticles(data);
      if (!safe) throw new Error('invalid article list');
      setArticles(safe);
      if (safe.length === 0) setSnapshot(null);
      setSelectedPostId(current => current && safe.some(row => row.id === current) ? current : safe[0]?.id || '');
    } catch {
      setArticles([]);
      setSelectedPostId('');
      setError(errorMessage());
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSnapshot = useCallback(async (postId: string) => {
    if (!postId) {
      setSnapshot(null);
      return;
    }
    setBusy('refresh');
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('automation_distribution_snapshot', { p_post_id: postId });
      if (rpcError) throw rpcError;
      const safe = parseDistributionSnapshot(data);
      if (!safe) throw new Error('invalid channel snapshot');
      setSnapshot(safe);
      setEdits({});
    } catch {
      setSnapshot(null);
      setError(errorMessage());
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { void loadArticles(); }, [loadArticles]);
  useEffect(() => { if (selectedPostId) void loadSnapshot(selectedPostId); }, [selectedPostId, loadSnapshot]);

  const counts = useMemo(() => {
    const result = { ready: 0, manual: 0, blocked: 0, paused: 0 };
    for (const channel of snapshot?.channels || []) {
      if (channel.state === 'approval_required' || channel.state === 'connected') result.ready += 1;
      else if (channel.state === 'blocked_by_provider_review' || channel.state === 'quota_exhausted') result.blocked += 1;
      else if (channel.state === 'paused') result.paused += 1;
      else result.manual += 1;
    }
    return result;
  }, [snapshot]);

  const withAction = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try { await action(); } catch { setError(errorMessage()); } finally { setBusy(null); }
  };

  const prepareKit = () => withAction('prepare', async () => {
    if (!canManage || !selectedPostId) return;
    const { data, error: rpcError } = await supabase.rpc('automation_prepare_daily_kit', { p_post_id: selectedPostId });
    if (rpcError) throw rpcError;
    const safe = parseDistributionSnapshot(data);
    if (!safe) throw new Error('invalid distribution kit');
    setSnapshot(safe);
    setEdits({});
    setNotice(`Prepared ${safe.channels.length} owner-review drafts using article title, excerpt, tags and image metadata only. Article prose was not read or changed.`);
  });

  const saveDraft = (channel: DistributionChannel) => withAction(`save:${channel.key}`, async () => {
    if (!canManage || !channel.draft) return;
    const edit = edits[channel.draft.id];
    const payload: DistributionPayload = {
      ...channel.draft.payload,
      ...(edit ? {
        title: edit.title,
        subject: edit.subject,
        caption: edit.caption,
        hashtags: edit.hashtags.split(/[\s,]+/).filter(Boolean).slice(0, 12),
      } : {}),
    };
    const { error: rpcError } = await supabase.rpc('automation_save_distribution_draft', {
      p_draft_id: channel.draft.id,
      p_payload: {
        title: payload.title,
        subject: payload.subject,
        caption: payload.caption,
        hashtags: payload.hashtags,
        cta: payload.cta,
        link: payload.link,
        image_url: payload.imageUrl,
        image_alt: payload.imageAlt,
      },
    });
    if (rpcError) throw rpcError;
    await loadSnapshot(selectedPostId);
    setNotice(`${channel.label} copy saved as pending review. A saved edit clears its previous approval.`);
  });

  const approveDraft = (channel: DistributionChannel) => withAction(`approve:${channel.key}`, async () => {
    if (!canManage || !channel.draft || !window.confirm(`Approve this exact ${channel.label} distribution copy? It does not automatically publish. The approved text and checksum are audit-logged.`)) return;
    const { error: rpcError } = await supabase.rpc('automation_approve_distribution_draft', {
      p_draft_id: channel.draft.id,
      p_expected_sha256: channel.draft.payloadSha256,
    });
    if (rpcError) throw rpcError;
    await loadSnapshot(selectedPostId);
    setNotice(`${channel.label} copy approved. Use its platform link to review the final post before confirming there.`);
  });

  const rejectDraft = (channel: DistributionChannel) => withAction(`reject:${channel.key}`, async () => {
    if (!canManage || !channel.draft || !window.confirm(`Reject the current ${channel.label} copy? It will remain saved but will not be approved for sharing.`)) return;
    const { data, error: rpcError } = await supabase.rpc('automation_reject_distribution_draft', { p_draft_id: channel.draft.id });
    if (rpcError || data !== true) throw new Error('rejection failed');
    await loadSnapshot(selectedPostId);
    setNotice(`${channel.label} copy rejected and audit-logged.`);
  });

  const togglePause = (channel: DistributionChannel) => withAction(`pause:${channel.key}`, async () => {
    if (!canManage) return;
    const paused = channel.state !== 'paused';
    if (!window.confirm(`${paused ? 'Pause' : 'Resume'} ${channel.label}? The manual kit remains available; no article or previously approved copy is changed.`)) return;
    const { data, error: rpcError } = await supabase.rpc('automation_set_distribution_pause', {
      p_channel_key: channel.key,
      p_paused: paused,
    });
    if (rpcError || data !== true) throw new Error('channel pause failed');
    await loadSnapshot(selectedPostId);
    setNotice(`${channel.label} ${paused ? 'paused' : 'resumed'} and audit-logged.`);
  });

  const toggleDistributionFlag = () => withAction('distribution-flag', async () => {
    if (!canManage || !snapshot) return;
    const next = !snapshot.flags['automation.distribution'];
    if (!window.confirm(`${next ? 'Enable' : 'disable'} external distribution dispatch? Owner approval is still required for every channel item, and the separate master automation switch must also be on. This does not enable per-channel auto-publishing.`)) return;
    const { data, error: rpcError } = await supabase.rpc('automation_set_feature_flag', {
      p_flag_key: 'automation.distribution',
      p_enabled: next,
    });
    if (rpcError || data !== true) throw new Error('distribution flag update failed');
    await loadSnapshot(selectedPostId);
    setNotice(`Distribution dispatch ${next ? 'enabled' : 'disabled'} and audit-logged. Per-item approval remains required.`);
  });

  const checkConnection = (channel: DistributionChannel) => withAction(`check:${channel.key}`, async () => {
    if (!canManage) return;
    if (!window.confirm(`Run one read-only ${channel.label} connection check? The check will not publish, message, email, or change account content. X, Tumblr and the site widget remain manual-only and make no provider request.`)) return;
    const { data, error: functionError } = await supabase.functions.invoke('automation-distribution', {
      body: { action: 'check', channel: channel.key },
    });
    if (functionError || !data || typeof data.message !== 'string') throw new Error('provider readback failed');
    await loadSnapshot(selectedPostId);
    setNotice(data.message.slice(0, 300));
  });

  const sendTelegram = (channel: DistributionChannel) => withAction('send:telegram', async () => {
    const draft = channel.draft;
    if (!canManage || channel.key !== 'telegram' || !draft || draft.reviewStatus !== 'approved'
        || channel.state !== 'approval_required' || !isFreshReadback(channel.lastReadbackAt)
        || !snapshot?.flags['automation.enabled'] || !snapshot.flags['automation.distribution']) return;
    const confirmed = window.confirm(`Send this exact owner-approved Telegram caption and link to the private chat saved in Automation Keys? This sends one external message. Verify the destination chat and article copy before confirming.`);
    if (!confirmed) return;
    const { data, error: functionError } = await supabase.functions.invoke('automation-distribution', {
      body: {
        action: 'send_telegram', channel: 'telegram', draft_id: draft.id,
        payload_sha256: draft.payloadSha256,
      },
    });
    if (functionError || !data || data.ok !== true || typeof data.remotePostId !== 'string') {
      const message = data && typeof data.error === 'string' ? data.error : 'Telegram delivery could not be safely confirmed. Check the private chat before retrying.';
      setError(message.slice(0, 320));
      await loadSnapshot(selectedPostId);
      return;
    }
    await loadSnapshot(selectedPostId);
    setNotice(`Telegram accepted the message. Receipt ID ${data.remotePostId}. Article prose was not changed.`);
  });

  const sendNewsletterTest = (channel: DistributionChannel) => withAction('test:newsletter', async () => {
    const draft = channel.draft;
    if (!canManage || channel.key !== 'newsletter' || !draft || draft.reviewStatus !== 'approved'
        || hasDraftEdits(edits[draft.id], draft) || channel.state !== 'approval_required'
        || !isFreshReadback(channel.lastReadbackAt) || !email || !session?.user.email_confirmed_at
        || !/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email)) return;
    if (!window.confirm(`Send one approved newsletter preview as a test to your signed-in owner email? No subscribers will be contacted. Confirm only after reviewing the exact subject and email preview.`)) return;
    const { data, error: functionError } = await supabase.functions.invoke('automation-distribution', {
      body: { action: 'test_newsletter', channel: 'newsletter', draft_id: draft.id, payload_sha256: draft.payloadSha256 },
    });
    if (functionError || !data || data.ok !== true || typeof data.testEmailId !== 'string'
        || !/^[A-Za-z0-9._:-]{1,160}$/.test(data.testEmailId)) {
      const message = data && typeof data.error === 'string' ? data.error : 'The test email could not be safely confirmed. Check Resend before attempting a new approved version.';
      setError(message.slice(0, 320));
      await loadSnapshot(selectedPostId);
      return;
    }
    await loadSnapshot(selectedPostId);
    setNotice(`One test email was accepted to your signed-in owner address. No subscribers were contacted. Receipt ID ${data.testEmailId}.`);
  });

  const copyForChannel = async (channel: DistributionChannel, what: 'caption' | 'link' | 'widget' | 'subject' | 'email') => {
    if (!channel.draft || channel.draft.reviewStatus !== 'approved' || hasDraftEdits(edits[channel.draft.id], channel.draft)) return;
    const text = what === 'caption' ? channel.draft.payload.caption
      : what === 'link' ? channel.draft.payload.link
        : what === 'subject' ? channel.draft.payload.subject
          : what === 'email' ? `${channel.draft.payload.subject}\n\n${channel.draft.payload.caption}\n\n${channel.draft.payload.link}`
            : widgetSnippet(channel.draft.payload);
    const ok = await copyText(text);
    const label = what === 'widget' ? 'Widget snippet' : what === 'caption' ? 'Caption'
      : what === 'subject' ? 'Email subject' : what === 'email' ? 'Email preview' : 'Article link';
    setNotice(ok ? `${label} copied for ${channel.label}.` : 'Copy was not available in this browser. Select and copy the text manually.');
  };

  const channels = snapshot?.channels || [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-bronze"><Share2 size={18} aria-hidden="true" /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Owner-approved distribution</span></div>
          <h1 className="font-serif text-3xl text-charcoal">Daily Distribution Kit</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">Prepare platform-specific copy from the owner-entered title, excerpt, tags and selected image. This tool never reads or changes <code>posts.content</code>. Every channel needs a separate owner approval before its kit can be copied or shared.</p>
        </div>
        <button type="button" onClick={() => void loadArticles()} disabled={loading || busy !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-4 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:opacity-50">
          {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />} Refresh articles
        </button>
      </header>

      <section className="rounded-sm border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950" aria-label="Distribution safeguards">
        <p><strong>Approval-first:</strong> auto-publishing is off for every channel. No channel is labelled connected until a server-side provider readback succeeds. Platform app review, write scopes, quotas and unsupported formats remain manual or blocked rather than guessed.</p>
        <p className="mt-2">AI/provider calls and paid fallbacks are not used to prepare the manual kit. Telegram is the only direct channel publisher after a fresh readback, both owner switches, and a final send confirmation. Resend can send an explicit owner-only preview test, never a subscriber campaign. Other channels remain user-confirmed through their official share/composer pages.</p>
      </section>

      {canManage && snapshot && (
        <section className="flex flex-col gap-3 rounded-sm border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Distribution master switch">
          <div>
            <h2 className="font-semibold text-charcoal">External distribution dispatch</h2>
            <p className="mt-1 text-xs leading-5 text-gray-600">Master automation: <strong>{snapshot.flags['automation.enabled'] ? 'On' : 'Off'}</strong> · Distribution: <strong>{snapshot.flags['automation.distribution'] ? 'On' : 'Off'}</strong> · Per-channel auto-publish: <strong>Off</strong></p>
            <p className="text-xs text-gray-600">Enabling this switch never removes per-item approval. The 30-day auto-publish eligibility threshold is intentionally unresolved, so no auto-publish control is exposed.</p>
          </div>
          <button type="button" role="switch" aria-checked={snapshot.flags['automation.distribution']} aria-label={`External distribution dispatch: ${snapshot.flags['automation.distribution'] ? 'on' : 'off'}`} disabled={busy !== null} onClick={toggleDistributionFlag} className={`inline-flex min-h-11 w-20 shrink-0 items-center justify-between rounded-full border px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:cursor-not-allowed disabled:opacity-60 ${snapshot.flags['automation.distribution'] ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-gray-300 bg-gray-100 text-gray-700'}`}>
            <span aria-hidden="true" className="text-[10px] font-semibold">{snapshot.flags['automation.distribution'] ? 'On' : 'Off'}</span><span aria-hidden="true" className="h-7 w-7 rounded-full bg-white shadow-sm" />
          </button>
        </section>
      )}

      <section className="rounded-sm border border-gray-200 bg-white p-4">
        <label htmlFor="distribution-article" className="mb-2 block text-sm font-medium text-charcoal">Scheduled or published article</label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <select id="distribution-article" value={selectedPostId} onChange={event => setSelectedPostId(event.target.value)} disabled={loading || busy !== null || articles.length === 0} className="min-h-11 min-w-0 flex-1 rounded-sm border border-gray-300 bg-white px-3 text-sm text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze">
            {articles.length === 0 && <option value="">No scheduled or published articles</option>}
            {articles.map(article => <option key={article.id} value={article.id}>{article.title} · {article.status} · {timeLabel(article.scheduledAtUtc)}</option>)}
          </select>
          <button type="button" onClick={() => void prepareKit()} disabled={!canManage || !selectedPostId || busy !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-charcoal px-4 text-sm font-medium text-white hover:bg-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:cursor-not-allowed disabled:opacity-50">
            {busy === 'prepare' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />} Prepare 13-channel kit
          </button>
        </div>
        {snapshot && <p className="mt-2 text-xs text-gray-600">Selected: <strong>{snapshot.title}</strong> · {snapshot.status} · {timeLabel(snapshot.scheduledAtUtc)} · {snapshot.channels.length} channel targets</p>}
        {!canManage && <p className="mt-2 text-xs text-amber-900">Only an active owner or founder can generate, edit, approve or pause distribution drafts.</p>}
      </section>

      {snapshot && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Channel summary">
            <div className="rounded-sm border border-emerald-200 bg-emerald-50 p-3 text-emerald-900"><p className="text-xs uppercase">Verified readback</p><p className="mt-1 text-2xl font-semibold">{counts.ready}</p></div>
            <div className="rounded-sm border border-sky-200 bg-sky-50 p-3 text-sky-950"><p className="text-xs uppercase">Manual / not configured</p><p className="mt-1 text-2xl font-semibold">{counts.manual}</p></div>
            <div className="rounded-sm border border-amber-200 bg-amber-50 p-3 text-amber-950"><p className="text-xs uppercase">Provider / quota block</p><p className="mt-1 text-2xl font-semibold">{counts.blocked}</p></div>
            <div className="rounded-sm border border-gray-200 bg-gray-50 p-3 text-gray-800"><p className="text-xs uppercase">Paused by owner</p><p className="mt-1 text-2xl font-semibold">{counts.paused}</p></div>
          </section>

          <section className="rounded-sm border border-gray-200 bg-white p-4" aria-label="Aggregate distribution measurement">
            <h2 className="text-sm font-semibold text-charcoal">Performance · aggregate only · last 30 days</h2>
            <p className="mt-1 text-xs leading-5 text-gray-600">Provider or consented-site totals are labeled measured; estimates are labeled separately. No customer-level identifiers or event rows are stored.</p>
            {snapshot.metrics.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600">No aggregate metrics have been measured for this article yet. No provider measurement is claimed while channels remain unconfigured.</p>
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {snapshot.metrics.map((metric, index) => (
                  <li key={`${metric.channelKey}-${metric.metricKey}-${metric.measurementKind}-${metric.collectionBasis}-${metric.variantId || 'article'}-${index}`} className="rounded-sm border border-gray-200 bg-gray-50 p-3 text-sm">
                    <p className="font-medium text-charcoal">{metric.channelKey.replace(/_/g, ' ')} · {metric.metricKey.replace(/_/g, ' ')}</p>
                    <p className="mt-1 text-lg font-semibold text-charcoal">{metric.metricKey.endsWith('_rate') ? `${(metric.value * 100).toFixed(1)}%` : new Intl.NumberFormat().format(metric.value)}</p>
                    <p className="text-xs text-gray-600">{metric.measurementKind === 'measured' ? 'Measured' : 'Estimate'} · {metric.collectionBasis.replace(/_/g, ' ')} · {metric.periodStart}–{metric.periodEnd}</p>
                    {metric.variantId && <p className="mt-1 text-xs text-gray-600">Owner-approved A/B variant</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {snapshot.excerpt && <section className="rounded-sm border border-gray-200 bg-white p-4"><h2 className="text-sm font-semibold text-charcoal">Owner-entered excerpt source</h2><p className="mt-2 text-sm leading-6 text-gray-700">{snapshot.excerpt}</p><p className="mt-2 text-xs text-gray-500">This is the saved article excerpt field, not the article body. Review copy per channel below before approval.</p></section>}

          <section className="space-y-4" aria-label="Distribution channels">
            {channels.map(channel => {
              const metadata = DISTRIBUTION_CHANNELS[channel.key];
              const draft = channel.draft;
              const edit = draft ? edits[draft.id] : undefined;
              const caption = edit?.caption ?? draft?.payload.caption ?? '';
              const dirty = draft ? hasDraftEdits(edit, draft) : false;
              const approved = draft?.reviewStatus === 'approved';
              const shareReady = approved && !dirty;
              const delivered = draft?.reviewStatus === 'sent' || draft?.delivery?.status === 'sent';
              const isSaving = busy === `save:${channel.key}`;
              return (
                <article key={channel.key} className="overflow-hidden rounded-sm border border-gray-200 bg-white">
                  <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h2 className="font-serif text-xl text-charcoal">{channel.label}</h2><span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATE_STYLES[channel.state]}`}>{STATE_LABELS[channel.state]}</span>{draft && <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">Copy: {draft.reviewStatus.replace('_', ' ')}</span>}</div>
                      <p className="mt-2 max-w-3xl text-sm leading-5 text-gray-600">{channel.stateReason}</p>
                      <p className="mt-1 text-xs text-gray-500">{metadata.instructions}</p>
                      <p className="mt-1 text-xs text-gray-500">{channel.dailyFreeQuota === null ? 'Provider free-tier quota: not measured.' : `Owner-set daily safety cap: ${channel.dailyFreeQuota} · remaining: ${channel.quotaRemaining ?? 'not measured'}`} · Last provider readback: {channel.lastReadbackAt ? timeLabel(channel.lastReadbackAt) : 'not tested'}</p>
                      <p className="mt-1 text-xs text-gray-600">Today in Lagos: {channel.usageToday.deliveryAttempts} delivery attempts ({channel.usageToday.deliverySuccesses} accepted, {channel.usageToday.deliveryFailures} failed), {channel.usageToday.readbackAttempts} read-only checks{channel.key === 'newsletter' ? `, ${channel.usageToday.ownerTestEmailAttempts}/3 owner-only test emails` : ''}. Circuit: {channel.circuitState.replace('_', ' ')}{channel.failureStreak > 0 ? ` · failure streak ${channel.failureStreak} (${channel.lastFailureClass || 'unclassified'})` : ''}{channel.retryAfter ? ` · retry after ${timeLabel(channel.retryAfter)}` : ''}.</p>
                    </div>
                    {canManage && <div className="flex flex-wrap gap-2 sm:justify-end">
                      <button type="button" disabled={busy !== null} onClick={() => void checkConnection(channel)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-sm border border-sky-200 bg-sky-50 px-3 text-sm text-sky-950 hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:opacity-50">{busy === `check:${channel.key}` ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}Read-only check</button>
                      <button type="button" disabled={busy !== null} onClick={() => void togglePause(channel)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-3 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:opacity-50">{channel.state === 'paused' ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}{channel.state === 'paused' ? 'Resume channel' : 'Pause channel'}</button>
                    </div>}
                  </div>

                  {draft ? (
                    <div className="space-y-4 p-4 sm:p-5">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div><label htmlFor={`dist-title-${channel.key}`} className="mb-1 block text-xs font-medium text-gray-700">Distribution title</label><input id={`dist-title-${channel.key}`} maxLength={200} disabled={!canManage || delivered || busy !== null} value={edit?.title ?? draft.payload.title} onChange={event => setEdits(previous => ({ ...previous, [draft.id]: { title: event.target.value, subject: edit?.subject ?? draft.payload.subject, caption: edit?.caption ?? draft.payload.caption, hashtags: edit?.hashtags ?? draft.payload.hashtags.join(' ') } }))} className="min-h-11 w-full rounded-sm border border-gray-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:bg-gray-50" /></div>
                        <div><label htmlFor={`dist-subject-${channel.key}`} className="mb-1 block text-xs font-medium text-gray-700">Email subject / share title</label><input id={`dist-subject-${channel.key}`} maxLength={180} disabled={!canManage || delivered || busy !== null} value={edit?.subject ?? draft.payload.subject} onChange={event => setEdits(previous => ({ ...previous, [draft.id]: { title: edit?.title ?? draft.payload.title, subject: event.target.value, caption: edit?.caption ?? draft.payload.caption, hashtags: edit?.hashtags ?? draft.payload.hashtags.join(' ') } }))} className="min-h-11 w-full rounded-sm border border-gray-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:bg-gray-50" /></div>
                      </div>
                      <div><label htmlFor={`dist-caption-${channel.key}`} className="mb-1 block text-xs font-medium text-gray-700">Channel copy (distribution only)</label><textarea id={`dist-caption-${channel.key}`} maxLength={Math.min(metadata.maxCaption, 3000)} rows={5} disabled={!canManage || delivered || busy !== null} value={caption} onChange={event => setEdits(previous => ({ ...previous, [draft.id]: { title: edit?.title ?? draft.payload.title, subject: edit?.subject ?? draft.payload.subject, caption: event.target.value, hashtags: edit?.hashtags ?? draft.payload.hashtags.join(' ') } }))} className="w-full rounded-sm border border-gray-300 px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:bg-gray-50" /><p className="mt-1 text-right text-xs text-gray-500">{caption.length}/{Math.min(metadata.maxCaption, 3000)} characters</p></div>
                      <div><label htmlFor={`dist-hashtags-${channel.key}`} className="mb-1 block text-xs font-medium text-gray-700">Hashtags (space or comma separated)</label><input id={`dist-hashtags-${channel.key}`} maxLength={640} disabled={!canManage || delivered || busy !== null} value={edit?.hashtags ?? draft.payload.hashtags.join(' ')} onChange={event => setEdits(previous => ({ ...previous, [draft.id]: { title: edit?.title ?? draft.payload.title, subject: edit?.subject ?? draft.payload.subject, caption: edit?.caption ?? draft.payload.caption, hashtags: event.target.value } }))} className="min-h-11 w-full rounded-sm border border-gray-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:bg-gray-50" /></div>
                      <div className="grid gap-2 rounded-sm bg-gray-50 p-3 text-xs text-gray-700 sm:grid-cols-2"><p><strong>UTM link:</strong> <a href={draft.payload.link} target="_blank" rel="noreferrer" className="break-all text-bronze underline">{draft.payload.link}</a></p><p><strong>CTA:</strong> {draft.payload.cta}</p><p><strong>Image alt:</strong> {draft.payload.imageAlt || 'Not set'}</p><p><strong>Approval:</strong> {channel.approvalRequired ? 'Required for every item' : 'not required'} · <strong>Auto-publish:</strong> {channel.autoPublishEnabled ? 'enabled' : 'off'}</p></div>
                      {draft.payload.imageUrl && <div className="flex flex-wrap items-center gap-2"><a className="inline-flex min-h-11 items-center gap-2 text-sm text-bronze underline" href={draft.payload.imageUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />Open selected image</a><button type="button" onClick={() => void downloadDistributionImage(draft.payload.imageUrl!, draft.payload.title).then(ok => setNotice(ok ? 'Image downloaded.' : 'This image host did not allow a safe browser download. Use “Open selected image” and save it from the owner-selected source.'))} className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-gray-300 bg-white px-3 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"><ImageDown size={15} aria-hidden="true" />Download image</button></div>}

                      {channel.key === 'newsletter' && <details className="rounded-sm border border-sky-200 bg-sky-50 p-4">
                        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-sky-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze">Preview email and owner-only test</summary>
                        <div className="mt-3 max-w-2xl rounded-sm border border-gray-200 bg-white p-5">
                          {draft.payload.imageUrl && <img src={draft.payload.imageUrl} alt={draft.payload.imageAlt} className="mb-4 max-h-64 w-full object-cover" />}
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Subject</p>
                          <h3 className="mb-4 mt-1 text-lg font-semibold text-charcoal">{draft.payload.subject}</h3>
                          <div className="whitespace-pre-line text-sm leading-6 text-gray-700">{draft.payload.caption}</div>
                          <p className="mt-4"><a href={draft.payload.link} target="_blank" rel="noreferrer" className="break-all text-sm text-bronze underline">{draft.payload.link}</a></p>
                          <p className="mt-4 text-xs text-gray-500">A confirmed test goes only to your signed-in owner address, at most three times per Lagos day and once per approved copy. It does not contact subscribers. The subscriber admin remains separate; bulk newsletter sending is not enabled by this test flow.</p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => void copyForChannel(channel, 'subject')} className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-gray-300 bg-white px-3 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"><Clipboard size={15} aria-hidden="true" />Copy subject</button>
                          <button type="button" onClick={() => void copyForChannel(channel, 'email')} className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-gray-300 bg-white px-3 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"><Clipboard size={15} aria-hidden="true" />Copy email body</button>
                          {canManage && <button type="button" disabled={busy !== null || !shareReady || channel.state !== 'approval_required' || !isFreshReadback(channel.lastReadbackAt) || !email || !session?.user.email_confirmed_at || draft.testDelivery !== null} onClick={() => void sendNewsletterTest(channel)} className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-emerald-800 px-3 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:cursor-not-allowed disabled:opacity-50"><Share2 size={15} aria-hidden="true" />Send one confirmed test to me</button>}
                        </div>
                        <p className="mt-2 text-xs text-gray-600">To enable the test, confirm this exact copy, verify a Resend sending domain with <strong>Read-only check</strong>, and use an active owner account with a confirmed email. If the test button is disabled, inspect the channel state and existing receipt above.</p>
                        {draft.testDelivery && <p role="status" className={`mt-3 rounded-sm border p-3 text-sm ${draft.testDelivery.status === 'sent' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
                          {draft.testDelivery.status === 'sent' ? `Owner-only test receipt confirmed · ${draft.testDelivery.remoteEmailId}` : `Test status: ${draft.testDelivery.status.replace(/_/g, ' ')}${draft.testDelivery.safeErrorCode ? ` · ${draft.testDelivery.safeErrorCode}` : ''}. Check Resend before editing and re-approving a new test version.`}
                        </p>}
                      </details>}

                      {draft.delivery?.status === 'sent' && <p role="status" className="rounded-sm border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 size={15} className="mr-1 inline" aria-hidden="true" />Provider receipt confirmed · remote ID {draft.delivery.remotePostId}</p>}
                      {draft.delivery?.safeErrorCode && draft.delivery.status !== 'sent' && <p role="status" className="rounded-sm border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle size={15} className="mr-1 inline" aria-hidden="true" />Safe delivery result: {draft.delivery.safeErrorCode.replace(/_/g, ' ')}. Verify the private chat before saving and re-approving any retry.</p>}
                      {channel.key === 'telegram' && approved && channel.state === 'approval_required' && !isFreshReadback(channel.lastReadbackAt) && <p className="rounded-sm border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Direct send is paused because the last Telegram readback is older than 24 hours. Run a new read-only check first.</p>}

                      {dirty && approved && <p role="status" className="rounded-sm border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">This approved copy has unsaved edits. Save it to clear approval, then review and approve the new version before copying or sharing.</p>}
                      {dirty && !approved && <p role="status" className="rounded-sm border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Save the edited copy before approving. Approval applies only to the saved checksum, never to unsaved text.</p>}

                      <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                        {canManage && !delivered && <button type="button" disabled={busy !== null} onClick={() => void saveDraft(channel)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-3 text-sm font-medium text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:opacity-50">{isSaving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Clipboard size={15} aria-hidden="true" />}Save copy</button>}
                        {canManage && !delivered && !approved && <button type="button" disabled={busy !== null || dirty} onClick={() => void approveDraft(channel)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-emerald-800 px-3 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:opacity-50"><ShieldCheck size={15} aria-hidden="true" />Approve this copy</button>}
                        {canManage && draft.reviewStatus !== 'sent' && <button type="button" disabled={busy !== null} onClick={() => void rejectDraft(channel)} className="inline-flex min-h-11 items-center justify-center rounded-sm border border-red-200 bg-white px-3 text-sm font-medium text-red-800 hover:border-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:opacity-50">Reject copy</button>}
                        {shareReady && <>
                          <button type="button" onClick={() => void copyForChannel(channel, 'caption')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-3 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"><Clipboard size={15} aria-hidden="true" />Copy caption</button>
                          <button type="button" onClick={() => void copyForChannel(channel, 'link')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-3 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"><Clipboard size={15} aria-hidden="true" />Copy UTM link</button>
                          {channel.key === 'site_widget' && <button type="button" onClick={() => void copyForChannel(channel, 'widget')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-3 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"><Clipboard size={15} aria-hidden="true" />Copy safe widget snippet</button>}
                          <a href={distributionShareUrl(channel.key, draft.payload)} target={metadata.mode === 'internal' ? undefined : '_blank'} rel={metadata.mode === 'internal' ? undefined : 'noreferrer'} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-sky-200 bg-sky-50 px-3 text-sm font-medium text-sky-950 hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze">{metadata.mode === 'internal' ? (channel.key === 'site_widget' ? 'Open article' : 'Open subscriber admin') : 'Open platform'}<ExternalLink size={14} aria-hidden="true" /></a>
                          {channel.key === 'telegram' && canManage && <button type="button" disabled={busy !== null || channel.state !== 'approval_required' || !snapshot?.flags['automation.enabled'] || !snapshot?.flags['automation.distribution'] || channel.quotaRemaining === 0} onClick={() => void sendTelegram(channel)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-emerald-800 px-3 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:cursor-not-allowed disabled:opacity-50">{busy === 'send:telegram' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Share2 size={15} aria-hidden="true" />}Send approved message</button>}
                        </>}
                      </div>
                      {shareReady && <p className="mt-2 text-xs leading-5 text-amber-900">This kit is approved for this channel only. Review the external platform's final preview and audience before confirming there; the platform action is not recorded as a verified success here.</p>}
                      {delivered && <p className="mt-2 text-xs text-gray-600">A receipt was recorded. Further edits or sends require a new owner-reviewed copy.</p>}
                    </div>
                  ) : (
                    <div className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><p className="text-sm text-gray-600">No saved channel copy for this article. Prepare the 13-channel kit to create reviewable drafts.</p>{canManage && <button type="button" onClick={() => void prepareKit()} disabled={busy !== null || !selectedPostId} className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-gray-300 bg-white px-3 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze disabled:opacity-50"><Sparkles size={15} aria-hidden="true" />Prepare kit</button>}</div>
                  )}
                </article>
              );
            })}
          </section>
        </>
      )}

      {loading && <p role="status" className="text-sm text-gray-500">Loading eligible articles…</p>}
      {!loading && articles.length === 0 && !error && <div className="rounded-sm border border-gray-200 bg-white p-6 text-sm text-gray-600">No scheduled or published articles are available for a distribution kit. The page will not create a kit from an unapproved draft.</div>}
      {error && <p role="alert" className="rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
      {notice && <p role="status" aria-live="polite" className="rounded-sm border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
    </div>
  );
}
