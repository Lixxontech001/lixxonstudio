import { useState, useEffect } from 'react';
import { Search, Bookmark, Menu, X, ArrowRight } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import { useCategories } from '../hooks/useSupabase';
import { usePosts } from '../hooks/useSupabase';
import type { PostWithRelations } from '../lib/types';
import Logo from './Logo';

const announcementText = 'DAILY GLOW RESET • SKINCARE, STYLE & MINIMALIST WELLNESS';

export default function Header() {
  const { navigate, route } = useNavigation();
  const { categories } = useCategories();
  const { posts } = usePosts();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [bookmarked, setBookmarked] = useState(false);

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

  const filteredPosts: PostWithRelations[] = searchQuery
    ? posts.filter(p =>
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.excerpt || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.tags || []).some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
      ).slice(0, 5)
    : [];

  const goHome = () => {
    navigate({ name: 'home' });
    setMobileOpen(false);
  };

  const goCategory = (slug: string) => {
    navigate({ name: 'category', slug });
    setMobileOpen(false);
    setSearchOpen(false);
  };

  const goArticle = (slug: string) => {
    navigate({ name: 'article', slug });
    setSearchOpen(false);
  };

  const isActive = (slug: string) => route.name === 'category' && route.slug === slug;

  return (
    <>
      {/* Announcement Bar */}
      <div className="bg-charcoal text-white text-center py-2.5 overflow-hidden relative z-50">
        <div className="flex whitespace-nowrap animate-ticker">
          <span className="text-[10px] tracking-editorial uppercase font-light px-8">{announcementText}</span>
          <span className="text-[10px] tracking-editorial uppercase font-light px-8">•</span>
          <span className="text-[10px] tracking-editorial uppercase font-light px-8">{announcementText}</span>
          <span className="text-[10px] tracking-editorial uppercase font-light px-8">•</span>
        </div>
      </div>

      {/* Main Header */}
      <header
        className={`sticky top-0 z-40 transition-all duration-500 ${
          scrolled
            ? 'bg-white/95 backdrop-blur-md border-b border-taupe/40 py-4'
            : 'bg-porcelain py-6'
        }`}
      >
        <div className="container-wide flex items-center justify-between gap-6">
          {/* Left Nav (desktop) */}
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
              }`
              }
            >
              About
            </button>
          </nav>

          {/* Center Logo */}
          <button onClick={goHome} className="flex-shrink-0">
            <Logo />
          </button>

          {/* Right Icons */}
          <div className="flex items-center gap-4 flex-1 justify-end">
            <button
              onClick={() => setSearchOpen(true)}
              className="text-charcoal hover:text-bronze transition-colors duration-300"
              aria-label="Search"
            >
              <Search size={18} strokeWidth={1.5} />
            </button>
            <button
              onClick={() => setBookmarked(!bookmarked)}
              className={`transition-colors duration-300 ${bookmarked ? 'text-bronze' : 'text-charcoal hover:text-bronze'}`}
              aria-label="Bookmarks"
            >
              <Bookmark size={18} strokeWidth={1.5} fill={bookmarked ? 'currentColor' : 'none'} />
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

      {/* Search Drawer */}
      {searchOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center">
          <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm animate-fade-in" onClick={() => setSearchOpen(false)} />
          <div className="relative bg-white w-full max-w-2xl mt-20 mx-4 luxury-shadow-lg rounded-sm overflow-hidden animate-fade-up">
            <div className="flex items-center gap-4 px-8 py-6 border-b border-taupe/40">
              <Search size={20} strokeWidth={1.5} className="text-charcoal-muted" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search articles, topics, tags..."
                className="flex-1 bg-transparent text-lg font-light text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none"
              />
              <button onClick={() => setSearchOpen(false)} className="text-charcoal-muted hover:text-charcoal transition-colors">
                <X size={20} strokeWidth={1.5} />
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              {searchQuery && filteredPosts.length === 0 && (
                <p className="px-8 py-10 text-center text-charcoal-muted text-sm">No articles found for "{searchQuery}"</p>
              )}
              {filteredPosts.length > 0 && (
                <div className="py-2">
                  {filteredPosts.map(post => (
                    <button
                      key={post.id}
                      onClick={() => goArticle(post.slug)}
                      className="flex items-center gap-4 w-full px-8 py-3 hover:bg-porcelain transition-colors text-left"
                    >
                      {post.cover_image && (
                        <img src={post.cover_image} alt="" className="w-14 h-14 object-cover rounded-sm" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-serif text-base text-charcoal truncate">{post.title}</p>
                        <p className="text-xs text-charcoal-muted mt-0.5">
                          {post.category?.name} · {post.reading_time_minutes} min read
                        </p>
                      </div>
                      <ArrowRight size={14} className="text-bronze flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              {!searchQuery && (
                <div className="px-8 py-6">
                  <p className="text-xs tracking-editorial uppercase text-charcoal-muted mb-4">Trending Topics</p>
                  <div className="flex flex-wrap gap-2">
                    {['Skincare', 'Minimalist', 'Sleep', 'Retinol', 'Capsule Wardrobe', 'Wellness'].map(tag => (
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

      {/* Mobile Drawer */}
      <div className={`fixed inset-0 z-[60] lg:hidden ${mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-charcoal/40 backdrop-blur-sm transition-opacity duration-400 ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setMobileOpen(false)}
        />
        <div
          className={`absolute top-0 right-0 bottom-0 w-80 bg-white flex flex-col transition-transform duration-400 ${
            mobileOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between p-6 border-b border-taupe/40">
            <Logo showText={false} />
            <button onClick={() => setMobileOpen(false)} className="text-charcoal-muted hover:text-charcoal">
              <X size={22} strokeWidth={1.5} />
            </button>
          </div>
          <nav className="flex flex-col p-6 gap-1">
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
