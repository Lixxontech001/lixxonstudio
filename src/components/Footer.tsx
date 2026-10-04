import { useState } from 'react';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
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
          <p className="text-xs tracking-editorial uppercase text-white/40 mb-5">Legal</p>
          <ul className="space-y-3">
            <li><Link to={{ name: 'privacy' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Privacy Policy</Link></li>
            <li><Link to={{ name: 'terms' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Terms of Service</Link></li>
            <li><Link to={{ name: 'newsletter-preferences' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Newsletter Preferences</Link></li>
            <li><Link to={{ name: 'bookmarks' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Bookmarks</Link></li>
            <li><Link to={{ name: 'reading-lists' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Reading Lists</Link></li>
            <li><Link to={{ name: 'reading-history' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Reading History</Link></li>
            <li><Link to={{ name: 'account' }} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">My Account</Link></li>
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
