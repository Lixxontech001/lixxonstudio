import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import Logo from './Logo';

const navLinks = [
  { label: 'Services', target: 'services' },
  { label: 'Our Work', target: 'portfolio' },
  { label: 'Process', target: 'process' },
  { label: 'Testimonials', target: 'testimonials' },
  { label: 'FAQ', target: 'faq' },
];

export default function Navigation() {
  const { currentPage, goHome } = useNavigation();
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);

  const isHome = currentPage.type === 'home';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!isHome) return;
    const sections = navLinks.map((l) => l.target);
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { threshold: 0.4 }
    );
    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [isHome]);

  const scrollToSection = (target: string) => {
    if (!isHome) {
      goHome();
      setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' }), 100);
    } else {
      document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const showTransparent = isHome && !scrolled;

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          scrolled
            ? 'py-3 bg-white/90 backdrop-blur-xl shadow-sm shadow-gray-100/50 border-b border-gray-100/80'
            : 'py-5 bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <Logo variant={showTransparent ? 'light' : 'dark'} />

          {/* Desktop Links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <button
                key={link.target}
                onClick={() => scrollToSection(link.target)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
                  activeSection === link.target
                    ? 'bg-accent-500 text-white'
                    : showTransparent
                    ? 'text-white/80 hover:text-white hover:bg-white/10'
                    : 'text-gray-600 hover:text-primary hover:bg-gray-50'
                }`}
              >
                {link.label}
              </button>
            ))}
          </div>

          {/* CTA Button */}
          <div className="hidden md:block">
            <button
              onClick={() => scrollToSection('free-preview')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-accent-500 to-secondary-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-accent-500/30 hover:shadow-accent-500/50 hover:-translate-y-0.5 transition-all duration-300"
            >
              Free Preview
            </button>
          </div>

          {/* Mobile menu button */}
          <button
            className={`md:hidden p-2 rounded-xl transition-colors ${showTransparent ? 'text-white hover:bg-white/10' : 'text-primary hover:bg-gray-100'}`}
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      <div
        className={`fixed inset-0 z-40 md:hidden transition-all duration-400 ${
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="absolute inset-0 bg-primary/95 backdrop-blur-xl" onClick={() => setMobileOpen(false)} />
        <div
          className={`absolute top-0 right-0 bottom-0 w-72 bg-white flex flex-col p-8 gap-2 shadow-2xl transform transition-transform duration-400 ${
            mobileOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="mb-6">
            <Logo />
          </div>

          {navLinks.map((link) => (
            <button
              key={link.target}
              onClick={() => {
                scrollToSection(link.target);
                setMobileOpen(false);
              }}
              className="px-4 py-3 rounded-xl text-gray-700 hover:bg-accent-50 hover:text-accent-600 font-medium transition-colors text-left"
            >
              {link.label}
            </button>
          ))}

          <div className="mt-4">
            <button
              onClick={() => {
                scrollToSection('free-preview');
                setMobileOpen(false);
              }}
              className="block w-full text-center px-6 py-3.5 bg-gradient-to-r from-accent-500 to-secondary-500 text-white font-semibold rounded-xl"
            >
              Get Free Preview
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
