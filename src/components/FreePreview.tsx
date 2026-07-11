import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import { CheckCircle2, ArrowRight, Gift } from 'lucide-react';
import MagneticButton from './MagneticButton';

const steps = [
  'We design your homepage, completely free, no commitment.',
  'You review it on a live link we send you.',
  'Request changes. We revise until it is perfect.',
  'You approve the homepage.',
  'We then build the full website.',
  'Only pay when you are 100% satisfied.',
];

export default function FreePreview() {
  const [ref, isVisible] = useIntersectionObserver({ threshold: 0.15 });

  return (
    <section
      id="free-preview"
      ref={ref as React.RefObject<HTMLElement>}
      className="py-28 bg-white overflow-hidden relative"
    >
      {/* Gradient accent */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-accent-50 rounded-full blur-3xl opacity-50 pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-secondary-50 rounded-full blur-3xl opacity-50 pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: Image */}
          <div className={`relative section-reveal ${isVisible ? 'revealed' : ''}`}>
            <div className="relative">
              <div className="img-zoom rounded-3xl overflow-hidden premium-shadow-lg">
                <img
                  src="https://images.pexels.com/photos/3182781/pexels-photo-3182781.jpeg?auto=compress&cs=tinysrgb&w=900"
                  alt="Team designing premium website"
                  className="w-full h-[450px] object-cover"
                />
              </div>
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-accent-500/30 via-transparent to-secondary-500/20" />

              <div className="absolute -top-8 -right-4 bg-gradient-to-br from-accent-500 to-secondary-500 rounded-3xl p-6 shadow-2xl text-white text-center" style={{ animation: 'float-1 5s ease-in-out infinite' }}>
                <Gift size={28} className="mx-auto mb-1" />
                <div className="font-display font-bold text-2xl">FREE</div>
                <div className="text-white/80 text-xs mt-0.5 font-medium">Homepage Design</div>
              </div>

              <div className="absolute -bottom-8 -left-6 bg-white rounded-2xl p-4 premium-shadow-lg border border-gray-100 w-64" style={{ animation: 'float-2 6s ease-in-out 1s infinite' }}>
                <div className="bg-gray-100 rounded-xl h-28 overflow-hidden mb-3">
                  <img src="https://images.pexels.com/photos/196644/pexels-photo-196644.jpeg?auto=compress&cs=tinysrgb&w=300" alt="Website preview" className="w-full h-full object-cover" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs font-semibold text-primary">Homepage ready for review</span>
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5 ml-4">Sent to your email</div>
              </div>

              <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-accent-100 rounded-full blur-3xl" />
            </div>
          </div>

          {/* Right: Content */}
          <div className={`section-reveal reveal-delay-2 ${isVisible ? 'revealed' : ''}`}>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-green-100 text-green-700 text-xs font-semibold rounded-full tracking-widest uppercase mb-5">
              Our Unique Offer
            </span>

            <h2 className="font-display text-4xl md:text-5xl font-bold text-primary leading-tight mb-5">
              See Your New Website{' '}
              <span className="gradient-text">Before You Commit</span>
            </h2>

            <p className="text-gray-500 text-lg leading-relaxed mb-8">
              We believe you should love your website before paying for it. That is why we design your entire homepage first,{' '}
              <strong className="text-primary">completely free</strong>, so you can see exactly what you are getting.
            </p>

            <div className="space-y-4 mb-10">
              {steps.map((step, i) => (
                <div key={i} className={`flex items-start gap-3 section-reveal reveal-delay-${i + 1} ${isVisible ? 'revealed' : ''}`}>
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent-500 to-secondary-500 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                    <CheckCircle2 size={14} className="text-white" />
                  </div>
                  <p className="text-gray-600 text-sm leading-relaxed">{step}</p>
                </div>
              ))}
            </div>

            <MagneticButton
              href="https://www.facebook.com/profile.php?id=61591696896659&mibextid=ZbWKwL"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-accent-500 to-secondary-500 text-white font-semibold rounded-2xl shadow-xl shadow-accent-500/30 hover:shadow-accent-500/50 transition-all duration-300"
            >
              <span>Claim My Free Homepage</span>
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </MagneticButton>

            <p className="mt-4 text-gray-400 text-xs flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-green-500" />
              No credit card required. No obligation. 100% free.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
