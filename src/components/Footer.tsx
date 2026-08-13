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
    const { error } = await supabase.from('newsletter_subscribers').insert({ email: email.trim() });
    if (error && error.code !== '23505') {
      setStatus('idle');
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
                onChange={e => setEmail(e.target.value)}
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
        <div className="container-wide py-6 flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-3 text-center sm:text-left">
          <p className="text-white/30 text-xs tracking-wider">© 2026 Lixxon Studio. All rights reserved.</p>
          <p className="text-white/30 text-xs tracking-wider">Crafted with intention.</p>
        </div>
      </div>
    </footer>
  );
}
