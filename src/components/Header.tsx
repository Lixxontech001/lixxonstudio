import { useState, useEffect } from 'react';
import { Search, Menu, X, ArrowRight } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import { useCategories, usePosts, useProducts } from '../hooks/useSupabase';
import type { PostWithRelations, Product } from '../lib/types';
import Logo from './Logo';

const announcementText = 'DAILY GLOW RESET • SKINCARE, STYLE & MINIMALIST WELLNESS';

interface SearchResult {
  type: 'article' | 'product';
  id: string;
  title: string;
  subtitle: string;
  image?: string;
  slug: string;
  meta: string;
  score: number;
}

function tokenize(query: string): string[] {
  return query.toLowerCase().split(/[\s,]+/).filter(t => t.length > 0);
}

function scoreResult(target: string, queryTokens: string[]): number {
  const lowerTarget = target.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (lowerTarget.includes(token)) score += 2;
    if (lowerTarget.startsWith(token)) score += 3;
    const words = lowerTarget.split(/\s+/);
    for (const word of words) {
      if (word === token) score += 5;
      else if (word.startsWith(token)) score += 1;
    }
  }
  return score;
}

export default function Header() {
  const { navigate, route } = useNavigation();
  const { categories } = useCategories();
  const { posts } = usePosts();
  const { products } = useProducts();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (mobileOpen || searchOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen, searchOpen]);

  const navCategories = categories.filter(c => c.slug !== 'about');

  const searchResults: SearchResult[] = (() => {
    if (!searchQuery.trim()) return [];
    const tokens = tokenize(searchQuery);
    if (tokens.length === 0) return [];

    const articleResults: SearchResult[] = posts.map((p: PostWithRelations) => {
      const haystack = [p.title, p.excerpt || '', (p.tags || []).join(' '), p.category?.name || ''].join(' ');
      const score = scoreResult(haystack, tokens);
      return {
        type: 'article' as const,
        id: p.id,
        title: p.title,
        subtitle: p.excerpt || p.category?.name || '',
        image: p.cover_image || undefined,
        slug: p.slug,
        meta: `${p.category?.name || 'Article'} · ${p.reading_time_minutes} min`,
        score,
      };
    });

    const productResults: SearchResult[] = products
      .filter((p): p is Product & { slug: string } => !!p.slug)
      .map(p => {
        const haystack = [p.name, p.brand || '', p.description || '', p.category || '', p.key_ingredients || ''].join(' ');
        const score = scoreResult(haystack, tokens) * 0.9;
        return {
          type: 'product' as const,
          id: p.id,
          title: p.name,
          subtitle: p.brand || p.description || '',
          image: p.image_url || undefined,
          slug: p.slug,
          meta: p.price || (p.category || 'Product'),
          score,
        };
      });

    return [...articleResults, ...productResults]
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  })();

  const goHome = () => {
    navigate({ name: 'home' });
    setMobileOpen(false);
  };

  const goCategory = (slug: string) => {
    navigate({ name: 'category', slug });
    setMobileOpen(false);
    setSearchOpen(false);
  };

  const goResult = (r: SearchResult) => {
    if (r.type === 'article') navigate({ name: 'article', slug: r.slug });
    else navigate({ name: 'product', slug: r.slug });
    setSearchOpen(false);
    setSearchQuery('');
  };

  const isActive = (slug: string) => route.name === 'category' && route.slug === slug;

  return (
    <>
      <div className="bg-charcoal text-white text-center py-2.5 overflow-hidden relative z-50">
        <div className="flex whitespace-nowrap animate-ticker">
          <span className="text-[10px] tracking-editorial uppercase font-light px-8">{announcementText}</span>
          <span className="text-[10px] tracking-editorial uppercase font-light px-8">•</span>
          <span className="text-[10px] tracking-editorial uppercase font-light px-8">{announcementText}</span>
          <span className="text-[10px] tracking-editorial uppercase font-light px-8">•</span>
        </div>
      </div>

      <header
        className={`sticky top-0 z-40 transition-all duration-500 ${
          scrolled
            ? 'bg-white/95 backdrop-blur-md border-b border-taupe/40 py-4'
            : 'bg-porcelain py-6'
        }`}
      >
        <div className="container-wide flex items-center justify-between gap-4 lg:gap-6">
          <nav className="hidden lg:flex items-center gap-6 flex-1">
            <button
              onClick={goHome}
              className={`text-xs tracking-editorial uppercase font-medium transition-colors duration-300 ${
                route.name === 'home' ? 'text-bronze' : 'text-charcoal hover:text-bronze'
              }`}
            >
              Home
            </button>
            {navCategories.map(cat => (
              <button
                key={cat.slug}
                onClick={() => goCategory(cat.slug)}
                className={`text-xs tracking-editorial uppercase font-medium transition-colors duration-300 ${
                  isActive(cat.slug) ? 'text-bronze' : 'text-charcoal hover:text-bronze'
                }`}
              >
                {cat.name}
              </button>
            ))}
            <button
              onClick={() => { navigate({ name: 'about' }); setMobileOpen(false); }}
              className={`text-xs tracking-editorial uppercase font-medium transition-colors duration-300 ${
                route.name === 'about' ? 'text-bronze' : 'text-charcoal hover:text-bronze'
              }`}
            >
              About
            </button>
          </nav>

          <button onClick={goHome} className="flex-shrink-0">
            <Logo />
          </button>

          <div className="flex items-center gap-4 flex-1 justify-end">
            <button
              onClick={() => setSearchOpen(true)}
              className="text-charcoal hover:text-bronze transition-colors duration-300"
              aria-label="Search"
            >
              <Search size={18} strokeWidth={1.5} />
            </button>
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden text-charcoal hover:text-bronze transition-colors duration-300"
              aria-label="Menu"
            >
              <Menu size={20} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </header>

      {searchOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center">
          <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm animate-fade-in" onClick={() => setSearchOpen(false)} />
          <div className="relative bg-white w-full max-w-2xl mt-20 mx-4 luxury-shadow-lg rounded-sm overflow-hidden animate-fade-up">
            <div className="flex items-center gap-4 px-6 md:px-8 py-6 border-b border-taupe/40">
              <Search size={20} strokeWidth={1.5} className="text-charcoal-muted flex-shrink-0" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search articles, products, topics..."
                className="flex-1 bg-transparent text-base md:text-lg font-light text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none min-w-0"
              />
              <button onClick={() => setSearchOpen(false)} className="text-charcoal-muted hover:text-charcoal transition-colors flex-shrink-0">
                <X size={20} strokeWidth={1.5} />
              </button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              {searchQuery && searchResults.length === 0 && (
                <p className="px-8 py-10 text-center text-charcoal-muted text-sm">No results for "{searchQuery}"</p>
              )}
              {searchResults.length > 0 && (
                <div className="py-2">
                  {searchResults.map(r => (
                    <button
                      key={r.type + r.id}
                      onClick={() => goResult(r)}
                      className="flex items-center gap-4 w-full px-6 md:px-8 py-3 hover:bg-porcelain transition-colors text-left"
                    >
                      {r.image ? (
                        <img src={r.image} alt="" className="w-12 h-12 object-cover rounded-sm flex-shrink-0" />
                      ) : (
                        <div className="w-12 h-12 bg-taupe-light rounded-sm flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-serif text-sm md:text-base text-charcoal truncate">{r.title}</p>
                        <p className="text-xs text-charcoal-muted mt-0.5 truncate">
                          <span className="text-bronze tracking-wide uppercase text-[10px] mr-1.5">{r.type}</span>
                          {r.meta}
                        </p>
                      </div>
                      <ArrowRight size={14} className="text-bronze flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              {!searchQuery && (
                <div className="px-6 md:px-8 py-6">
                  <p className="text-xs tracking-editorial uppercase text-charcoal-muted mb-4">Trending Topics</p>
                  <div className="flex flex-wrap gap-2">
                    {['Skincare', 'Retinol', 'Vitamin C', 'Sleep', 'Capsule Wardrobe', 'Wellness'].map(tag => (
                      <button
                        key={tag}
                        onClick={() => setSearchQuery(tag)}
                        className="px-4 py-2 bg-taupe-light text-charcoal text-xs font-medium rounded-full hover:bg-bronze hover:text-white transition-all duration-300"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={`fixed inset-0 z-[60] lg:hidden ${mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-charcoal/40 backdrop-blur-sm transition-opacity duration-400 ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setMobileOpen(false)}
        />
        <div
          className={`absolute top-0 right-0 bottom-0 w-[85%] max-w-sm bg-white flex flex-col transition-transform duration-400 ${
            mobileOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between p-6 border-b border-taupe/40">
            <Logo showText={false} />
            <button onClick={() => setMobileOpen(false)} className="text-charcoal-muted hover:text-charcoal">
              <X size={22} strokeWidth={1.5} />
            </button>
          </div>
          <nav className="flex flex-col p-6 gap-1 overflow-y-auto">
            <button
              onClick={goHome}
              className="text-left py-3 font-serif text-2xl text-charcoal hover:text-bronze transition-colors duration-300"
            >
              Home
            </button>
            {navCategories.map(cat => (
              <button
                key={cat.slug}
                onClick={() => goCategory(cat.slug)}
                className="text-left py-3 font-serif text-2xl text-charcoal hover:text-bronze transition-colors duration-300"
              >
                {cat.name}
              </button>
            ))}
            <button
              onClick={() => { navigate({ name: 'about' }); setMobileOpen(false); }}
              className="text-left py-3 font-serif text-2xl text-charcoal hover:text-bronze transition-colors duration-300"
            >
              About
            </button>
            <button
              onClick={() => { navigate({ name: 'contact' }); setMobileOpen(false); }}
              className="text-left py-3 font-serif text-2xl text-charcoal hover:text-bronze transition-colors duration-300"
            >
              Contact
            </button>
          </nav>
          <div className="mt-auto p-6 border-t border-taupe/40">
            <p className="text-xs tracking-editorial uppercase text-charcoal-muted">The Daily Reset</p>
            <p className="text-sm text-charcoal mt-2">Skincare, style & minimalist wellness, delivered daily.</p>
          </div>
        </div>
      </div>
    </>
  );
}
