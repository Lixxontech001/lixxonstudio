import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Play, Sparkles, Zap, Target, Smartphone, Star } from 'lucide-react';
import MagneticButton from './MagneticButton';

const websiteSlides = [
  { img: 'https://images.pexels.com/photos/1484516/pexels-photo-1484516.jpeg?auto=compress&cs=tinysrgb&w=900', label: 'Restaurant' },
  { img: 'https://images.pexels.com/photos/271618/pexels-photo-271618.jpeg?auto=compress&cs=tinysrgb&w=900', label: 'Hotel' },
  { img: 'https://images.pexels.com/photos/4173239/pexels-photo-4173239.jpeg?auto=compress&cs=tinysrgb&w=900', label: 'Clinic' },
  { img: 'https://images.pexels.com/photos/323780/pexels-photo-323780.jpeg?auto=compress&cs=tinysrgb&w=900', label: 'Real Estate' },
  { img: 'https://images.pexels.com/photos/1552249/pexels-photo-1552249.jpeg?auto=compress&cs=tinysrgb&w=900', label: 'Gym' },
];

const floatingBadges = [
  { text: '99+ PageSpeed', icon: Zap, color: 'from-amber-400 to-orange-400' },
  { text: 'SEO Optimized', icon: Target, color: 'from-green-400 to-emerald-500' },
  { text: 'Mobile First', icon: Smartphone, color: 'from-accent-500 to-secondary-500' },
];

export default function Hero() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [scrollY, setScrollY] = useState(0);
  const heroRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onMove = (e: MouseEvent) => {
      if (!heroRef.current) return;
      const rect = heroRef.current.getBoundingClientRect();
      setMousePos({
        x: ((e.clientX - rect.left) / rect.width - 0.5) * 20,
        y: ((e.clientY - rect.top) / rect.height - 0.5) * 10,
      });
    };
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section
      ref={heroRef}
      className="relative min-h-screen overflow-hidden animated-bg flex items-center pt-24 pb-12"
    >
      {/* Background effects */}
      <div className="absolute top-20 left-10 w-[500px] h-[500px] rounded-full bg-accent-500/15 blur-3xl blob-1 pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[400px] h-[400px] rounded-full bg-secondary-500/15 blur-3xl blob-2 pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full bg-accent-700/10 blur-3xl blob-3 pointer-events-none" />

      {/* Grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        {/* Left content */}
        <div className="flex flex-col gap-7">
          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 self-start px-4 py-2 glass rounded-full border border-white/20"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(20px)',
              transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.2s',
            }}
          >
            <Sparkles size={14} className="text-secondary-400" />
            <span className="text-white/80 text-sm font-medium">Premium Web Design Agency</span>
          </div>

          {/* Headline with word-by-word reveal */}
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl xl:text-7xl text-white leading-[1.08] font-bold tracking-tight text-balance">
            {'Your Website Should Be Your Best Salesperson That Turn Visitors Into Customers.'.split(' ').map((word, i) => (
              <span key={i} className="inline-block overflow-hidden align-bottom">
                <span
                  className={`inline-block ${i > 5 && i < 11 ? 'gradient-text' : ''}`}
                  style={{
                    transform: mounted ? 'translateY(0)' : 'translateY(100%)',
                    opacity: mounted ? 1 : 0,
                    transition: `transform 0.8s cubic-bezier(0.16, 1, 0.3, 1) ${0.3 + i * 0.04}s, opacity 0.8s ease ${0.3 + i * 0.04}s`,
                  }}
                >
                  {word}
                  {i < 14 ? '\u00A0' : ''}
                </span>
              </span>
            ))}
          </h1>

          {/* Subheadline */}
          <p
            className="text-white/60 text-lg md:text-xl leading-relaxed max-w-lg"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(20px)',
              transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.8s',
            }}
          >
            We design premium websites that make businesses look more professional, earn customer trust, and generate more inquiries around the clock.
          </p>

          {/* CTA Buttons */}
          <div
            className="flex flex-col sm:flex-row gap-4"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(20px)',
              transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1) 1s',
            }}
          >
            <MagneticButton
              onClick={() => scrollToSection('free-preview')}
              className="group inline-flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-accent-500 to-secondary-500 text-white font-semibold rounded-2xl shadow-2xl shadow-accent-500/30 hover:shadow-accent-500/50 transition-all duration-300 text-sm md:text-base"
            >
              <span>Get My Free Homepage Preview</span>
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </MagneticButton>

            <MagneticButton
              onClick={() => scrollToSection('portfolio')}
              className="group inline-flex items-center justify-center gap-3 px-8 py-4 glass text-white font-semibold rounded-2xl hover:bg-white/15 transition-all duration-300 text-sm md:text-base border border-white/20"
            >
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Play size={12} fill="white" />
              </div>
              <span>View Our Work</span>
            </MagneticButton>
          </div>

          {/* Trust indicators */}
          <div
            className="flex items-center gap-6 pt-2"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(20px)',
              transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1) 1.2s',
            }}
          >
            <div className="flex -space-x-2">
              {[3182812, 3182781, 3184291, 5699456].map((id, i) => (
                <img
                  key={id}
                  src={`https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=60&h=60&fit=crop`}
                  alt="Client"
                  className="w-9 h-9 rounded-full border-2 border-primary object-cover"
                  style={{ zIndex: 4 - i }}
                />
              ))}
            </div>
            <div>
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={14} fill="#F59E0B" className="text-amber-400" />
                ))}
              </div>
              <p className="text-white/50 text-xs mt-0.5">Trusted by 200+ businesses</p>
            </div>
          </div>
        </div>

        {/* Right: Laptop Showcase with parallax */}
        <div
          className="relative flex items-center justify-center"
          style={{
            transform: `perspective(1000px) rotateY(${-mousePos.x * 0.3}deg) rotateX(${mousePos.y * 0.3}deg) translateY(${scrollY * -0.05}px)`,
            opacity: mounted ? 1 : 0,
            transition: 'opacity 1s ease 0.5s',
          }}
        >
          {/* Glow */}
          <div className="absolute inset-0 bg-gradient-to-r from-accent-500/20 to-secondary-500/20 blur-3xl rounded-full scale-75" />

          <div className="relative w-full max-w-lg">
            {/* Screen */}
            <div className="relative bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-white/10" style={{ aspectRatio: '16/10' }}>
              {/* Browser chrome */}
              <div className="bg-gray-800 h-8 flex items-center px-4 gap-2 border-b border-white/5">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
                </div>
                <div className="flex-1 mx-4 bg-gray-700 rounded-md h-4 flex items-center px-2">
                  <span className="text-gray-400 text-[9px] truncate">lixxonstudio.com/project</span>
                </div>
              </div>

              {/* Slideshow */}
              <div className="relative" style={{ height: 'calc(100% - 32px)' }}>
                {websiteSlides.map((slide, i) => (
                  <div key={i} className="slideshow-item absolute inset-0" style={{ opacity: i === 0 ? 1 : 0 }}>
                    <img src={slide.img} alt={slide.label} className="w-full h-full object-cover" loading={i === 0 ? 'eager' : 'lazy'} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    <div className="absolute bottom-3 left-4">
                      <span className="px-2 py-1 bg-accent-500/90 text-white text-[10px] font-semibold rounded-md backdrop-blur-sm">
                        {slide.label} Website
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Laptop base */}
            <div className="bg-gray-700 h-3 rounded-b-lg mx-6 border-t border-white/10" />
            <div className="bg-gray-800 h-2 rounded-b-2xl mx-2 shadow-2xl" />

            {/* Floating badges */}
            {floatingBadges.map((badge, i) => {
              const BadgeIcon = badge.icon;
              return (
                <div
                  key={i}
                  className="absolute glass border border-white/20 rounded-2xl px-4 py-2.5 flex items-center gap-2 shadow-xl backdrop-blur-xl"
                  style={{
                    top: i === 0 ? '-20px' : i === 1 ? '30%' : undefined,
                    bottom: i === 2 ? '-20px' : undefined,
                    left: i === 1 ? '-40px' : undefined,
                    right: i === 0 ? '20px' : i === 2 ? '10px' : undefined,
                    animation: `float-${i + 1} ${5 + i}s ease-in-out infinite`,
                  }}
                >
                  <div className={`w-7 h-7 rounded-xl bg-gradient-to-br ${badge.color} flex items-center justify-center`}>
                    <BadgeIcon size={14} className="text-white" />
                  </div>
                  <span className="text-white text-xs font-semibold whitespace-nowrap">{badge.text}</span>
                </div>
              );
            })}

            {/* Browser window floating behind */}
            <div
              className="absolute -bottom-10 -left-16 w-48 glass rounded-xl overflow-hidden border border-white/10 shadow-xl hidden lg:block"
              style={{ animation: 'float-3 7s ease-in-out 2s infinite' }}
            >
              <div className="bg-gray-800 h-5 flex items-center px-2 gap-1">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                </div>
              </div>
              <img src="https://images.pexels.com/photos/302899/pexels-photo-302899.jpeg?auto=compress&cs=tinysrgb&w=300" alt="Preview" className="w-full h-24 object-cover" />
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce">
        <span className="text-white/30 text-xs tracking-widest uppercase">Scroll</span>
        <div className="w-[1px] h-8 bg-gradient-to-b from-white/30 to-transparent" />
      </div>
    </section>
  );
}
