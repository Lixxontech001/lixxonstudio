import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Panel, Notice } from '../components/ui';
import type { SalonHouseProtocol, InciReport } from '../../types/salon';
import { analyzeInciList } from '../../lib/salonEngine';
import {
  Trophy, Sparkles, Beaker, Plus, Trash2,
  CheckCircle2, RefreshCw
} from 'lucide-react';

export default function AdminSalon() {
  const [protocols, setProtocols] = useState<SalonHouseProtocol[]>([]);
  const [regimensCount, setRegimensCount] = useState<number>(0);
  const [vanityCount, setVanityCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  // Reader Point Grant State
  const [readerFingerprint, setReaderFingerprint] = useState('');
  const [pointsToGrant, setPointsToGrant] = useState(250);
  const [grantSuccess, setGrantSuccess] = useState(false);

  // New Protocol Form Modal
  const [showProtocolModal, setShowProtocolModal] = useState(false);
  const [protoTitle, setProtoTitle] = useState('');
  const [protoSlug, setProtoSlug] = useState('');
  const [protoTagline, setProtoTagline] = useState('');
  const [protoSkinType, setProtoSkinType] = useState('combination');
  const [protoDifficulty, setProtoDifficulty] = useState<'novice' | 'intermediate' | 'advanced' | 'master'>('intermediate');
  const [protoCadence, setProtoCadence] = useState('Skin Cycling: Exfoliation / Retinoid / Recovery / Recovery');
  const [protoCurator, setProtoCurator] = useState('Lixxon Formulation Board');

  // INCI Quick Tester state
  const [testInci, setTestInci] = useState('');
  const [testResult, setTestResult] = useState<InciReport | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch House Protocols
      const { data: houseData } = await supabase
        .from('salon_house_protocols')
        .select('*')
        .order('created_at', { ascending: false });

      if (houseData) setProtocols(houseData as unknown as SalonHouseProtocol[]);

      // 2. Counts
      const { count: regCount } = await supabase
        .from('reader_regimens')
        .select('*', { count: 'exact', head: true });
      if (typeof regCount === 'number') setRegimensCount(regCount);

      const { count: vanCount } = await supabase
        .from('reader_vanity_items')
        .select('*', { count: 'exact', head: true });
      if (typeof vanCount === 'number') setVanityCount(vanCount);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleGrantPoints = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!readerFingerprint.trim()) return;

    try {
      await supabase
        .from('reader_achievements')
        .insert({
          fingerprint: readerFingerprint.trim(),
          badge_key: 'admin_vip_grant',
          badge_name: 'VIP Salon Gift',
          points_awarded: pointsToGrant,
        });

      setGrantSuccess(true);
      setTimeout(() => setGrantSuccess(false), 3000);
      setReaderFingerprint('');
    } catch {
      setNotice('Could not grant points.');
    }
  };

  const handleCreateProtocol = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!protoTitle.trim()) return;

    const slug = protoSlug.trim() || protoTitle.toLowerCase().replace(/[^a-z0-9]/g, '-');
    try {
      const { error } = await supabase
        .from('salon_house_protocols')
        .insert({
          title: protoTitle.trim(),
          slug,
          tagline: protoTagline.trim(),
          skin_type: protoSkinType,
          difficulty: protoDifficulty,
          weekly_cadence: protoCadence,
          curator_name: protoCurator,
          morning_steps: [
            { step: 1, phase: 'AM', type: 'Cleanse', name: 'Gentle Amino Acid Wash', ph: '5.5', wait: 0 },
            { step: 2, phase: 'AM', type: 'Active', name: 'Antioxidant Multi-Shield', ph: '5.2', wait: 3 },
            { step: 3, phase: 'AM', type: 'SPF', name: 'Broad Spectrum Fluid SPF 50', ph: '6.5', wait: 0 },
          ],
          evening_steps: [
            { step: 1, phase: 'PM', type: 'Cleanse', name: 'Melting Oil Balm', ph: '6.0', wait: 0 },
            { step: 2, phase: 'PM', type: 'Renewal', name: 'Cellular Turnover Active', ph: '5.8', wait: 10 },
            { step: 3, phase: 'PM', type: 'Barrier', name: 'Phytoceramide Comfort Balm', ph: '5.5', wait: 0 },
          ],
        });

      if (error) throw error;
      setNotice('House Protocol published successfully.');
      setShowProtocolModal(false);
      setProtoTitle('');
      setProtoSlug('');
      setProtoTagline('');
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error creating protocol.';
      setNotice(msg);
    }
  };

  const handleDeleteProtocol = async (id: string) => {
    if (!confirm('Are you sure you want to delete this studio house protocol?')) return;
    await supabase.from('salon_house_protocols').delete().eq('id', id);
    loadData();
  };

  const handleRunInciTest = () => {
    if (!testInci.trim()) return;
    const res = analyzeInciList(testInci, 'Admin Test Formula');
    setTestResult(res);
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-taupe/30 pb-5">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-bronze/10 text-bronze text-xs tracking-editorial uppercase font-medium rounded-full mb-2">
            <Trophy size={13} />
            <span>Salon Intelligence & Privileges Command</span>
          </div>
          <h1 className="font-serif text-3xl text-charcoal">Salon & Reader Privilege Suite</h1>
          <p className="text-sm text-charcoal-light mt-1">
            Manage clinical house protocols, monitor reader regimen generations, and grant VIP privilege points.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            className="p-2 border border-taupe/40 text-charcoal rounded-sm hover:border-bronze"
            title="Refresh statistics"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => setShowProtocolModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-bronze text-white text-xs uppercase tracking-editorial font-medium rounded-sm hover:bg-bronze-dark transition-colors"
          >
            <Plus size={14} /> New House Protocol
          </button>
        </div>
      </div>

      {notice && <Notice tone="info">{notice}</Notice>}

      {/* KPI Overview Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-taupe/30 p-5 rounded-sm">
          <span className="text-[10px] tracking-editorial uppercase font-semibold text-charcoal-muted block">
            Published House Protocols
          </span>
          <span className="font-serif text-3xl text-charcoal mt-1 block">{protocols.length}</span>
          <span className="text-xs text-bronze mt-1 block">Live for all readers</span>
        </div>

        <div className="bg-white border border-taupe/30 p-5 rounded-sm">
          <span className="text-[10px] tracking-editorial uppercase font-semibold text-charcoal-muted block">
            Regimens Architected
          </span>
          <span className="font-serif text-3xl text-charcoal mt-1 block">{regimensCount}</span>
          <span className="text-xs text-green-700 mt-1 block">Custom synthesized</span>
        </div>

        <div className="bg-white border border-taupe/30 p-5 rounded-sm">
          <span className="text-[10px] tracking-editorial uppercase font-semibold text-charcoal-muted block">
            Vanity Bottles Monitored
          </span>
          <span className="font-serif text-3xl text-charcoal mt-1 block">{vanityCount}</span>
          <span className="text-xs text-charcoal-muted mt-1 block">PAO tracked</span>
        </div>

        <div className="bg-white border border-taupe/30 p-5 rounded-sm">
          <span className="text-[10px] tracking-editorial uppercase font-semibold text-charcoal-muted block">
            Privilege Tier Ladder
          </span>
          <span className="font-serif text-3xl text-bronze mt-1 block">4 Tiers</span>
          <span className="text-xs text-charcoal-muted mt-1 block">Bronze · Silver · Gold · Plat</span>
        </div>
      </div>

      {/* House Protocols Management Table */}
      <Panel title="Official Studio House Protocols" icon={<Sparkles size={16} className="text-bronze" />}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-taupe/20 text-charcoal-muted uppercase tracking-editorial font-semibold">
                <th className="py-3 px-4">Title & Slug</th>
                <th className="py-3 px-4">Skin Typology</th>
                <th className="py-3 px-4">Difficulty</th>
                <th className="py-3 px-4">Curator</th>
                <th className="py-3 px-4">Clones</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-taupe/20">
              {protocols.map(p => (
                <tr key={p.id} className="hover:bg-warm-ivory/20 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="font-medium text-charcoal text-sm">{p.title}</div>
                    <div className="text-charcoal-muted font-mono text-[10px]">{p.slug}</div>
                  </td>
                  <td className="py-3.5 px-4 font-medium uppercase text-charcoal">{p.skin_type}</td>
                  <td className="py-3.5 px-4">
                    <span className="px-2 py-0.5 bg-bronze/10 text-bronze rounded-sm font-semibold uppercase text-[10px]">
                      {p.difficulty}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-charcoal-light">{p.curator_name}</td>
                  <td className="py-3.5 px-4 font-mono font-medium">{p.cloned_count}</td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleDeleteProtocol(p.id)}
                      className="p-1.5 text-charcoal-muted hover:text-red-700 transition-colors"
                      title="Delete protocol"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Reader Points & VIP Overrides */}
      <div className="grid md:grid-cols-2 gap-6">
        <Panel title="Grant VIP Privilege Points" icon={<Trophy size={16} className="text-bronze" />}>
          <form onSubmit={handleGrantPoints} className="space-y-4">
            <p className="text-xs text-charcoal-muted">
              Manually boost an active reader's reputation points to fast-track their tier (e.g. unlock The Secret Vault or Bespoke Briefings).
            </p>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-editorial text-charcoal mb-1">
                Reader Fingerprint or User ID *
              </label>
              <input
                type="text"
                required
                value={readerFingerprint}
                onChange={e => setReaderFingerprint(e.target.value)}
                placeholder="e.g. fp-1a2b3c4d or user-uuid"
                className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-editorial text-charcoal mb-1">
                Points to Grant
              </label>
              <select
                value={pointsToGrant}
                onChange={e => setPointsToGrant(Number(e.target.value))}
                className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
              >
                <option value={100}>+100 Points (Bronze Level)</option>
                <option value={250}>+250 Points (Fast-Track to Silver Scholar & Vault)</option>
                <option value={500}>+500 Points (Fast-Track to Gold Connoisseur)</option>
                <option value={1000}>+1000 Points (Direct Platinum Luminary)</option>
              </select>
            </div>

            <div className="pt-1 flex items-center justify-between">
              {grantSuccess && (
                <span className="text-xs text-green-700 flex items-center gap-1">
                  <CheckCircle2 size={13} /> Points Granted!
                </span>
              )}
              <button
                type="submit"
                className="ml-auto px-5 py-2 bg-charcoal text-white hover:bg-bronze text-xs uppercase tracking-editorial font-medium rounded-sm transition-colors"
              >
                Award Points
              </button>
            </div>
          </form>
        </Panel>

        {/* INCI Teardown Diagnostics */}
        <Panel title="INCI Clinical Scoring Sandbox" icon={<Beaker size={16} className="text-bronze" />}>
          <div className="space-y-3">
            <p className="text-xs text-charcoal-muted">
              Test how the cosmetic chemistry engine evaluates an ingredient deck before recommending it in editorial stories.
            </p>
            <textarea
              rows={3}
              value={testInci}
              onChange={e => setTestInci(e.target.value)}
              placeholder="Paste test INCI list: Aqua, Niacinamide 5%, Squalane, Alcohol Denat..."
              className="w-full p-2.5 border border-taupe/40 rounded-sm text-xs font-mono focus:outline-hidden focus:border-bronze"
            />
            <button
              type="button"
              onClick={handleRunInciTest}
              className="px-4 py-1.5 bg-bronze text-white text-xs uppercase tracking-editorial font-medium rounded-sm hover:bg-bronze-dark transition-colors"
            >
              Run Diagnostic
            </button>

            {testResult && (
              <div className="p-3 bg-warm-ivory/60 border border-taupe/30 rounded-sm space-y-1 text-xs">
                <div className="flex justify-between font-semibold">
                  <span className="text-charcoal">{testResult.verdict}</span>
                  <span className="text-bronze">{testResult.overallScore}/100 Score</span>
                </div>
                <div className="text-charcoal-light">
                  Star Actives: {testResult.starActives.map(a => a.name).join(', ') || 'None'}
                </div>
                {testResult.flaggedConcerns.length > 0 && (
                  <div className="text-red-700">
                    Flagged: {testResult.flaggedConcerns.map(c => c.name).join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Create Protocol Modal */}
      {showProtocolModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white max-w-xl w-full rounded-sm border border-taupe/40 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-taupe/20 pb-3">
              <h3 className="font-serif text-xl text-charcoal">Publish Studio House Protocol</h3>
              <button
                type="button"
                onClick={() => setShowProtocolModal(false)}
                className="text-charcoal-muted hover:text-charcoal p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProtocol} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                  Protocol Title *
                </label>
                <input
                  type="text"
                  required
                  value={protoTitle}
                  onChange={e => setProtoTitle(e.target.value)}
                  placeholder="e.g. The Cellular Copper Peptide Masterclass"
                  className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                  Tagline / Clinical Objective
                </label>
                <input
                  type="text"
                  value={protoTagline}
                  onChange={e => setProtoTagline(e.target.value)}
                  placeholder="Targeted extracellular matrix remodeling with zero dermal redness."
                  className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                    Skin Typology
                  </label>
                  <select
                    value={protoSkinType}
                    onChange={e => setProtoSkinType(e.target.value)}
                    className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                  >
                    <option value="all">All Typologies</option>
                    <option value="sensitive">Sensitive / Reactive</option>
                    <option value="combination">Combination</option>
                    <option value="dry">Dry / Dehydrated</option>
                    <option value="oily">Oily / Congested</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                    Difficulty
                  </label>
                  <select
                    value={protoDifficulty}
                    onChange={e => setProtoDifficulty(e.target.value as 'novice' | 'intermediate' | 'advanced' | 'master')}
                    className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                  >
                    <option value="novice">Novice</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                    <option value="master">Master Formulation</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                  Weekly Cadence Formula
                </label>
                <input
                  type="text"
                  value={protoCadence}
                  onChange={e => setProtoCadence(e.target.value)}
                  placeholder="e.g. Mon/Wed/Fri Active Night | Tue/Thu/Sat Recovery"
                  className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                  Curator / Chemist Attribution
                </label>
                <input
                  type="text"
                  value={protoCurator}
                  onChange={e => setProtoCurator(e.target.value)}
                  placeholder="Dr. H. Vance, Formulation Chemist"
                  className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-taupe/20">
                <button
                  type="button"
                  onClick={() => setShowProtocolModal(false)}
                  className="px-4 py-2 border border-taupe/40 text-xs font-medium rounded-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-bronze text-white text-xs uppercase tracking-editorial font-medium rounded-sm hover:bg-bronze-dark"
                >
                  Publish Protocol
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

