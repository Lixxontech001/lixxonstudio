import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { List, Award } from 'lucide-react';
import { usePublicProfile, BADGES } from '../../hooks/useV3';
import { supabase, rows } from '../../lib/supabaseClient';
import { Link } from '../../context/NavigationContext';
import EmptyState from '../EmptyState';
import { FeedSkeleton } from '../Skeletons';

export default function ReaderProfilePage({ handle }: { handle: string }) {
  const { profile, badges, lists, loading } = usePublicProfile(handle);
  useEffect(() => { window.scrollTo(0, 0); }, [handle]);
  if (loading) return <main className="container-narrow py-16"><FeedSkeleton /></main>;
  if (!profile) return <EmptyState message="This reader profile is private or does not exist." />;
  const initials = (profile.display_name || handle).split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join('');
  return (
    <main className="container-narrow py-16 md:py-24">
      <Helmet><title>{profile.display_name || handle} · Reader | Lixxon Studio</title><meta name="description" content={profile.bio || `${profile.display_name || handle} reads Lixxon Studio.`} /></Helmet>
      <header className="text-center mb-12">
        <div className="w-20 h-20 mx-auto rounded-full bg-charcoal text-cream flex items-center justify-center font-serif text-3xl mb-4" aria-hidden>{initials}</div>
        <h1 className="font-serif text-4xl text-charcoal">{profile.display_name || handle}</h1>
        <p className="text-xs text-charcoal-muted mt-1">@{profile.handle} · reader since {new Date(profile.created_at).getFullYear()}</p>
        {profile.bio && <p className="text-charcoal-light max-w-md mx-auto mt-4">{profile.bio}</p>}
      </header>
      {badges.length > 0 && (
        <section className="mb-12" aria-labelledby="rb-h">
          <h2 id="rb-h" className="flex items-center gap-2 text-[11px] tracking-editorial uppercase text-bronze mb-4"><Award size={14} /> Achievements</h2>
          <ul className="flex flex-wrap gap-2">{badges.map(b => BADGES[b] && <li key={b} title={BADGES[b].description} className="px-3 py-1.5 border border-bronze/40 bg-bronze/5 rounded-full text-xs text-charcoal">{BADGES[b].emoji} {BADGES[b].label}</li>)}</ul>
        </section>
      )}
      <section aria-labelledby="rl-h">
        <h2 id="rl-h" className="flex items-center gap-2 text-[11px] tracking-editorial uppercase text-bronze mb-4"><List size={14} /> Shared reading lists</h2>
        {lists.length === 0 ? <p className="text-sm text-charcoal-muted">No shared lists yet.</p> : (
          <ul className="grid sm:grid-cols-2 gap-4">{lists.map(l => (
            <li key={l.id}><Link to={{ name: 'shared-list', token: l.share_token || '' }} className="block p-5 border border-taupe/40 rounded-sm bg-white/60 hover:border-bronze transition-colors"><p className="font-serif text-xl text-charcoal">{l.name}</p>{l.description && <p className="text-sm text-charcoal-light mt-1 line-clamp-2">{l.description}</p>}<p className="text-[11px] text-charcoal-muted mt-2">{l.items} article{l.items === 1 ? '' : 's'}</p></Link></li>
          ))}</ul>
        )}
      </section>
    </main>
  );
}

export function SharedListPage({ token }: { token: string }) {
  const [list, setList] = useState<{ id: string; name: string; description: string | null } | null>(null);
  const [items, setItems] = useState<{ id: string; post: { id: string; title: string; slug: string; excerpt: string | null; cover_image: string | null; reading_time_minutes: number } | null }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    window.scrollTo(0, 0);
    let on = true;
    (async () => {
      const { data } = await supabase.from('reading_lists').select('id, name, description').eq('share_token', token).eq('is_public', true).maybeSingle();
      if (!on) return;
      setList(data);
      if (data) { const { data: it } = await supabase.from('reading_list_items').select('id, post:posts(id, title, slug, excerpt, cover_image, reading_time_minutes)').eq('list_id', data.id).order('sort_order'); if (on) setItems(rows(it)); }
      setLoading(false);
    })();
    return () => { on = false; };
  }, [token]);
  if (loading) return <main className="container-narrow py-16"><FeedSkeleton /></main>;
  if (!list) return <EmptyState message="This list is private or no longer exists." />;
  return (
    <main className="container-narrow py-16 md:py-24">
      <Helmet><title>{list.name} · Reading list | Lixxon Studio</title></Helmet>
      <header className="mb-10"><p className="text-[11px] tracking-editorial uppercase text-bronze mb-2">Shared reading list</p><h1 className="font-serif text-4xl text-charcoal">{list.name}</h1>{list.description && <p className="text-charcoal-light mt-3">{list.description}</p>}</header>
      <ol className="space-y-5">{items.filter(i => i.post).map((i, n) => (
        <li key={i.id}><Link to={{ name: 'article', slug: i.post!.slug }} className="group flex gap-5 items-start">
          <span className="font-serif text-2xl text-bronze/70 w-8 flex-shrink-0">{n + 1}</span>
          <div className="w-24 h-16 bg-taupe-light rounded-sm overflow-hidden flex-shrink-0">{i.post!.cover_image && <img src={i.post!.cover_image} alt="" className="w-full h-full object-cover" />}</div>
          <div><h2 className="font-serif text-xl text-charcoal group-hover:text-bronze transition-colors leading-snug">{i.post!.title}</h2><p className="text-[11px] text-charcoal-muted mt-1">{i.post!.reading_time_minutes} min read</p></div>
        </Link></li>
      ))}</ol>
    </main>
  );
}
