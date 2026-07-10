import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import {
  Phone, Search, PenLine, MessageSquare, Code2, Rocket, LifeBuoy
} from 'lucide-react';

const steps = [
  {
    number: '01',
    title: 'Discovery Call',
    desc: 'We start with a free consultation to understand your business, target customers, goals, and competitors.',
    icon: Phone,
    color: 'from-accent-500 to-blue-600',
  },
  {
    number: '02',
    title: 'Research and Strategy',
    desc: 'We research your industry and competitors to identify what makes a winning website for your market.',
    icon: Search,
    color: 'from-violet-500 to-purple-600',
  },
  {
    number: '03',
    title: 'Free Homepage Design',
    desc: 'We design your homepage first, completely free. You see it, love it, and only then discuss the full project.',
    icon: PenLine,
    color: 'from-pink-500 to-rose-500',
  },
  {
    number: '04',
    title: 'Your Feedback',
    desc: 'Review the homepage design and request unlimited revisions until it looks exactly the way you imagined.',
    icon: MessageSquare,
    color: 'from-amber-500 to-orange-500',
  },
  {
    number: '05',
    title: 'Full Development',
    desc: 'Once you approve the homepage, we build the entire website, fast, mobile-perfect, and SEO-ready.',
    icon: Code2,
    color: 'from-green-500 to-emerald-600',
  },
  {
    number: '06',
    title: 'Launch and Go Live',
    desc: 'We handle domain setup, hosting, SSL certificate, and everything technical. You just go live and grow.',
    icon: Rocket,
    color: 'from-secondary-500 to-cyan-600',
  },
  {
    number: '07',
    title: 'Ongoing Support',
    desc: 'After launch, we remain available for updates, maintenance, and any future improvements you need.',
    icon: LifeBuoy,
    color: 'from-teal-500 to-green-500',
  },
];

export default function Process() {
  const [ref, isVisible] = useIntersectionObserver({ threshold: 0.1 });

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section
      id="process"
      ref={ref as React.RefObject<HTMLElement>}
      className="py-28 bg-gray-50 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className={`text-center mb-20 section-reveal ${isVisible ? 'revealed' : ''}`}>
          <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-accent-100 text-accent-600 text-xs font-semibold rounded-full tracking-widest uppercase mb-4">
            How It Works
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-primary leading-tight">
            Our Simple, Proven{' '}
            <span className="gradient-text">7-Step Process</span>
          </h2>
          <p className="mt-4 text-gray-500 text-lg max-w-2xl mx-auto leading-relaxed">
            From our first conversation to your website going live, a transparent, stress-free process designed around your success.
          </p>
        </div>

        <div className="relative">
          {/* Connector line */}
          <div className="hidden lg:block absolute top-16 left-0 right-0 h-[2px]">
            <div
              className="h-full bg-gradient-to-r from-accent-500 via-secondary-500 to-green-500"
              style={{
                transition: 'width 2s ease-out, opacity 0.5s',
                width: isVisible ? '100%' : '0%',
                opacity: isVisible ? 1 : 0,
              }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-6 lg:gap-4">
            {steps.map((step, i) => {
              const StepIcon = step.icon;
              return (
                <div
                  key={step.number}
                  className={`relative flex flex-col items-center text-center section-reveal reveal-delay-${Math.min(i + 1, 6)} ${isVisible ? 'revealed' : ''}`}
                >
                  <div
                    className={`relative z-10 w-14 h-14 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-xl mb-5`}
                    style={{
                      animation: isVisible ? `float-${(i % 3) + 1} ${5 + i * 0.5}s ease-in-out ${i * 0.2}s infinite` : 'none',
                    }}
                  >
                    <StepIcon size={24} className="text-white" />
                    <div className="absolute -top-2 -right-2 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-md">
                      <span className="text-[9px] font-bold text-primary">{step.number}</span>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-300 w-full">
                    <h3 className="font-semibold text-primary text-sm mb-2">{step.title}</h3>
                    <p className="text-gray-500 text-xs leading-relaxed">{step.desc}</p>
                  </div>

                  {i < steps.length - 1 && (
                    <div className="lg:hidden flex items-center justify-center mt-4 mb-2">
                      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
                        <path d="M8 1v16M1 12l7 7 7-7" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className={`mt-16 text-center section-reveal reveal-delay-4 ${isVisible ? 'revealed' : ''}`}>
          <div className="inline-flex flex-col sm:flex-row items-center gap-6 bg-white rounded-3xl px-8 py-6 shadow-lg border border-gray-100">
            <div>
              <div className="text-primary font-display font-bold text-2xl">Ready to start?</div>
              <div className="text-gray-500 text-sm">Your free homepage is just one call away.</div>
            </div>
            <button
              onClick={() => scrollToSection('free-preview')}
              className="whitespace-nowrap px-6 py-3 bg-gradient-to-r from-accent-500 to-secondary-500 text-white font-semibold rounded-2xl shadow-lg shadow-accent-500/30 hover:-translate-y-0.5 hover:shadow-accent-500/50 transition-all duration-300 text-sm"
            >
              Start Now, It's Free
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
