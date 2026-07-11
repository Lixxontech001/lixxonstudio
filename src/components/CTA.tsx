import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import { ArrowRight, MessageCircle, CheckCircle2 } from 'lucide-react';
import MagneticButton from './MagneticButton';

const trustItems = ['Free homepage design', 'No credit card required', 'No commitment', 'Reply within 2 hours'];

export default function CTA() {
  const [ref, isVisible] = useIntersectionObserver({ threshold: 0.2 });

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className="py-28 relative overflow-hidden animated-bg"
    >
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-accent-500/20 blur-3xl blob-1 pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-secondary-500/20 blur-3xl blob-2 pointer-events-none" />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
        <div className={`inline-flex items-center gap-2 px-4 py-2 glass border border-white/20 rounded-full mb-8 section-reveal ${isVisible ? 'revealed' : ''}`}>
          <span className="w-2 h-2 rounded-full bg-secondary-400 animate-pulse" />
          <span className="text-white/70 text-sm font-medium">Limited spots available this month</span>
        </div>

        <h2 className={`font-display text-4xl md:text-6xl font-bold text-white leading-tight mb-6 section-reveal reveal-delay-1 ${isVisible ? 'revealed' : ''}`}>
          Ready to Make Your Business Look{' '}
          <span className="gradient-text">Premium Online?</span>
        </h2>

        <p className={`text-white/60 text-xl leading-relaxed mb-10 max-w-2xl mx-auto section-reveal reveal-delay-2 ${isVisible ? 'revealed' : ''}`}>
          Book your free homepage preview today. No commitment, no pressure, just a beautiful design that shows you what is possible for your business.
        </p>

        <div className={`flex flex-col sm:flex-row items-center justify-center gap-4 section-reveal reveal-delay-3 ${isVisible ? 'revealed' : ''}`}>
          <MagneticButton
            onClick={() => scrollToSection('free-preview')}
            className="group inline-flex items-center gap-3 px-10 py-5 bg-white text-primary font-bold text-lg rounded-2xl shadow-2xl hover:shadow-white/20 transition-all duration-300"
          >
            <span>Get My Free Homepage Preview</span>
            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </MagneticButton>

          <MagneticButton
            href="https://wa.me/2349040057383?text=Hi%20Lixxon%20Studio!%20I'd%20like%20to%20discuss%20my%20website."
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-3 px-8 py-5 glass border border-white/20 text-white font-semibold text-lg rounded-2xl hover:bg-white/15 transition-all duration-300"
          >
            <MessageCircle size={20} />
            <span>Chat on WhatsApp</span>
          </MagneticButton>
        </div>

        <div className={`mt-10 flex flex-wrap items-center justify-center gap-6 text-white/40 text-sm section-reveal reveal-delay-4 ${isVisible ? 'revealed' : ''}`}>
          {trustItems.map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-green-400" />
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
