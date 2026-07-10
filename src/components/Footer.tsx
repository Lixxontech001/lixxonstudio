import { MessageCircle, Mail, Instagram, Facebook, ArrowRight } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import { services } from '../data/services';
import Logo from './Logo';

const companyLinks = [
  { label: 'Our Work', target: 'portfolio' },
  { label: 'Services', target: 'services' },
  { label: 'How It Works', target: 'process' },
  { label: 'Free Homepage Preview', target: 'free-preview' },
  { label: 'Testimonials', target: 'testimonials' },
  { label: 'FAQ', target: 'faq' },
];

export default function Footer() {
  const { currentPage, goHome, navigate } = useNavigation();
  const isHome = currentPage.type === 'home';

  const scrollToSection = (target: string) => {
    if (!isHome) {
      goHome();
      setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' }), 100);
    } else {
      document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <footer className="bg-primary text-white relative overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-accent-500/60 to-transparent" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-accent-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-20 right-0 w-64 h-64 bg-secondary-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-12 py-20">
          {/* Brand */}
          <div className="lg:col-span-1">
            <Logo variant="light" size="lg" />
            <p className="text-white/50 text-sm leading-relaxed mb-6 mt-5">
              Premium websites that help businesses win more customers. We turn your online presence from zero to hero.
            </p>

            <div className="flex items-center gap-3">
              {[
                { icon: Facebook, href: '#', label: 'Facebook' },
                { icon: Instagram, href: '#', label: 'Instagram' },
                { icon: MessageCircle, href: 'https://wa.me/', label: 'WhatsApp' },
              ].map(({ icon: Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target={href.startsWith('http') ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-accent-500 hover:border-accent-500 transition-all duration-300"
                >
                  <Icon size={16} />
                </a>
              ))}
            </div>
          </div>

          {/* Services */}
          <div>
            <h4 className="font-semibold text-sm tracking-widest uppercase text-white/40 mb-5">Services</h4>
            <ul className="space-y-2.5">
              {services.slice(0, 8).map((s) => (
                <li key={s.slug}>
                  <button
                    onClick={() => navigate({ type: 'service', slug: s.slug })}
                    className="text-white/60 text-sm hover:text-white transition-colors flex items-center gap-2 group text-left"
                  >
                    <span className="w-1 h-1 rounded-full bg-accent-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-semibold text-sm tracking-widest uppercase text-white/40 mb-5">Company</h4>
            <ul className="space-y-2.5">
              {companyLinks.map((item) => (
                <li key={item.label}>
                  <button
                    onClick={() => scrollToSection(item.target)}
                    className="text-white/60 text-sm hover:text-white transition-colors flex items-center gap-2 group text-left"
                  >
                    <span className="w-1 h-1 rounded-full bg-accent-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-semibold text-sm tracking-widest uppercase text-white/40 mb-5">Get In Touch</h4>

            <div className="space-y-4 mb-6">
              <a href="mailto:hello@lixxonstudio.com" className="flex items-center gap-3 group">
                <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-accent-500 group-hover:border-accent-500 transition-all">
                  <Mail size={15} className="text-white/50 group-hover:text-white transition-colors" />
                </div>
                <div>
                  <div className="text-white/30 text-[10px] uppercase tracking-wider">Email</div>
                  <div className="text-white/70 text-sm group-hover:text-white transition-colors">hello@lixxonstudio.com</div>
                </div>
              </a>

              <a
                href="https://wa.me/?text=Hi%20Lixxon%20Studio!"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 group"
              >
                <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-green-600 group-hover:border-green-600 transition-all">
                  <MessageCircle size={15} className="text-white/50 group-hover:text-white transition-colors" />
                </div>
                <div>
                  <div className="text-white/30 text-[10px] uppercase tracking-wider">WhatsApp</div>
                  <div className="text-white/70 text-sm group-hover:text-white transition-colors">Chat with us</div>
                </div>
              </a>
            </div>

            <button
              onClick={() => scrollToSection('free-preview')}
              className="group inline-flex items-center gap-2 w-full justify-center px-5 py-3 bg-gradient-to-r from-accent-500 to-secondary-500 rounded-xl text-white font-semibold text-sm hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent-500/30 transition-all duration-300"
            >
              <span>Free Homepage Preview</span>
              <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>

        <div className="border-t border-white/5 py-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-white/30 text-sm">
            © {new Date().getFullYear()} Lixxon Studio. All rights reserved.
          </p>
          <div className="flex items-center gap-1 text-white/20 text-xs">
            <span>Crafted with</span>
            <span className="text-rose-400 mx-1">heart</span>
            <span>for businesses who deserve better.</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#" className="text-white/30 text-xs hover:text-white/60 transition-colors">Privacy Policy</a>
            <a href="#" className="text-white/30 text-xs hover:text-white/60 transition-colors">Terms of Service</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
