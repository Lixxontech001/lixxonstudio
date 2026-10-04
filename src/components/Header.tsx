import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Menu, X, ShoppingBag, Heart, User, Moon, Sun, Bookmark, Clock, Calendar, List } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useNavigation, Link } from '../context/NavigationContext';
import { useCategories } from '../hooks/useSupabase';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import { useTheme } from '../context/ThemeContext';
import { useLiveSearch } from '../hooks/useFeatures';
import Logo from './Logo';

const announcementText = 'DAILY GLOW RESET • SKINCARE, STYLE & MINIMALIST WELLNESS';

export default function Header() {
  const { route, navigate } = useNavigation();
  const { categories } = useCategories();
  const { count: cartCount, openCart } = useCart();
  const { count: wishlistCount } = useWishlist();
  const { theme, toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const mobilePanelRef = useFocusTrap<HTMLDivElement>(mobileOpen, closeMobile);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { suggestions, loading: suggestionsLoading } = useLiveSearch(searchQuery);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = (mobileOpen || searchOpen) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen, searchOpen]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  const navCategories = categories.filter(c => c.slug !== 'about');
  const isActive = (slug: string) => route.name === 'category' && route.slug === slug;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate({ name: 'search', query: searchQuery.trim(), page: 1 });
      setSearchOpen(false);
      setSearchQuery('');
    }
  };

  return (
    <>
      {/* Announcement bar */}
      <div className="bg-charcoal text-white text-center py-2.5 overflow-hidden relative z-50">
        <div className="flex whitespace-nowrap animate-ticker">
          <span className="text-[10px] tracking-editorial uppercase font-light px-8">{announcementText}</span>
          <span className="text-[10px] tracking-editorial uppercase font-light px-8">•</span>
          <span className="text-[10px] tracking-editorial uppercase font-light px-8">{announcementText}</span>
          <span className="text-[10px] tracking-editorial uppercase font-light px-8">•</span>
        </div>
      </div>

      {/* Sticky header */}
      <header
        className={`sticky top-0 z-40 transition-all duration-500 ${
          scrolled
            ? 'bg-white/95 backdrop-blur-md border-b border-taupe/40 py-3 dark:bg-charcoal/95 dark:border-white/10'
            : 'bg-porcelain py-5 dark:bg-charcoal'
        }`}
      >
        <div className="container-wide flex items-center justify-between gap-4 lg:gap-6">
          {/* Desktop nav left */}
          <nav className="hidden lg:flex items-center gap-6 flex-1">
            <Link to={{ name: 'home', page: 1 }} className={`text-xs tracking-editorial uppercase font-medium transition-colors duration-300 ${route.name === 'home' ? 'text-bronze' : 'text-charcoal hover:text-bronze dark:text-white/80 dark:hover:text-bronze-light'}`}>
              Home
            </Link>
            {navCategories.map(cat => (
              <Link
                key={cat.slug}
                to={{ name: 'category', slug: cat.slug, page: 1 }}
                className={`text-xs tracking-editorial uppercase font-medium transition-colors duration-300 ${isActive(cat.slug) ? 'text-bronze' : 'text-charcoal hover:text-bronze dark:text-white/80 dark:hover:text-bronze-light'}`}
              >
                {cat.name}
              </Link>
            ))}
            <Link to={{ name: 'about' }} className={`text-xs tracking-editorial uppercase font-medium transition-colors duration-300 ${route.name === 'about' ? 'text-bronze' : 'text-charcoal hover:text-bronze dark:text-white/80 dark:hover:text-bronze-light'}`}>
              About
            </Link>
            <Link to={{ name: 'shop' }} className={`text-xs tracking-editorial uppercase font-medium transition-colors duration-300 ${route.name === 'shop' || route.name === 'shop-product' || route.name === 'shop-category' ? 'text-bronze' : 'text-charcoal hover:text-bronze dark:text-white/80 dark:hover:text-bronze-light'}`}>
              Shop
            </Link>
            <Link to={{ name: 'collections' }} className={`text-xs tracking-editorial uppercase font-medium transition-colors duration-300 ${route.name === 'collections' || route.name === 'collection' ? 'text-bronze' : 'text-charcoal hover:text-bronze dark:text-white/80 dark:hover:text-bronze-light'}`}>
              Collections
            </Link>
            <Link to={{ name: 'weekly-digest' }} className={`text-xs tracking-editorial uppercase font-medium transition-colors duration-300 ${route.name === 'weekly-digest' ? 'text-bronze' : 'text-charcoal hover:text-bronze dark:text-white/80 dark:hover:text-bronze-light'}`}>
              Digest
            </Link>
            <Link to={{ name: 'contact' }} className={`text-xs tracking-editorial uppercase font-medium transition-colors duration-300 ${route.name === 'contact' ? 'text-bronze' : 'text-charcoal hover:text-bronze dark:text-white/80 dark:hover:text-bronze-light'}`}>
              Contact
            </Link>
          </nav>

          {/* Logo center */}
          <Link to={{ name: 'home', page: 1 }} className="flex-shrink-0">
            <Logo />
          </Link>

          {/* Actions right */}
          <div className="flex items-center gap-3 sm:gap-4 flex-1 justify-end">
            <button
              onClick={toggleTheme}
              className="text-charcoal hover:text-bronze transition-colors duration-300 dark:text-white/80 dark:hover:text-bronze-light"
              aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              aria-pressed={theme === 'dark'}
            >
              {theme === 'light' ? <Moon size={18} strokeWidth={1.5} /> : <Sun size={18} strokeWidth={1.5} />}
            </button>
            <button
              onClick={() => setSearchOpen(true)}
              className="text-charcoal hover:text-bronze transition-colors duration-300 dark:text-white/80 dark:hover:text-bronze-light"
              aria-label="Search"
            >
              <Search size={18} strokeWidth={1.5} />
            </button>
            <Link to={{ name: 'bookmarks' }} className="relative text-charcoal hover:text-bronze transition-colors duration-300 hidden sm:block dark:text-white/80 dark:hover:text-bronze-light" ariaLabel="Bookmarks">
              <Bookmark size={18} strokeWidth={1.5} />
            </Link>
            <Link to={{ name: 'wishlist' }} className="relative text-charcoal hover:text-bronze transition-colors duration-300 hidden sm:block dark:text-white/80 dark:hover:text-bronze-light" ariaLabel="Wishlist">
              <Heart size={18} strokeWidth={1.5} />
              {wishlistCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-bronze text-white text-[9px] font-medium rounded-full w-4 h-4 flex items-center justify-center">{wishlistCount}</span>
              )}
            </Link>
            <button
              onClick={openCart}
              className="relative text-charcoal hover:text-bronze transition-colors duration-300 dark:text-white/80 dark:hover:text-bronze-light"
              aria-label="Cart"
            >
              <ShoppingBag size={18} strokeWidth={1.5} />
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-bronze text-white text-[9px] font-medium rounded-full w-4 h-4 flex items-center justify-center">{cartCount}</span>
              )}
            </button>
            <Link to={{ name: 'account' }} className="text-charcoal hover:text-bronze transition-colors duration-300 hidden sm:block dark:text-white/80 dark:hover:text-bronze-light" ariaLabel="Account">
              <User size={18} strokeWidth={1.5} />
            </Link>
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden text-charcoal hover:text-bronze transition-colors duration-300 dark:text-white/80 dark:hover:text-bronze-light"
              aria-label="Menu"
            >
              <Menu size={20} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </header>

      {/* Search overlay with autocomplete */}
      {searchOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center">
          <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm animate-fade-in" onClick={() => setSearchOpen(false)} />
          <div className="relative bg-white w-full max-w-2xl mt-20 mx-4 luxury-shadow-lg rounded-sm overflow-hidden animate-fade-up dark:bg-charcoal dark:border dark:border-white/10">
            <form onSubmit={handleSearchSubmit}>
              <div className="flex items-center gap-4 px-6 md:px-8 py-6 border-b border-taupe/40 dark:border-white/10">
                <Search size={20} strokeWidth={1.5} className="text-charcoal-muted flex-shrink-0 dark:text-white/50" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search articles, products, topics..."
                  aria-label="Search articles, products, topics"
                  className="flex-1 bg-transparent text-base md:text-lg font-light text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none min-w-0 dark:text-white dark:placeholder:text-white/30"
                />
                <button type="button" onClick={() => setSearchOpen(false)} className="text-charcoal-muted hover:text-charcoal transition-colors flex-shrink-0 dark:text-white/50 dark:hover:text-white">
                  <X size={20} strokeWidth={1.5} />
                </button>
              </div>
            </form>
            {/* Live autocomplete suggestions */}
            {searchQuery.trim().length >= 2 && suggestions.length > 0 && (
              <div className="px-6 md:px-8 py-4 border-b border-taupe/30 dark:border-white/10">
                <p className="text-[10px] tracking-editorial uppercase text-charcoal-muted mb-3 dark:text-white/40">Articles</p>
                <div className="space-y-1">
                  {suggestions.map(s => (
                    <Link
                      key={s.slug}
                      to={{ name: 'article', slug: s.slug }}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-sm hover:bg-taupe-light/60 transition-colors group dark:hover:bg-white/5"
                      onClick={() => setSearchOpen(false)}
                    >
                      <Search size={14} strokeWidth={1.5} className="text-charcoal-muted/40 group-hover:text-bronze flex-shrink-0 dark:text-white/30" />
                      <span className="text-sm text-charcoal flex-1 truncate dark:text-white/80">{s.title}</span>
                      {s.category && <span className="text-[10px] tracking-editorial uppercase text-bronze flex-shrink-0">{s.category}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {searchQuery.trim().length >= 2 && suggestions.length === 0 && !suggestionsLoading && (
              <div className="px-6 md:px-8 py-6 text-center">
                <p className="text-sm text-charcoal-muted dark:text-white/50">No articles found for "{searchQuery}"</p>
              </div>
            )}
            {!searchQuery && (
              <div className="px-6 md:px-8 py-6">
                <p className="text-xs tracking-editorial uppercase text-charcoal-muted mb-4 dark:text-white/40">Trending Topics</p>
                <div className="flex flex-wrap gap-2">
                  {['Skincare', 'Retinol', 'Vitamin C', 'Sleep', 'Capsule Wardrobe', 'Wellness'].map(tag => (
                    <Link
                      key={tag}
                      to={{ name: 'search', query: tag, page: 1 }}
                      className="px-4 py-2 bg-taupe-light text-charcoal text-xs font-medium rounded-full hover:bg-bronze hover:text-white transition-all duration-300 dark:bg-white/10 dark:text-white/80"
                      onClick={() => setSearchOpen(false)}
                    >
                      {tag}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile menu */}
      <div className={`fixed inset-0 z-[60] lg:hidden ${mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-charcoal/40 backdrop-blur-sm transition-opacity duration-400 ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setMobileOpen(false)}
        />
        <div
          ref={mobilePanelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          aria-hidden={!mobileOpen}
          tabIndex={-1}
          className={`absolute top-0 right-0 bottom-0 w-[85%] max-w-sm bg-white flex flex-col transition-transform duration-400 outline-none ${mobileOpen ? 'translate-x-0' : 'translate-x-full'} dark:bg-charcoal`}
        >
          <div className="flex items-center justify-between p-6 border-b border-taupe/40 dark:border-white/10">
            <Logo showText={false} />
            <div className="flex items-center gap-1">
              <button
                onClick={toggleTheme}
                className="p-2.5 text-charcoal-muted hover:text-bronze transition-colors dark:text-white/60 dark:hover:text-bronze-light"
                aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
                aria-pressed={theme === 'dark'}
              >
                {theme === 'light' ? <Moon size={20} strokeWidth={1.5} /> : <Sun size={20} strokeWidth={1.5} />}
              </button>
              <button onClick={() => setMobileOpen(false)} className="p-2.5 text-charcoal-muted hover:text-charcoal dark:text-white/60 dark:hover:text-white" aria-label="Close menu">
                <X size={22} strokeWidth={1.5} />
              </button>
            </div>
          </div>
          <nav className="flex flex-col p-6 gap-1 overflow-y-auto">
            <Link to={{ name: 'home', page: 1 }} className="text-left py-3 font-serif text-2xl text-charcoal hover:text-bronze transition-colors duration-300 dark:text-white/90 dark:hover:text-bronze-light" onClick={() => setMobileOpen(false)}>
              Home
            </Link>
            {navCategories.map(cat => (
              <Link
                key={cat.slug}
                to={{ name: 'category', slug: cat.slug, page: 1 }}
                className="text-left py-3 font-serif text-2xl text-charcoal hover:text-bronze transition-colors duration-300 dark:text-white/90 dark:hover:text-bronze-light"
                onClick={() => setMobileOpen(false)}
              >
                {cat.name}
              </Link>
            ))}
            <Link to={{ name: 'about' }} className="text-left py-3 font-serif text-2xl text-charcoal hover:text-bronze transition-colors duration-300 dark:text-white/90 dark:hover:text-bronze-light" onClick={() => setMobileOpen(false)}>
              About
            </Link>
            <Link to={{ name: 'shop' }} className="text-left py-3 font-serif text-2xl text-charcoal hover:text-bronze transition-colors duration-300 dark:text-white/90 dark:hover:text-bronze-light" onClick={() => setMobileOpen(false)}>
              Shop
            </Link>
            <Link to={{ name: 'collections' }} className="text-left py-3 font-serif text-2xl text-charcoal hover:text-bronze transition-colors duration-300 dark:text-white/90 dark:hover:text-bronze-light" onClick={() => setMobileOpen(false)}>
              Collections
            </Link>
            <Link to={{ name: 'weekly-digest' }} className="text-left py-3 font-serif text-2xl text-charcoal hover:text-bronze transition-colors duration-300 dark:text-white/90 dark:hover:text-bronze-light" onClick={() => setMobileOpen(false)}>
              Weekly Digest
            </Link>
            <Link to={{ name: 'contact' }} className="text-left py-3 font-serif text-2xl text-charcoal hover:text-bronze transition-colors duration-300 dark:text-white/90 dark:hover:text-bronze-light" onClick={() => setMobileOpen(false)}>
              Contact
            </Link>
            <div className="h-[1px] bg-taupe/40 dark:bg-white/10 my-2" />
            <Link to={{ name: 'bookmarks' }} className="text-left py-3 font-serif text-xl text-charcoal hover:text-bronze transition-colors duration-300 flex items-center gap-3 dark:text-white/90 dark:hover:text-bronze-light" onClick={() => setMobileOpen(false)}>
              <Bookmark size={18} strokeWidth={1.5} /> Bookmarks
            </Link>
            <Link to={{ name: 'reading-lists' }} className="text-left py-3 font-serif text-xl text-charcoal hover:text-bronze transition-colors duration-300 flex items-center gap-3 dark:text-white/90 dark:hover:text-bronze-light" onClick={() => setMobileOpen(false)}>
              <List size={18} strokeWidth={1.5} /> Reading Lists
            </Link>
            <Link to={{ name: 'reading-history' }} className="text-left py-3 font-serif text-xl text-charcoal hover:text-bronze transition-colors duration-300 flex items-center gap-3 dark:text-white/90 dark:hover:text-bronze-light" onClick={() => setMobileOpen(false)}>
              <Clock size={18} strokeWidth={1.5} /> Reading History
            </Link>
            <Link to={{ name: 'newsletter-preferences' }} className="text-left py-3 font-serif text-xl text-charcoal hover:text-bronze transition-colors duration-300 flex items-center gap-3 dark:text-white/90 dark:hover:text-bronze-light" onClick={() => setMobileOpen(false)}>
              <Calendar size={18} strokeWidth={1.5} /> Newsletter
            </Link>
            <Link to={{ name: 'wishlist' }} className="text-left py-3 font-serif text-xl text-charcoal hover:text-bronze transition-colors duration-300 flex items-center gap-3 dark:text-white/90 dark:hover:text-bronze-light" onClick={() => setMobileOpen(false)}>
              <Heart size={18} strokeWidth={1.5} /> Wishlist
            </Link>
            <Link to={{ name: 'account' }} className="text-left py-3 font-serif text-xl text-charcoal hover:text-bronze transition-colors duration-300 flex items-center gap-3 dark:text-white/90 dark:hover:text-bronze-light" onClick={() => setMobileOpen(false)}>
              <User size={18} strokeWidth={1.5} /> Account
            </Link>
          </nav>
          <div className="mt-auto p-6 border-t border-taupe/40 dark:border-white/10">
            <p className="text-xs tracking-editorial uppercase text-charcoal-muted dark:text-white/40">The Daily Reset</p>
            <p className="text-sm text-charcoal mt-2 dark:text-white/60">Skincare, style & minimalist wellness, delivered daily.</p>
          </div>
        </div>
      </div>
    </>
  );
}
