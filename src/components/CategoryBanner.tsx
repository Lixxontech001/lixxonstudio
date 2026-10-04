import { Link } from '../context/NavigationContext';
import type { Category } from '../lib/types';
import { renderMarkdown } from '../lib/markdown';

interface CategoryBannerProps {
  category: Category;
  postCount: number;
}

const bannerConfig: Record<string, { gradient: string; tagline: string }> = {
  skincare: {
    gradient: 'from-amber-900/80 to-stone-800/60',
    tagline: 'Science-backed routines for healthy, radiant skin.',
  },
  wellness: {
    gradient: 'from-emerald-900/80 to-stone-800/60',
    tagline: 'Evidence-based habits for a calmer, healthier life.',
  },
  style: {
    gradient: 'from-slate-800/80 to-stone-800/60',
    tagline: 'Timeless wardrobes and the art of dressing with intention.',
  },
};

export default function CategoryBanner({ category, postCount }: CategoryBannerProps) {
  const config = bannerConfig[category.slug] || {
    gradient: 'from-charcoal/80 to-charcoal/60',
    tagline: category.description || 'Explore our editorial coverage.',
  };

  return (
    <section className={`relative bg-gradient-to-br ${config.gradient} py-16 md:py-24 overflow-hidden`}>
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl bg-bronze-light" />
      </div>
      <div className="container-wide relative z-10">
        <nav className="text-xs text-white/50 mb-6 tracking-wider">
          <Link to={{ name: 'home', page: 1 }} className="hover:text-white transition-colors">Home</Link>
          <span className="mx-2">/</span>
          <span className="text-white/80">{category.name}</span>
        </nav>
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze-light mb-4">Category</p>
        <h1 className="font-serif text-4xl md:text-6xl text-white font-light capitalize">{category.name}</h1>
        <div className="text-white/70 text-lg mt-5 leading-relaxed max-w-xl" dangerouslySetInnerHTML={{ __html: renderMarkdown(config.tagline) }} />
        <p className="text-white/40 text-sm mt-6">{postCount} {postCount === 1 ? 'article' : 'articles'}</p>
      </div>
    </section>
  );
}
