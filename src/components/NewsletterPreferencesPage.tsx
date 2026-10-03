import { useEffect, useState } from 'react';
import { Check, Loader2, Mail, Bell } from 'lucide-react';
import { useNewsletterPreferences } from '../hooks/useFeatures';
import { useCategories } from '../hooks/useSupabase';
import { Helmet } from 'react-helmet-async';

export default function NewsletterPreferencesPage() {
  const { categories } = useCategories();
  const [email, setEmail] = useState('');
  const [emailEntered, setEmailEntered] = useState(false);
  const { preferences, loading, saved, load, save } = useNewsletterPreferences(emailEntered ? email : null);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');

  useEffect(() => { window.scrollTo(0, 0); }, []);

  useEffect(() => {
    if (emailEntered && email) load();
  }, [emailEntered, email, load]);

  useEffect(() => {
    if (preferences) {
      setSelectedCats(preferences.preferred_categories || []);
      setFrequency(preferences.frequency || 'daily');
    }
  }, [preferences]);

  const toggleCategory = (slug: string) => {
    setSelectedCats(prev => prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    save({ preferred_categories: selectedCats, frequency });
  };

  return (
    <main className="container-narrow py-12 md:py-20">
      <Helmet>
        <title>Newsletter Preferences | Lixxon Studio</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 mb-4">
          <Bell size={16} strokeWidth={1.5} className="text-bronze" />
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze">Newsletter</p>
        </div>
        <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light">Email Preferences</h1>
        <p className="text-charcoal-muted text-base mt-4 max-w-md mx-auto leading-relaxed">
          Choose what topics you care about and how often you hear from us.
        </p>
      </div>

      {!emailEntered ? (
        <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) setEmailEntered(true); }} className="max-w-md mx-auto">
          <div className="flex items-center gap-3 p-5 bg-taupe-light/40 rounded-sm border border-taupe/30">
            <Mail size={18} className="text-bronze flex-shrink-0" />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="flex-1 bg-transparent border-b border-taupe px-2 py-2 text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors min-w-0"
            />
          </div>
          <button
            type="submit"
            className="w-full mt-4 px-6 py-3 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all"
          >
            Manage Preferences
          </button>
        </form>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-bronze" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="max-w-lg mx-auto space-y-8">
          {/* Frequency */}
          <div>
            <p className="text-xs tracking-editorial uppercase text-charcoal-muted mb-4">Delivery Frequency</p>
            <div className="grid grid-cols-2 gap-3">
              {(['daily', 'weekly'] as const).map(freq => (
                <button
                  key={freq}
                  type="button"
                  onClick={() => setFrequency(freq)}
                  className={`px-6 py-4 border rounded-sm transition-all text-left ${frequency === freq ? 'border-bronze bg-bronze/10' : 'border-taupe hover:border-bronze/50'}`}
                >
                  <p className="font-serif text-lg text-charcoal capitalize">{freq}</p>
                  <p className="text-xs text-charcoal-muted mt-1">{freq === 'daily' ? 'Every morning' : 'Every Sunday'}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Categories */}
          <div>
            <p className="text-xs tracking-editorial uppercase text-charcoal-muted mb-4">Topics You Care About</p>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button
                  key={cat.slug}
                  type="button"
                  onClick={() => toggleCategory(cat.slug)}
                  className={`px-4 py-2.5 rounded-full text-sm transition-all ${selectedCats.includes(cat.slug) ? 'bg-bronze text-white' : 'bg-taupe-light text-charcoal-muted hover:bg-taupe'}`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
            <p className="text-xs text-charcoal-muted mt-3">
              {selectedCats.length === 0 ? 'Select topics to personalize your digest, or leave empty to get everything.' : `${selectedCats.length} topic${selectedCats.length === 1 ? '' : 's'} selected`}
            </p>
          </div>

          {/* Save */}
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-8 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-60"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
              {saved ? 'Saved' : 'Save Preferences'}
            </button>
            {saved && <p className="text-sm text-green-600">Your preferences have been updated.</p>}
          </div>
        </form>
      )}
    </main>
  );
}
