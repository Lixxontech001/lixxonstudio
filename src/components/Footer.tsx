import { useState } from 'react';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import Logo from './Logo';
import { supabase } from '../lib/supabaseClient';

export default function Footer() {
  const { navigate } = useNavigation();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    setStatus('submitting');
    await supabase.from('newsletter_subscribers').insert({ email: email.trim() });
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
        <div className="container-wide py-16 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <h3 className="font-serif text-3xl md:text-4xl font-light leading-tight">
              The Daily Reset Newsletter
            </h3>
            <p className="text-white/50 text-base mt-3 max-w-md">
              Skincare science, style philosophy, and wellness rituals, delivered to your inbox each morning. No noise, just signal.
            </p>
          </div>
          <form onSubmit={handleSubscribe} className="flex gap-3 w-full max-w-md lg:ml-auto">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="flex-1 bg-transparent border-b border-white/30 px-2 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-bronze transition-colors"
            />
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze-dark transition-all duration-500 whitespace-nowrap"
            >
              {status === 'submitting' ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Subscribing
                </>
              ) : status === 'success' ? (
                <>
                  <Check size={14} /> Subscribed
                </>
              ) : (
                <>
                  Subscribe <ArrowRight size={14} />
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Main Footer */}
      <div className="container-wide py-14 grid md:grid-cols-4 gap-10">
        <div className="md:col-span-2">
          <div className="bg-white rounded-sm inline-block p-3">
            <Logo />
          </div>
          <p className="text-white/40 text-sm mt-6 max-w-sm leading-relaxed">
            A daily digital magazine covering skincare science, intentional style, and minimalist wellness. Expert-written, beautifully edited, designed to be read slowly.
          </p>
        </div>

        <div>
          <p className="text-xs tracking-editorial uppercase text-white/40 mb-5">Explore</p>
          <ul className="space-y-3">
            {navItems.map(item => (
              <li key={item.slug}>
                <button
                  onClick={() => navigate({ name: 'category', slug: item.slug })}
                  className="text-white/60 text-sm hover:text-bronze transition-colors duration-300"
                >
                  {item.label}
                </button>
              </li>
            ))}
            <li>
              <button
                onClick={() => navigate({ name: 'about' })}
                className="text-white/60 text-sm hover:text-bronze transition-colors duration-300"
              >
                About
              </button>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-xs tracking-editorial uppercase text-white/40 mb-5">Legal</p>
          <ul className="space-y-3">
            <li><button onClick={() => navigate({ name: 'privacy' })} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Privacy Policy</button></li>
            <li><button onClick={() => navigate({ name: 'terms' })} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Terms of Service</button></li>
            <li><button onClick={() => navigate({ name: 'contact' })} className="text-white/60 text-sm hover:text-bronze transition-colors duration-300">Contact</button></li>
          </ul>
        </div>
      </div>

      {/* Copyright */}
      <div className="border-t border-white/10">
        <div className="container-wide py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-white/30 text-xs tracking-wider">© 2026 Lixxon Studio. All rights reserved.</p>
          <p className="text-white/30 text-xs tracking-wider">Crafted with intention.</p>
        </div>
      </div>
    </footer>
  );
}
