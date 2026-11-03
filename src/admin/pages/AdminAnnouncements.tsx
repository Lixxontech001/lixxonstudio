import { useState, useEffect, useCallback } from 'react';
import {
  Bell, Plus, Edit2, Trash2, X, Sparkles, Smartphone,
  Monitor, RefreshCw, Eye, EyeOff, ArrowRight
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import AdminImageUploadField from '../components/AdminImageUploadField';
import type { Announcement, AnnouncementFormType, AnnouncementTargetAudience } from '../../types/announcements';

export default function AdminAnnouncements() {
  const [campaigns, setCampaigns] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCampaign, setEditingCampaign] = useState<Partial<Announcement> | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCampaigns((data || []) as Announcement[]);
    } catch (err) {
      console.error('[AdminAnnouncements] load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const handleOpenNew = () => {
    setEditingCampaign({
      title: '',
      description: '',
      badge_text: 'EXCLUSIVE ANNOUNCEMENT',
      form_type: 'modal',
      image_url: '',
      button1_label: 'Explore Now',
      button1_url: '/collections',
      button2_label: 'Learn More',
      button2_url: '/about',
      trigger_delay_seconds: 5,
      scroll_percentage: 20,
      cooldown_minutes: 3,
      target_audience: 'all_pages',
      is_active: true,
      priority: campaigns.length > 0 ? (campaigns[0].priority || 0) + 1 : 1,
    });
  };

  const handleEdit = (c: Announcement) => {
    setEditingCampaign({ ...c });
  };

  const handleToggleActive = async (c: Announcement) => {
    const next = !c.is_active;
    try {
      await supabase.from('announcements').update({ is_active: next }).eq('id', c.id);
      showNotification(next ? 'Campaign enabled' : 'Campaign paused');
      loadCampaigns();
    } catch {
      showNotification('Action failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this announcement campaign?')) return;
    try {
      await supabase.from('announcements').delete().eq('id', id);
      showNotification('Campaign deleted');
      loadCampaigns();
    } catch {
      showNotification('Delete failed');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCampaign || !editingCampaign.title?.trim()) return;

    setSaving(true);
    try {
      const payload = {
        title: editingCampaign.title.trim(),
        description: editingCampaign.description?.trim() || '',
        badge_text: editingCampaign.badge_text?.trim() || 'ANNOUNCEMENT',
        form_type: (editingCampaign.form_type as AnnouncementFormType) || 'modal',
        image_url: editingCampaign.image_url || '',
        button1_label: editingCampaign.button1_label?.trim() || '',
        button1_url: editingCampaign.button1_url?.trim() || '',
        button2_label: editingCampaign.button2_label?.trim() || '',
        button2_url: editingCampaign.button2_url?.trim() || '',
        trigger_delay_seconds: Number(editingCampaign.trigger_delay_seconds) || 5,
        scroll_percentage: Number(editingCampaign.scroll_percentage) || 0,
        cooldown_minutes: Number(editingCampaign.cooldown_minutes) || 3,
        target_audience: (editingCampaign.target_audience as AnnouncementTargetAudience) || 'all_pages',
        is_active: Boolean(editingCampaign.is_active),
        priority: Number(editingCampaign.priority) || 0,
        updated_at: new Date().toISOString(),
      };

      if (editingCampaign.id) {
        const { error } = await supabase.from('announcements').update(payload).eq('id', editingCampaign.id);
        if (error) throw error;
        showNotification('Campaign updated');
      } else {
        const { error } = await supabase.from('announcements').insert(payload);
        if (error) throw error;
        showNotification('Campaign created');
      }

      setEditingCampaign(null);
      loadCampaigns();
    } catch (err: unknown) {
      console.error('[AdminAnnouncements] save error:', err);
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white px-4 py-2.5 rounded-sm shadow-lg text-xs tracking-wide">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2">
            <Bell size={22} className="text-bronze" />
            <h1 className="font-serif text-2xl sm:text-3xl text-charcoal">Announcement &amp; Retention Hub</h1>
          </div>
          <p className="text-sm text-charcoal-muted mt-1">
            Build, test, and orchestrate dual-modality modals and ambient toasts with behavioral trigger rules.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadCampaigns}
            className="p-2 border border-gray-300 rounded-sm hover:bg-gray-50 text-gray-600 transition-colors"
            title="Refresh"
            aria-label="Refresh campaigns"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={handleOpenNew}
            className="inline-flex items-center gap-2 px-4 py-2 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-colors shadow-sm"
          >
            <Plus size={15} />
            <span>New Campaign</span>
          </button>
        </div>
      </div>

      {/* Campaigns Table */}
      <div className="bg-white rounded-sm border border-gray-200 overflow-hidden shadow-sm mb-10">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading campaigns...</div>
        ) : campaigns.length === 0 ? (
          <div className="py-20 text-center text-sm text-gray-500">
            No announcement campaigns created yet. Click "New Campaign" to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-editorial">
                  <th className="py-3 px-4">Campaign</th>
                  <th className="py-3 px-3">Modality</th>
                  <th className="py-3 px-3">Triggers</th>
                  <th className="py-3 px-3">Target Audience</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campaigns.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50/80 transition-colors">
                    {/* Title */}
                    <td className="py-3 px-4 max-w-sm">
                      <div className="font-medium text-gray-900 text-sm">{c.title}</div>
                      <div className="text-gray-500 text-[11px] truncate mt-0.5">{c.description}</div>
                    </td>

                    {/* Modality */}
                    <td className="py-3 px-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-editorial ${
                          c.form_type === 'modal'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {c.form_type === 'modal' ? 'Focus Modal' : 'Bottom Toast'}
                      </span>
                    </td>

                    {/* Trigger Rules */}
                    <td className="py-3 px-3">
                      <div className="space-y-0.5 text-gray-600 text-[11px]">
                        <div>Delay: <strong>{c.trigger_delay_seconds}s</strong></div>
                        <div>Scroll: <strong>{c.scroll_percentage}%</strong></div>
                        <div>Cooldown: <strong>{c.cooldown_minutes}m</strong></div>
                      </div>
                    </td>

                    {/* Audience */}
                    <td className="py-3 px-3">
                      <span className="text-gray-700 capitalize font-medium">{c.target_audience.replace('_', ' ')}</span>
                    </td>

                    {/* Active toggle */}
                    <td className="py-3 px-3">
                      <button
                        onClick={() => handleToggleActive(c)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-editorial font-medium ${
                          c.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {c.is_active ? <Eye size={12} /> : <EyeOff size={12} />}
                        <span>{c.is_active ? 'Active' : 'Paused'}</span>
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(c)}
                          className="p-1.5 text-gray-500 hover:text-bronze transition-colors"
                          title="Edit campaign"
                          aria-label={`Edit ${c.title}`}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                          title="Delete campaign"
                          aria-label={`Delete ${c.title}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Campaign Form Builder & Live Interactive Preview Modal */}
      {editingCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-sm border border-gray-200 shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col my-6">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <h2 className="font-serif text-lg text-gray-900">
                {editingCampaign.id ? 'Edit Announcement Campaign' : 'Create Announcement Campaign'}
              </h2>
              <button
                onClick={() => setEditingCampaign(null)}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid lg:grid-cols-2 flex-1 overflow-hidden">
              {/* Form Side */}
              <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-4 text-xs text-gray-700 border-r border-gray-200">
                {/* Modality & Status */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                      Display Modality *
                    </label>
                    <select
                      value={editingCampaign.form_type || 'modal'}
                      onChange={e =>
                        setEditingCampaign({
                          ...editingCampaign,
                          form_type: e.target.value as AnnouncementFormType,
                        })
                      }
                      className="w-full border border-gray-300 p-2.5 rounded-sm focus:border-bronze focus:outline-none text-sm"
                    >
                      <option value="modal">Form 1: Immersive Focus Modal</option>
                      <option value="toast">Form 2: Floating Ambient Toast / Card</option>
                    </select>
                  </div>
                  <div>
                    <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                      Badge Text
                    </label>
                    <input
                      type="text"
                      value={editingCampaign.badge_text || ''}
                      onChange={e => setEditingCampaign({ ...editingCampaign, badge_text: e.target.value })}
                      className="w-full border border-gray-300 p-2.5 rounded-sm text-sm"
                      placeholder="e.g. CURATED EDITORIAL"
                    />
                  </div>
                </div>

                {/* Title */}
                <div>
                  <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                    Headline / Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingCampaign.title || ''}
                    onChange={e => setEditingCampaign({ ...editingCampaign, title: e.target.value })}
                    className="w-full border border-gray-300 p-2.5 rounded-sm text-sm"
                    placeholder="e.g. Discover The Spring Capsule & Protocols"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block uppercase tracking-editorial font-medium text-gray-600 mb-1">
                    Message / Description
                  </label>
                  <textarea
                    rows={3}
                    value={editingCampaign.description || ''}
                    onChange={e => setEditingCampaign({ ...editingCampaign, description: e.target.value })}
                    className="w-full border border-gray-300 p-2.5 rounded-sm text-sm"
                    placeholder="Detailed invitation, value proposition, or announcement message..."
                  />
                </div>

                {/* Image Upload */}
                <AdminImageUploadField
                  label="Hero Banner Image (Modal Only)"
                  value={editingCampaign.image_url || ''}
                  onChange={url => setEditingCampaign({ ...editingCampaign, image_url: url })}
                  folder="general"
                  hint="Upload visual for top modal header"
                />

                {/* Button 1 */}
                <div className="grid sm:grid-cols-2 gap-3 p-3 bg-gray-50 border border-gray-200 rounded-sm">
                  <div>
                    <label className="block text-gray-600 font-medium mb-1">Button 1 Label</label>
                    <input
                      type="text"
                      value={editingCampaign.button1_label || ''}
                      onChange={e => setEditingCampaign({ ...editingCampaign, button1_label: e.target.value })}
                      className="w-full border border-gray-300 p-2 rounded-sm"
                      placeholder="e.g. Explore Now"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-600 font-medium mb-1">Button 1 Target URL</label>
                    <input
                      type="text"
                      value={editingCampaign.button1_url || ''}
                      onChange={e => setEditingCampaign({ ...editingCampaign, button1_url: e.target.value })}
                      className="w-full border border-gray-300 p-2 rounded-sm"
                      placeholder="e.g. /collections or https://..."
                    />
                  </div>
                </div>

                {/* Button 2 (Modal only) */}
                {editingCampaign.form_type === 'modal' && (
                  <div className="grid sm:grid-cols-2 gap-3 p-3 bg-gray-50 border border-gray-200 rounded-sm">
                    <div>
                      <label className="block text-gray-600 font-medium mb-1">Button 2 Label (Ghost)</label>
                      <input
                        type="text"
                        value={editingCampaign.button2_label || ''}
                        onChange={e => setEditingCampaign({ ...editingCampaign, button2_label: e.target.value })}
                        className="w-full border border-gray-300 p-2 rounded-sm"
                        placeholder="e.g. Learn More"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 font-medium mb-1">Button 2 Target URL</label>
                      <input
                        type="text"
                        value={editingCampaign.button2_url || ''}
                        onChange={e => setEditingCampaign({ ...editingCampaign, button2_url: e.target.value })}
                        className="w-full border border-gray-300 p-2 rounded-sm"
                        placeholder="e.g. /trending"
                      />
                    </div>
                  </div>
                )}

                {/* Behavioral Trigger Controls */}
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-sm space-y-3">
                  <h4 className="font-semibold text-gray-800 uppercase tracking-editorial text-[10px]">
                    Behavioral Trigger Rules
                  </h4>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-gray-600 mb-1">Entrance Delay (sec)</label>
                      <input
                        type="number"
                        min={0}
                        value={editingCampaign.trigger_delay_seconds || 5}
                        onChange={e =>
                          setEditingCampaign({
                            ...editingCampaign,
                            trigger_delay_seconds: Number(e.target.value),
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1">Scroll Depth (%)</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={editingCampaign.scroll_percentage || 0}
                        onChange={e =>
                          setEditingCampaign({
                            ...editingCampaign,
                            scroll_percentage: Number(e.target.value),
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1">Cooldown (mins)</label>
                      <input
                        type="number"
                        min={1}
                        value={editingCampaign.cooldown_minutes || 3}
                        onChange={e =>
                          setEditingCampaign({
                            ...editingCampaign,
                            cooldown_minutes: Number(e.target.value),
                          })
                        }
                        className="w-full border border-gray-300 p-2 rounded-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-gray-600 mb-1">Target Route / Audience</label>
                    <select
                      value={editingCampaign.target_audience || 'all_pages'}
                      onChange={e =>
                        setEditingCampaign({
                          ...editingCampaign,
                          target_audience: e.target.value as AnnouncementTargetAudience,
                        })
                      }
                      className="w-full border border-gray-300 p-2 rounded-sm"
                    >
                      <option value="all_pages">All Pages (Universal Trigger)</option>
                      <option value="articles_only">Articles &amp; Editorial Posts Only</option>
                      <option value="new_visitors">New Visitors Only</option>
                    </select>
                  </div>
                </div>

                {/* Priority & Active */}
                <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingCampaign.is_active)}
                      onChange={e =>
                        setEditingCampaign({ ...editingCampaign, is_active: e.target.checked })
                      }
                      className="rounded text-bronze focus:ring-bronze"
                    />
                    <span className="font-medium text-gray-800">Campaign Active</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <span className="text-gray-600">Priority:</span>
                    <input
                      type="number"
                      value={editingCampaign.priority || 0}
                      onChange={e =>
                        setEditingCampaign({ ...editingCampaign, priority: Number(e.target.value) })
                      }
                      className="w-20 border border-gray-300 p-1.5 rounded-sm"
                    />
                  </div>
                </div>

                {/* Submit Actions */}
                <div className="pt-4 border-t border-gray-200 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingCampaign(null)}
                    className="px-4 py-2 border border-gray-300 text-gray-600 rounded-sm hover:bg-gray-50 uppercase tracking-editorial text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 bg-bronze text-white rounded-sm hover:bg-bronze-dark uppercase tracking-editorial text-xs font-medium transition-colors shadow-sm disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : editingCampaign.id ? 'Save Changes' : 'Launch Campaign'}
                  </button>
                </div>
              </form>

              {/* Live Interactive In-Admin Preview Side */}
              <div className="bg-[#FAF8F5] p-6 flex flex-col justify-between overflow-y-auto">
                <div className="mb-4 flex items-center justify-between border-b border-gray-200 pb-3">
                  <span className="text-[11px] uppercase tracking-editorial font-bold text-gray-700">
                    Live Interactive Preview
                  </span>
                  <div className="flex items-center gap-1 bg-white border border-gray-200 p-0.5 rounded">
                    <button
                      type="button"
                      onClick={() => setPreviewViewport('desktop')}
                      className={`p-1.5 rounded text-xs transition-colors ${
                        previewViewport === 'desktop' ? 'bg-charcoal text-white' : 'text-gray-500 hover:text-gray-900'
                      }`}
                      title="Desktop viewport"
                    >
                      <Monitor size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewViewport('mobile')}
                      className={`p-1.5 rounded text-xs transition-colors ${
                        previewViewport === 'mobile' ? 'bg-charcoal text-white' : 'text-gray-500 hover:text-gray-900'
                      }`}
                      title="Mobile viewport"
                    >
                      <Smartphone size={14} />
                    </button>
                  </div>
                </div>

                {/* Preview Frame */}
                <div className="flex-1 flex items-center justify-center p-2">
                  <div
                    className={`transition-all duration-300 w-full ${
                      previewViewport === 'mobile' ? 'max-w-[320px]' : 'max-w-[420px]'
                    }`}
                  >
                    {editingCampaign.form_type === 'modal' ? (
                      <div className="bg-white rounded-sm border border-gray-200 shadow-xl overflow-hidden relative">
                        {editingCampaign.image_url && (
                          <div className="h-32 w-full overflow-hidden bg-gray-100">
                            <img
                              src={editingCampaign.image_url}
                              alt="preview"
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        <div className="p-5">
                          <div className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-bronze/10 text-bronze rounded-full text-[9px] font-semibold tracking-editorial uppercase mb-2">
                            <Sparkles size={11} />
                            <span>{editingCampaign.badge_text || 'EDITORIAL'}</span>
                          </div>
                          <h3 className="font-serif text-lg text-gray-900 font-medium mb-2 leading-snug">
                            {editingCampaign.title || 'Announcement Title'}
                          </h3>
                          <p className="text-xs text-gray-600 mb-4 leading-relaxed">
                            {editingCampaign.description || 'Description message will render here in real time.'}
                          </p>
                          <div className="space-y-2">
                            {editingCampaign.button1_label && (
                              <button
                                type="button"
                                className="w-full py-2 bg-bronze text-white text-[11px] uppercase tracking-editorial font-medium rounded-sm"
                              >
                                {editingCampaign.button1_label}
                              </button>
                            )}
                            {editingCampaign.button2_label && (
                              <button
                                type="button"
                                className="w-full py-2 border border-gray-300 text-gray-700 text-[11px] uppercase tracking-editorial font-medium rounded-sm"
                              >
                                {editingCampaign.button2_label}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white border border-gray-200 rounded-sm shadow-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] uppercase tracking-editorial font-bold text-bronze bg-bronze/10 px-2 py-0.5 rounded-full">
                            {editingCampaign.badge_text || 'NOTICE'}
                          </span>
                          <X size={13} className="text-gray-400" />
                        </div>
                        <h4 className="font-serif text-sm font-medium text-gray-900 mb-1">
                          {editingCampaign.title || 'Toast Title'}
                        </h4>
                        <p className="text-xs text-gray-600 mb-3 line-clamp-2">
                          {editingCampaign.description || 'Concise message text.'}
                        </p>
                        {editingCampaign.button1_label && (
                          <button
                            type="button"
                            className="w-full py-1.5 bg-charcoal text-white text-[10px] uppercase tracking-editorial font-medium rounded-sm flex items-center justify-center gap-1"
                          >
                            <span>{editingCampaign.button1_label}</span>
                            <ArrowRight size={11} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-[11px] text-gray-500 text-center mt-4">
                  Changes to content and triggers update this preview instantly.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
