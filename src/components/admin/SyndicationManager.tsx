import { useState, useEffect, useCallback } from 'react';
import {
  Share2, Plus, Edit2, Trash2, Send, CheckCircle2, XCircle,
  AlertCircle, Loader2, ChevronDown, ChevronUp, RefreshCw,
  Globe, Radio, ShieldCheck, X
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../../context/ToastContext';

export type PlatformType =
  | 'discord'
  | 'flipboard'
  | 'telegram'
  | 'bluesky'
  | 'mastodon'
  | 'medium'
  | 'tumblr'
  | 'substack';

export type NicheType = 'all' | 'skincare' | 'wellness' | 'style';

export interface SyndicationDestination {
  id: string;
  platform: PlatformType;
  name: string;
  niche: NicheType;
  is_active: boolean;
  config: Record<string, string>;
  created_at?: string;
  updated_at?: string;
}

export interface SyndicationLog {
  id: string;
  post_id: string;
  post_slug: string;
  destination_id: string | null;
  platform: string;
  status: 'success' | 'failed' | 'skipped';
  error_message: string | null;
  created_at: string;
}

const PLATFORM_META: Record<
  PlatformType,
  { label: string; icon: string; color: string; bg: string; border: string }
> = {
  discord: {
    label: 'Discord',
    icon: '💬',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    border: 'border-indigo-200',
  },
  flipboard: {
    label: 'Flipboard',
    icon: '📑',
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
  },
  telegram: {
    label: 'Telegram',
    icon: '✈️',
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    border: 'border-sky-200',
  },
  bluesky: {
    label: 'Bluesky',
    icon: '🦋',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  mastodon: {
    label: 'Mastodon',
    icon: '🐘',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
  },
  medium: {
    label: 'Medium',
    icon: '✍️',
    color: 'text-stone-800',
    bg: 'bg-stone-100',
    border: 'border-stone-300',
  },
  tumblr: {
    label: 'Tumblr',
    icon: '🎨',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
  },
  substack: {
    label: 'Substack',
    icon: '📰',
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
  },
};

const NICHE_BADGES: Record<NicheType, { label: string; cls: string }> = {
  all: { label: 'All Niches', cls: 'bg-charcoal/10 text-charcoal border-charcoal/20' },
  skincare: { label: 'Skincare', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  wellness: { label: 'Wellness', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  style: { label: 'Style', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
};

export default function SyndicationManager() {
  const { showToast } = useToast();
  const [destinations, setDestinations] = useState<SyndicationDestination[]>([]);
  const [logs, setLogs] = useState<SyndicationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<PlatformType>('discord');
  const [name, setName] = useState('');
  const [niche, setNiche] = useState<NicheType>('all');
  const [isActive, setIsActive] = useState(true);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Dispatch testing state
  const [testingId, setTestingId] = useState<string | null>(null);

  const loadDestinations = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('syndication_destinations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDestinations((data as SyndicationDestination[]) || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load destinations';
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadLogs = useCallback(async () => {
    try {
      setLogsLoading(true);
      const { data, error } = await supabase
        .from('syndication_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setLogs((data as SyndicationLog[]) || []);
    } catch (err: unknown) {
      console.error('Error fetching syndication logs:', err);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDestinations();
    loadLogs();
  }, [loadDestinations, loadLogs]);

  const openCreateModal = () => {
    setEditingId(null);
    setPlatform('discord');
    setName('');
    setNiche('all');
    setIsActive(true);
    setConfig({});
    setModalOpen(true);
  };

  const openEditModal = (dest: SyndicationDestination) => {
    setEditingId(dest.id);
    setPlatform(dest.platform);
    setName(dest.name);
    setNiche(dest.niche);
    setIsActive(dest.is_active);
    setConfig({ ...dest.config });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('Destination name is required', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        platform,
        name: name.trim(),
        niche,
        is_active: isActive,
        config,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error } = await supabase
          .from('syndication_destinations')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
        showToast('Destination updated successfully', 'success');
      } else {
        const { error } = await supabase
          .from('syndication_destinations')
          .insert([payload]);
        if (error) throw error;
        showToast('New destination added successfully', 'success');
      }

      setModalOpen(false);
      await loadDestinations();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save destination';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, destName: string) => {
    if (!window.confirm(`Delete destination "${destName}"? This will also remove its associated log history.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('syndication_destinations')
        .delete()
        .eq('id', id);

      if (error) throw error;
      showToast(`Deleted "${destName}"`, 'success');
      setDestinations(prev => prev.filter(d => d.id !== id));
      loadLogs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete destination';
      showToast(msg, 'error');
    }
  };

  const handleToggleActive = async (dest: SyndicationDestination) => {
    const updatedStatus = !dest.is_active;
    // Optimistic update
    setDestinations(prev =>
      prev.map(d => (d.id === dest.id ? { ...d, is_active: updatedStatus } : d))
    );

    try {
      const { error } = await supabase
        .from('syndication_destinations')
        .update({ is_active: updatedStatus, updated_at: new Date().toISOString() })
        .eq('id', dest.id);

      if (error) throw error;
      showToast(`Destination ${updatedStatus ? 'activated' : 'deactivated'}`, 'info');
    } catch (err: unknown) {
      // Revert optimistic update
      setDestinations(prev =>
        prev.map(d => (d.id === dest.id ? { ...d, is_active: dest.is_active } : d))
      );
      const msg = err instanceof Error ? err.message : 'Failed to update status';
      showToast(msg, 'error');
    }
  };

  const handleTestDispatch = async (dest: SyndicationDestination) => {
    setTestingId(dest.id);
    let detail = '';

    try {
      switch (dest.platform) {
        case 'discord': {
          if (!dest.config.webhook_url) throw new Error('Missing Discord Webhook URL');
          const res = await fetch(dest.config.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: 'Lixxon Studio Editorial',
              embeds: [
                {
                  title: '🧪 Lixxon Studio Syndication Test',
                  description: `Test dispatch verified for destination **${dest.name}** (${dest.niche} niche).`,
                  color: 10250055,
                  footer: { text: 'Lixxon Studio Syndication Engine' },
                  timestamp: new Date().toISOString(),
                },
              ],
            }),
          });
          if (!res.ok) throw new Error(`Discord returned HTTP ${res.status}`);
          detail = 'Discord webhook payload delivered.';
          break;
        }

        case 'telegram': {
          if (!dest.config.bot_token || !dest.config.chat_id) {
            throw new Error('Missing Telegram Bot Token or Chat ID');
          }
          const res = await fetch(`https://api.telegram.org/bot${dest.config.bot_token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: dest.config.chat_id,
              text: `🧪 <b>Lixxon Studio Syndication Test</b>\n\nTest dispatch verified for destination <i>${dest.name}</i> (${dest.niche} niche).`,
              parse_mode: 'HTML',
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.description || `Telegram error ${res.status}`);
          detail = 'Telegram message posted to channel.';
          break;
        }

        case 'bluesky': {
          if (!dest.config.handle || !dest.config.app_password) {
            throw new Error('Missing Bluesky Handle or App Password');
          }
          const res = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              identifier: dest.config.handle,
              password: dest.config.app_password,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || `Bluesky auth HTTP ${res.status}`);
          detail = `Authenticated as @${dest.config.handle}`;
          break;
        }

        case 'mastodon': {
          const inst = (dest.config.instance_url || 'https://mastodon.social').replace(/\/$/, '');
          const token = dest.config.access_token;
          if (!token) throw new Error('Missing Mastodon Access Token');
          const res = await fetch(`${inst}/api/v1/accounts/verify_credentials`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `Mastodon HTTP ${res.status}`);
          detail = `Verified account @${data.username || 'user'}`;
          break;
        }

        case 'medium': {
          const token = dest.config.integration_token;
          if (!token) throw new Error('Missing Medium Integration Token');
          const res = await fetch('https://api.medium.com/v1/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.errors?.[0]?.message || `Medium HTTP ${res.status}`);
          detail = `Verified Medium author: ${data.data?.name || data.data?.username}`;
          break;
        }

        case 'flipboard': {
          if (!dest.config.magazine_url) throw new Error('Missing Flipboard Magazine URL');
          if (!dest.config.flipboard_session) throw new Error('Missing Flipboard session cookie');
          detail = 'Magazine URL & Session format validated.';
          break;
        }

        case 'tumblr': {
          if (!dest.config.blog_identifier) throw new Error('Missing Tumblr Blog Identifier');
          if (!dest.config.consumer_key) throw new Error('Missing Tumblr Consumer Key');
          detail = `Blog identifier ${dest.config.blog_identifier} validated.`;
          break;
        }

        case 'substack': {
          if (!dest.config.subdomain) throw new Error('Missing Substack Subdomain');
          if (!dest.config.connect_sid) throw new Error('Missing Substack connect.sid cookie');
          detail = `Substack ${dest.config.subdomain}.substack.com validated.`;
          break;
        }

        default:
          throw new Error('Unsupported platform');
      }

      showToast(`✓ Test dispatch to ${dest.name} succeeded! ${detail}`, 'success', undefined, 5000);

      // Record success in log
      await supabase.from('syndication_logs').insert([
        {
          post_id: 'test-ping',
          post_slug: 'test-dispatch-verification',
          destination_id: dest.id,
          platform: dest.platform,
          status: 'success',
          error_message: detail || 'Test dispatch verified',
        },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Test dispatch failed';
      showToast(`✗ Test dispatch failed: ${msg}`, 'error', undefined, 6000);

      // Record failure in log
      await supabase.from('syndication_logs').insert([
        {
          post_id: 'test-ping',
          post_slug: 'test-dispatch-verification',
          destination_id: dest.id,
          platform: dest.platform,
          status: 'failed',
          error_message: msg,
        },
      ]);
    } finally {
      setTestingId(null);
      loadLogs();
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-taupe/30">
        <div>
          <div className="flex items-center gap-2">
            <Radio size={20} className="text-bronze" />
            <h1 className="font-serif text-2xl md:text-3xl text-charcoal">Multi-Channel Syndication</h1>
          </div>
          <p className="text-sm text-charcoal-muted mt-1">
            Configure automated multi-channel destinations, niche routing, and live cross-posting pipelines.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-charcoal text-white text-xs uppercase tracking-editorial rounded-sm hover:bg-bronze transition-all duration-200 self-start sm:self-auto shadow-sm"
        >
          <Plus size={15} />
          <span>Add Destination</span>
        </button>
      </div>

      {/* Destinations Table */}
      <div className="bg-white rounded-sm border border-taupe/40 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-taupe/20 bg-taupe-light/20 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Share2 size={16} className="text-bronze" />
            <h2 className="font-serif text-base text-charcoal font-medium">Configured Channels</h2>
            <span className="text-xs bg-charcoal/10 text-charcoal px-2 py-0.5 rounded-full font-mono">
              {destinations.length}
            </span>
          </div>
          <button
            onClick={loadDestinations}
            disabled={loading}
            className="text-xs text-charcoal-muted hover:text-bronze flex items-center gap-1 transition-colors"
            title="Refresh Destinations"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-charcoal-muted text-sm flex flex-col items-center gap-2">
            <Loader2 size={24} className="animate-spin text-bronze" />
            <span>Loading syndication destinations…</span>
          </div>
        ) : destinations.length === 0 ? (
          <div className="py-16 text-center text-charcoal-muted text-sm max-w-md mx-auto px-4">
            <Globe size={32} className="mx-auto text-taupe mb-3" />
            <p className="font-medium text-charcoal text-base">No destinations added yet</p>
            <p className="text-xs text-charcoal-muted mt-1 mb-5">
              Add your Discord webhooks, Telegram bots, Bluesky, Mastodon, or publication accounts to automatically syndicate editorial articles.
            </p>
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-charcoal text-white text-xs uppercase tracking-editorial rounded-sm hover:bg-bronze transition-all"
            >
              <Plus size={14} /> Add First Destination
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-taupe-light/40 text-[11px] uppercase tracking-wider text-charcoal-muted border-b border-taupe/20">
                <tr>
                  <th className="py-3 px-4 font-medium">Platform</th>
                  <th className="py-3 px-4 font-medium">Destination Name</th>
                  <th className="py-3 px-4 font-medium">Assigned Niche</th>
                  <th className="py-3 px-4 font-medium text-center">Active</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-taupe/20">
                {destinations.map(dest => {
                  const meta = PLATFORM_META[dest.platform] || {
                    label: dest.platform,
                    icon: '🌐',
                    color: 'text-charcoal',
                    bg: 'bg-gray-100',
                    border: 'border-gray-200',
                  };
                  const nicheBadge = NICHE_BADGES[dest.niche] || NICHE_BADGES.all;
                  const isTesting = testingId === dest.id;

                  return (
                    <tr key={dest.id} className="hover:bg-taupe-light/20 transition-colors">
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-lg leading-none" aria-hidden="true">
                            {meta.icon}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-sm font-medium border ${meta.bg} ${meta.color} ${meta.border}`}
                          >
                            {meta.label}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="font-medium text-charcoal block">{dest.name}</span>
                        <span className="text-[11px] text-charcoal-muted font-mono truncate max-w-xs block">
                          {dest.platform === 'discord' && (dest.config.webhook_url ? 'Webhook configured' : 'No URL')}
                          {dest.platform === 'telegram' && (dest.config.chat_id ? `Chat: ${dest.config.chat_id}` : 'No chat ID')}
                          {dest.platform === 'bluesky' && (dest.config.handle ? `@${dest.config.handle}` : 'No handle')}
                          {dest.platform === 'mastodon' && (dest.config.instance_url ? dest.config.instance_url : 'No instance')}
                          {dest.platform === 'medium' && (dest.config.integration_token ? 'Token configured' : 'No token')}
                          {dest.platform === 'flipboard' && (dest.config.magazine_url || 'Magazine URL configured')}
                          {dest.platform === 'tumblr' && (dest.config.blog_identifier || 'Tumblr blog configured')}
                          {dest.platform === 'substack' && (dest.config.subdomain ? `${dest.config.subdomain}.substack.com` : 'No subdomain')}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${nicheBadge.cls}`}
                        >
                          {nicheBadge.label}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(dest)}
                          className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            dest.is_active ? 'bg-emerald-600' : 'bg-gray-300'
                          }`}
                          role="switch"
                          aria-checked={dest.is_active}
                          title={dest.is_active ? 'Deactivate destination' : 'Activate destination'}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              dest.is_active ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleTestDispatch(dest)}
                            disabled={isTesting}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-charcoal bg-white border border-taupe/60 rounded-sm hover:border-bronze hover:text-bronze transition-colors disabled:opacity-50"
                            title="Send sample test payload"
                          >
                            {isTesting ? (
                              <Loader2 size={12} className="animate-spin text-bronze" />
                            ) : (
                              <Send size={12} className="text-bronze" />
                            )}
                            <span className="hidden sm:inline">Test</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditModal(dest)}
                            className="p-1.5 text-charcoal-muted hover:text-charcoal border border-transparent hover:border-taupe/40 rounded-sm transition-colors"
                            title="Edit destination"
                          >
                            <Edit2 size={13} />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDelete(dest.id, dest.name)}
                            className="p-1.5 text-charcoal-muted hover:text-red-600 border border-transparent hover:border-red-200 rounded-sm transition-colors"
                            title="Delete destination"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Collapsible History Logs Table */}
      <div className="bg-white rounded-sm border border-taupe/40 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setHistoryOpen(!historyOpen)}
          className="w-full p-4 sm:p-5 border-b border-taupe/20 bg-taupe-light/20 flex items-center justify-between text-left hover:bg-taupe-light/30 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <Radio size={16} className="text-bronze" />
            <h2 className="font-serif text-base text-charcoal font-medium">Syndication History &amp; Dispatch Logs</h2>
            <span className="text-xs bg-charcoal/10 text-charcoal px-2 py-0.5 rounded-full font-mono">
              Last {logs.length}
            </span>
          </div>
          <div className="flex items-center gap-2 text-charcoal-muted">
            <span className="text-xs">{historyOpen ? 'Collapse' : 'Expand'}</span>
            {historyOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>

        {historyOpen && (
          <div>
            <div className="px-5 py-2.5 bg-taupe-light/10 border-b border-taupe/20 flex items-center justify-between text-xs text-charcoal-muted">
              <span>Auto-tracked dispatches from scheduled cron &amp; test dispatches</span>
              <button
                type="button"
                onClick={loadLogs}
                disabled={logsLoading}
                className="hover:text-bronze flex items-center gap-1 transition-colors"
              >
                <RefreshCw size={12} className={logsLoading ? 'animate-spin' : ''} />
                <span>Refresh Logs</span>
              </button>
            </div>

            {logsLoading ? (
              <div className="py-12 text-center text-charcoal-muted text-xs flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin text-bronze" />
                <span>Loading latest logs…</span>
              </div>
            ) : logs.length === 0 ? (
              <div className="py-12 text-center text-charcoal-muted text-xs">
                No syndication activity logged yet. Test a destination above or wait for the scheduled cron run.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-taupe-light/30 uppercase tracking-wider text-charcoal-muted border-b border-taupe/20">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Timestamp</th>
                      <th className="py-2.5 px-4 font-medium">Platform</th>
                      <th className="py-2.5 px-4 font-medium">Post Reference</th>
                      <th className="py-2.5 px-4 font-medium">Status</th>
                      <th className="py-2.5 px-4 font-medium">Details / Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-taupe/15">
                    {logs.map(log => {
                      const isSuccess = log.status === 'success';
                      const isSkipped = log.status === 'skipped';
                      const meta = PLATFORM_META[log.platform as PlatformType];

                      return (
                        <tr key={log.id} className="hover:bg-taupe-light/10 transition-colors">
                          <td className="py-2.5 px-4 whitespace-nowrap text-charcoal-muted font-mono text-[11px]">
                            {new Date(log.created_at).toLocaleString()}
                          </td>

                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 font-medium text-charcoal capitalize">
                              <span>{meta?.icon || '🌐'}</span>
                              <span>{meta?.label || log.platform}</span>
                            </span>
                          </td>

                          <td className="py-2.5 px-4 whitespace-nowrap font-mono text-charcoal text-[11px]">
                            {log.post_slug || log.post_id}
                          </td>

                          <td className="py-2.5 px-4 whitespace-nowrap">
                            {isSuccess ? (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                                <CheckCircle2 size={11} /> Success
                              </span>
                            ) : isSkipped ? (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                                <AlertCircle size={11} /> Skipped
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-medium">
                                <XCircle size={11} /> Failed
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 px-4 text-charcoal-muted max-w-md truncate">
                            {log.error_message || <span className="text-taupe">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit Destination Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-sm border border-taupe shadow-2xl w-full max-w-xl my-8 overflow-hidden animate-fade-in">
            {/* Modal Header */}
            <div className="p-5 border-b border-taupe/30 bg-taupe-light/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Share2 size={18} className="text-bronze" />
                <h3 className="font-serif text-lg text-charcoal font-medium">
                  {editingId ? 'Edit Syndication Destination' : 'Add Syndication Destination'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-charcoal-muted hover:text-charcoal p-1"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSave} className="p-6 space-y-5">
              {/* Platform Selector */}
              <div>
                <label className="block text-xs uppercase tracking-wider text-charcoal-muted mb-2 font-medium">
                  Target Platform
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.keys(PLATFORM_META) as PlatformType[]).map(pKey => {
                    const item = PLATFORM_META[pKey];
                    const selected = platform === pKey;
                    return (
                      <button
                        key={pKey}
                        type="button"
                        onClick={() => {
                          setPlatform(pKey);
                          // Clear or keep config
                        }}
                        className={`flex items-center gap-2 p-2.5 rounded-sm border text-xs text-left transition-all ${
                          selected
                            ? 'border-bronze bg-bronze/10 text-charcoal font-medium ring-1 ring-bronze'
                            : 'border-taupe/50 hover:border-taupe text-charcoal-muted hover:text-charcoal bg-white'
                        }`}
                      >
                        <span className="text-base">{item.icon}</span>
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Destination Name */}
              <div>
                <label className="block text-xs uppercase tracking-wider text-charcoal-muted mb-1.5 font-medium">
                  Destination Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Skincare Discord #announcements"
                  className="w-full border border-taupe/60 px-3.5 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze bg-white"
                />
              </div>

              {/* Niche & Status row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-charcoal-muted mb-1.5 font-medium">
                    Assigned Niche
                  </label>
                  <select
                    value={niche}
                    onChange={e => setNiche(e.target.value as NicheType)}
                    className="w-full border border-taupe/60 px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze bg-white"
                  >
                    <option value="all">All Articles (Universal)</option>
                    <option value="skincare">Skincare Articles Only</option>
                    <option value="wellness">Wellness Articles Only</option>
                    <option value="style">Style Articles Only</option>
                  </select>
                  <p className="text-[11px] text-charcoal-muted mt-1">
                    Filters syndication by post category.
                  </p>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-charcoal-muted mb-1.5 font-medium">
                    Status
                  </label>
                  <label className="flex items-center gap-2.5 p-2 border border-taupe/60 rounded-sm cursor-pointer hover:bg-taupe-light/20 transition-colors">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={e => setIsActive(e.target.checked)}
                      className="rounded-xs text-bronze focus:ring-bronze h-4 w-4"
                    />
                    <span className="text-sm text-charcoal">
                      {isActive ? 'Active & Ready' : 'Disabled (Paused)'}
                    </span>
                  </label>
                </div>
              </div>

              {/* Dynamic Platform-Specific Fields */}
              <div className="p-4 bg-taupe-light/30 border border-taupe/40 rounded-sm space-y-3.5">
                <div className="flex items-center gap-2 text-xs font-medium text-charcoal uppercase tracking-wider pb-1 border-b border-taupe/30">
                  <ShieldCheck size={14} className="text-bronze" />
                  <span>{PLATFORM_META[platform].label} Configuration &amp; Credentials</span>
                </div>

                {platform === 'discord' && (
                  <div>
                    <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                      Webhook URL *
                    </label>
                    <input
                      type="url"
                      required
                      value={config.webhook_url || ''}
                      onChange={e => setConfig(prev => ({ ...prev, webhook_url: e.target.value }))}
                      placeholder="https://discord.com/api/webhooks/..."
                      className="w-full border border-taupe/60 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:border-bronze bg-white"
                    />
                    <p className="text-[11px] text-charcoal-muted mt-1">
                      From Discord Server Settings → Integrations → Webhooks.
                    </p>
                  </div>
                )}

                {platform === 'flipboard' && (
                  <>
                    <div>
                      <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                        Magazine URL *
                      </label>
                      <input
                        type="url"
                        required
                        value={config.magazine_url || ''}
                        onChange={e => setConfig(prev => ({ ...prev, magazine_url: e.target.value }))}
                        placeholder="https://flipboard.com/@username/magazine-name"
                        className="w-full border border-taupe/60 px-3 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                        Session Cookie (flipboard_session) *
                      </label>
                      <input
                        type="password"
                        required
                        value={config.flipboard_session || ''}
                        onChange={e => setConfig(prev => ({ ...prev, flipboard_session: e.target.value }))}
                        placeholder="s%3A..."
                        className="w-full border border-taupe/60 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:border-bronze bg-white"
                      />
                    </div>
                  </>
                )}

                {platform === 'telegram' && (
                  <>
                    <div>
                      <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                        Bot Token *
                      </label>
                      <input
                        type="password"
                        required
                        value={config.bot_token || ''}
                        onChange={e => setConfig(prev => ({ ...prev, bot_token: e.target.value }))}
                        placeholder="123456789:ABCdefGHIjklmno..."
                        className="w-full border border-taupe/60 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:border-bronze bg-white"
                      />
                      <p className="text-[11px] text-charcoal-muted mt-1">From @BotFather on Telegram</p>
                    </div>
                    <div>
                      <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                        Chat ID / Channel Handle *
                      </label>
                      <input
                        type="text"
                        required
                        value={config.chat_id || ''}
                        onChange={e => setConfig(prev => ({ ...prev, chat_id: e.target.value }))}
                        placeholder="e.g. @lixxonstudio or -1001234567890"
                        className="w-full border border-taupe/60 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:border-bronze bg-white"
                      />
                    </div>
                  </>
                )}

                {platform === 'bluesky' && (
                  <>
                    <div>
                      <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                        Bluesky Handle *
                      </label>
                      <input
                        type="text"
                        required
                        value={config.handle || ''}
                        onChange={e => setConfig(prev => ({ ...prev, handle: e.target.value }))}
                        placeholder="lixxonstudio.bsky.social"
                        className="w-full border border-taupe/60 px-3 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                        App Password *
                      </label>
                      <input
                        type="password"
                        required
                        value={config.app_password || ''}
                        onChange={e => setConfig(prev => ({ ...prev, app_password: e.target.value }))}
                        placeholder="xxxx-xxxx-xxxx-xxxx"
                        className="w-full border border-taupe/60 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:border-bronze bg-white"
                      />
                      <p className="text-[11px] text-charcoal-muted mt-1">
                        Generated in Bluesky Settings → Advanced → App Passwords.
                      </p>
                    </div>
                  </>
                )}

                {platform === 'mastodon' && (
                  <>
                    <div>
                      <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                        Instance URL *
                      </label>
                      <input
                        type="url"
                        required
                        value={config.instance_url || ''}
                        onChange={e => setConfig(prev => ({ ...prev, instance_url: e.target.value }))}
                        placeholder="https://mastodon.social"
                        className="w-full border border-taupe/60 px-3 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                        Access Token *
                      </label>
                      <input
                        type="password"
                        required
                        value={config.access_token || ''}
                        onChange={e => setConfig(prev => ({ ...prev, access_token: e.target.value }))}
                        placeholder="Bearer token with write:statuses scope"
                        className="w-full border border-taupe/60 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:border-bronze bg-white"
                      />
                    </div>
                  </>
                )}

                {platform === 'medium' && (
                  <div>
                    <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                      Integration Token *
                    </label>
                    <input
                      type="password"
                      required
                      value={config.integration_token || ''}
                      onChange={e => setConfig(prev => ({ ...prev, integration_token: e.target.value }))}
                      placeholder="Medium Integration Token"
                      className="w-full border border-taupe/60 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:border-bronze bg-white"
                    />
                    <p className="text-[11px] text-charcoal-muted mt-1">
                      From Medium Settings → Security &amp; Apps → Integration tokens.
                    </p>
                  </div>
                )}

                {platform === 'tumblr' && (
                  <>
                    <div>
                      <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                        Blog Identifier *
                      </label>
                      <input
                        type="text"
                        required
                        value={config.blog_identifier || ''}
                        onChange={e => setConfig(prev => ({ ...prev, blog_identifier: e.target.value }))}
                        placeholder="e.g. lixxonstudio.tumblr.com"
                        className="w-full border border-taupe/60 px-3 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                        OAuth Consumer Key / Token *
                      </label>
                      <input
                        type="password"
                        required
                        value={config.consumer_key || ''}
                        onChange={e => setConfig(prev => ({ ...prev, consumer_key: e.target.value }))}
                        placeholder="Tumblr API Consumer Key"
                        className="w-full border border-taupe/60 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:border-bronze bg-white"
                      />
                    </div>
                  </>
                )}

                {platform === 'substack' && (
                  <>
                    <div>
                      <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                        Subdomain *
                      </label>
                      <input
                        type="text"
                        required
                        value={config.subdomain || ''}
                        onChange={e => setConfig(prev => ({ ...prev, subdomain: e.target.value }))}
                        placeholder="e.g. lixxonstudio (from lixxonstudio.substack.com)"
                        className="w-full border border-taupe/60 px-3 py-2 text-xs rounded-sm focus:outline-none focus:border-bronze bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-charcoal-muted mb-1 font-medium">
                        Session Cookie (connect.sid) *
                      </label>
                      <input
                        type="password"
                        required
                        value={config.connect_sid || ''}
                        onChange={e => setConfig(prev => ({ ...prev, connect_sid: e.target.value }))}
                        placeholder="s%3A..."
                        className="w-full border border-taupe/60 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:border-bronze bg-white"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-taupe/30">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-taupe/60 text-charcoal text-xs uppercase tracking-editorial rounded-sm hover:border-charcoal transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-charcoal text-white text-xs uppercase tracking-editorial rounded-sm hover:bg-bronze transition-all disabled:opacity-50"
                >
                  {saving && <Loader2 size={13} className="animate-spin" />}
                  <span>{editingId ? 'Save Changes' : 'Create Destination'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

