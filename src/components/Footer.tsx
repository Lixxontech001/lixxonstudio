import { useState } from 'react';
import { ArrowRight, Check, Loader2, Rss } from 'lucide-react';
import { Link } from '../context/NavigationContext';
import CurrencySelector from './CurrencySelector';
import Logo from './Logo';
import { submitForm } from '../lib/api';
import { useSiteConfig } from '../hooks/useSiteConfig';

export default function Footer() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const { config } = useSiteConfig();
  // Owners can replace these columns (and the closing note) in Admin → Front end → Footer.
  const dbColumns = Array.isArray(config.footer?.columns) ? config.footer!.columns! : [];
  const closingNote = config.footer?.note || 'Crafted with intention.';

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus('error');
      return;
    }
    setStatus('submitting');
    try {
      await submitForm('newsletter', { email: email.trim(), source: 'footer' });
    } catch {
      setStatus('error');
      return;
    }
    setStatus('success');
    setEmail('');
    setTimeout(() => setStatus('idle'), 4000);
  };

  const navItems = [
    { label: 'Skincare', slug: 'skincare' },
    { label: 'Style', slug: 'style' },
    { label: 'Wellness', slug: 'wellness' },
  ];

  const socialLinks = [
    {
      label: 'Instagram',
      url: (config as unknown as Record<string, unknown>)?.social_instagram as string || 'https://instagram.com/lixxonstudio',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
        </svg>
      )
    },
    {
      label: 'Discord',
      url: (config as unknown as Record<string, unknown>)?.social_discord as string || 'https://discord.gg/lixxonstudio',
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      )
    },
    {
      label: 'Substack',
      url: (config as unknown as Record<string, unknown>)?.social_substack as string || 'https://lixxonstudio.substack.com',
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z" />
        </svg>
      )
    },
    {
      label: 'Spotify',
      url: (config as unknown as Record<string, unknown>)?.social_spotify as string || 'https://open.spotify.com/show/lixxonstudio',
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.502 17.307a.75.75 0 0 1-1.03.248c-2.82-1.722-6.37-2.112-10.55-1.157a.75.75 0 1 1-.336-1.462c4.577-1.045 8.508-.602 11.668 1.341a.75.75 0 0 1 .248 1.03zm1.47-3.267a.938.938 0 0 1-1.29.31c-3.227-1.984-8.148-2.557-11.965-1.398a.938.938 0 1 1-.55-1.794c4.364-1.325 9.794-.687 13.495 1.592a.938.938 0 0 1 .31 1.29zm.126-3.41c-3.87-2.298-10.254-2.51-13.97-1.38a1.125 1.125 0 1 1-.655-2.155c4.27-1.296 11.31-1.047 15.772 1.6a1.125 1.125 0 0 1-1.147 1.935z" />
        </svg>
      )
    },
    {
      label: 'YouTube',
      url: (config as unknown as Record<string, unknown>)?.social_youtube as string || 'https://youtube.com/@lixxonstudio',
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      )
    },
    {
      label: 'Pinterest',
      url: (config as unknown as Record<string, unknown>)?.social_pinterest as string || 'https://pinterest.com/lixxonstudio',
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146 1.124.347 2.317.535 3.554.535 6.627 0 12.004-5.373 12.004-11.993C24.012 5.367 18.643 0 12.017 0z" />
        </svg>
      )
    },
    {
      label: 'X (Twitter)',
      url: (config as unknown as Record<string, unknown>)?.social_twitter as string || 'https://x.com/lixxonstudio',
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )
    },
  ];

  return (
    <footer className="bg-charcoal text-white">
      {/* Newsletter Section */}
      <div className="border-b border-white/10">
        <div className="container-wide py-12 md:py-16 grid lg:grid-cols-2 gap-8 lg:gap-10 items-center">
          <div>
            <h3 className="font-serif text-2xl md:text-3xl lg:text-4xl font-light leading-tight">
              The Daily Reset Newsletter
            </h3>
            <p className="text-white/50 text-sm md:text-base mt-3 max-w-md leading-relaxed">
              Skincare science, style philosophy, and wellness rituals, delivered to your inbox each morning. No noise, just signal.
            </p>
          </div>
          <form onSubmit={handleSubscribe} className="w-full max-w-md lg:ml-auto">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setStatus('idle'); }}
                placeholder="your@email.com"
                aria-label="Your email address"
                className="flex-1 bg-transparent border-b border-white/30 px-2 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-bronze transition-colors min-w-0"
              />
              <button
                type="submit"
                className="flex items-center justify-center gap-2 px-6 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze-dark transition-all duration-500 whitespace-nowrap flex-shrink-0"
              >
                {status === 'submitting' ? (
                  <><Loader2 size={14} className="animate-spin" /> Subscribing</>
                ) : status === 'success' ? (
                  <><Check size={14} /> Subscribed</>
                ) : (
                  <>Subscribe <ArrowRight size={14} /></>
                )}
              </button>
            </div>
            {status === 'error' && (
              <p className="text-bronze-light text-sm mt-3">Please enter a valid email address.</p>
            )}
            {status === 'success' && (
              <p className="text-bronze-light text-sm mt-3">Welcome to The Daily Reset.</p>
            )}
          </form>
        </div>
      </div>

      {/* Main Footer */}
      <div className="container-wide py-12 md:py-14 grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-10">
        <div className="col-span-2 md:col-span-2">
          <div className="bg-white rounded-sm inline-block p-3">
            <Logo showText={false} />
          </div>
          <p className="text-white/40 text-sm mt-6 max-w-sm leading-relaxed">
            A daily digital magazine covering skincare science, intentional style, and minimalist wellness. Expert-written, beautifully edited, designed to be read slowly.
          </p>

          {/* Social Channels Strip */}
          <div className="mt-8 pt-6 border-t border-white/10 max-w-sm">
            <p className="text-[10px] tracking-ultra-wide uppercase text-white/40 font-medium mb-3">
              Editorial Community &amp; Audio
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {socialLinks.map(soc => (
                <a
                  key={soc.label}
                  href={soc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={soc.label}
                  title={soc.label}
                  className="p-2.5 rounded-full bg-white/5 hover:bg-bronze text-white/70 hover:text-white transition-all duration-300 hover:scale-110 shadow-xs"
                >
                  {soc.icon}
                </a>
              ))}
              <a
                href="/feed.xml"
                target="_blank"
                rel="alternate"
                type="application/rss+xml"
                aria-label="RSS Feed"
                title="RSS Feed"
                className="p-2.5 rounded-full bg-white/5 hover:bg-bronze text-white/70 hover:text-white transition-all duration-300 hover:scale-110 shadow-xs"
              >
                <Rss size={16} />
              </a>
            </div>
          </div>
        </div>

        {dbColumns.length > 0 ? dbColumns.map((col, i) => (
          <div key={`${col.title}-${i}`}>
            <p className="text-xs tracking-editorial uppercase text-white/40 mb-5">{col.title}</p>
            <ul className="space-y-3">
              {(col.links || []).map(link => (
                <li key={`${link.label}-${link.href}`}>
                  <a href={link.href} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">{link.label}</a>
                </li>
              ))}
            </ul>
          </div>
        )) : (
          <>
        <div>
          <p className="text-xs tracking-editorial uppercase text-white/40 mb-5">Explore</p>
          <ul className="space-y-3">
            <li>
              <Link to={{ name: 'trending' }} className="text-white/80 font-medium text-sm hover:text-bronze transition-colors duration-300">
                Trending Hub
              </Link>
            </li>
            {navItems.map(item => (
              <li key={item.slug}>
                <Link to={{ name: 'category', slug: item.slug, page: 1 }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link to={{ name: 'shop' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">
                Shop
              </Link>
            </li>
            <li>
              <Link to={{ name: 'collections' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">
                Collections
              </Link>
            </li>
            <li>
              <Link to={{ name: 'weekly-digest' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">
                Weekly Digest
              </Link>
            </li>
            <li><Link to={{ name: 'series-index' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Series</Link></li>
            <li><Link to={{ name: 'glossary' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Glossary</Link></li>
            <li><Link to={{ name: 'gift-cards' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Gift Cards</Link></li>
            <li><Link to={{ name: 'order-tracking', orderNumber: '' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Track an Order</Link></li>
            <li>
              <Link to={{ name: 'about' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">
                About
              </Link>
            </li>
            <li>
              <Link to={{ name: 'contact' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">
                Contact
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-xs tracking-editorial uppercase text-white/40 mb-5">Reader Lounge</p>
          <ul className="space-y-3">
            <li><Link to={{ name: 'bookmarks' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Bookmarks</Link></li>
            <li><Link to={{ name: 'reading-lists' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Reading Lists</Link></li>
            <li><Link to={{ name: 'reading-history' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Reading History</Link></li>
            <li><Link to={{ name: 'achievements' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Reader Achievements</Link></li>
            <li><Link to={{ name: 'account' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">My Account</Link></li>
            <li><a href="/feed.xml" target="_blank" rel="alternate" type="application/rss+xml" className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">RSS / XML Feed</a></li>
            <li><Link to={{ name: 'privacy' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Privacy Policy</Link></li>
            <li><Link to={{ name: 'terms' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Terms of Service</Link></li>
            <li><Link to={{ name: 'newsletter-preferences' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Newsletter Preferences</Link></li>
          </ul>
        </div>
          </>
        )}
      </div>

      {/* Copyright */}
      <div className="border-t border-white/10">
        <div className="container-wide py-6 flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-3 text-center sm:text-left">
          <p className="text-white/30 text-xs tracking-wider">© 2026 Lixxon Studio. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <CurrencySelector />
            <button onClick={() => window.dispatchEvent(new CustomEvent('lixxon:shortcuts'))} className="hidden sm:inline text-white/30 text-xs tracking-wider hover:text-bronze" aria-label="Keyboard shortcuts">Press ? for shortcuts</button>
            <p className="text-white/30 text-xs tracking-wider">{closingNote}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
