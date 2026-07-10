import { useEffect } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import { useCounter } from '../hooks/useCounter';
import {
  ArrowRight, ArrowLeft, CheckCircle2, MessageCircle,
  Target, Lightbulb, TrendingUp
} from 'lucide-react';
import { getServiceBySlug, services } from '../data/services';

export default function ServicePage({ slug }: { slug: string }) {
  const { navigate, goHome } = useNavigation();
  const service = getServiceBySlug(slug);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [slug]);

  if (!service) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Service not found.</p>
          <button onClick={goHome} className="text-accent-500 font-semibold">Return home</button>
        </div>
      </div>
    );
  }

  const Icon = service.icon;
  const relatedProjects = services.filter(s => s.slug !== slug).slice(0, 3);

  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden animated-bg">
        <div className="absolute top-20 left-10 w-96 h-96 rounded-full bg-accent-500/15 blur-3xl blob-1 pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-80 h-80 rounded-full bg-secondary-500/15 blur-3xl blob-2 pointer-events-none" />

        <div className="relative z-10 max-w-7xl mx-auto px-6">
          {/* Breadcrumb */}
          <button
            onClick={goHome}
            className="inline-flex items-center gap-2 text-white/50 hover:text-white transition-colors mb-8 text-sm"
          >
            <ArrowLeft size={16} />
            <span>Back to Home</span>
          </button>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br ${service.color} shadow-xl mb-6`}>
                <Icon size={28} className="text-white" />
              </div>

              <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight mb-4">
                {service.title}
              </h1>
              <p className="text-white/60 text-lg md:text-xl leading-relaxed mb-8 max-w-lg">
                {service.tagline}
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href="#free-preview"
                  className="group inline-flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-accent-500 to-secondary-500 text-white font-semibold rounded-2xl shadow-xl shadow-accent-500/30 hover:shadow-accent-500/50 hover:-translate-y-1 transition-all duration-300"
                >
                  <span>Get My Free Homepage Preview</span>
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </a>
                <a
                  href="https://wa.me/?text=Hi%20Lixxon%20Studio!%20I'm%20interested%20in%20your%20"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-3 px-8 py-4 glass border border-white/20 text-white font-semibold rounded-2xl hover:bg-white/15 transition-all duration-300"
                >
                  <MessageCircle size={18} />
                  <span>Ask a Question</span>
                </a>
              </div>
            </div>

            <div className="relative">
              <div className="img-zoom rounded-3xl overflow-hidden shadow-2xl">
                <img src={service.heroImage} alt={service.title} className="w-full h-[400px] object-cover" />
              </div>
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-primary/40 via-transparent to-accent-500/20" />
            </div>
          </div>
        </div>
      </section>

      {/* Overview */}
      <section className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-accent-100 text-accent-600 text-xs font-semibold rounded-full tracking-widest uppercase mb-5">
            Overview
          </span>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-primary leading-tight mb-6">
            Premium {service.title.toLowerCase()} designed to grow your business
          </h2>
          <p className="text-gray-500 text-lg leading-relaxed">{service.overview}</p>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-primary mb-4">
              What You Get
            </h2>
            <p className="text-gray-500 text-lg">Every {service.title.toLowerCase()} project includes these premium benefits.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {service.benefits.map((benefit, i) => (
              <div
                key={i}
                className="group bg-white rounded-3xl p-7 border border-gray-100 shadow-sm card-hover"
              >
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${service.color} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                  {[Target, Lightbulb, TrendingUp, CheckCircle2][i] && (() => {
                    const BenefitIcon = [Target, Lightbulb, TrendingUp, CheckCircle2][i];
                    return <BenefitIcon size={22} className="text-white" />;
                  })()}
                </div>
                <h3 className="font-semibold text-primary text-lg mb-2">{benefit.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{benefit.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features list */}
      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-primary mb-4">
              Included Features
            </h2>
            <p className="text-gray-500 text-lg">Everything below is standard in every {service.title.toLowerCase()} project.</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {service.features.map((feature, i) => (
              <div key={i} className="flex items-center gap-3 p-4 rounded-2xl hover:bg-gray-50 transition-colors">
                <div className={`w-6 h-6 rounded-full bg-gradient-to-br ${service.color} flex items-center justify-center flex-shrink-0`}>
                  <CheckCircle2 size={14} className="text-white" />
                </div>
                <span className="text-gray-700 text-sm font-medium">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-primary mb-4">
              The Impact
            </h2>
            <p className="text-gray-500 text-lg">Real numbers from businesses like yours after launch.</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            {service.stats.map((stat, i) => (
              <StatItem key={i} value={stat.value} label={stat.label} color={service.color} />
            ))}
          </div>
        </div>
      </section>

      {/* Case Study */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-accent-100 text-accent-600 text-xs font-semibold rounded-full tracking-widest uppercase mb-4">
              Case Study
            </span>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-primary">
              {service.caseStudy.title}
            </h2>
          </div>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="img-zoom rounded-3xl overflow-hidden shadow-2xl">
              <img src={service.caseStudy.image} alt={service.caseStudy.title} className="w-full h-[400px] object-cover" />
            </div>

            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Target size={16} className="text-red-500" />
                  <h3 className="font-semibold text-primary text-sm uppercase tracking-wider">The Challenge</h3>
                </div>
                <p className="text-gray-500 leading-relaxed">{service.caseStudy.challenge}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb size={16} className="text-amber-500" />
                  <h3 className="font-semibold text-primary text-sm uppercase tracking-wider">Our Solution</h3>
                </div>
                <p className="text-gray-500 leading-relaxed">{service.caseStudy.solution}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp size={16} className="text-green-500" />
                  <h3 className="font-semibold text-primary text-sm uppercase tracking-wider">The Result</h3>
                </div>
                <p className="text-gray-500 leading-relaxed">{service.caseStudy.result}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Industries served */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-primary mb-4">
            Industries We Serve
          </h2>
          <p className="text-gray-500 text-lg mb-10">We build {service.title.toLowerCase()} for all types of businesses.</p>

          <div className="flex flex-wrap justify-center gap-3">
            {service.industries_served.map((ind) => (
              <span
                key={ind}
                className={`px-5 py-2.5 bg-white rounded-2xl border border-gray-100 text-gray-700 text-sm font-medium shadow-sm`}
              >
                {ind}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-white">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-primary mb-4">
              Common Questions
            </h2>
          </div>

          <div className="space-y-3">
            {service.faqs.map((faq, i) => (
              <div key={i} className="border border-gray-100 rounded-2xl p-6">
                <h3 className="font-semibold text-primary mb-2">{faq.q}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Related services */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="font-display text-3xl font-bold text-primary mb-10 text-center">
            Explore Other Services
          </h2>
          <div className="grid md:grid-cols-3 gap-5">
            {relatedProjects.map((s) => {
              const RelIcon = s.icon;
              return (
                <button
                  key={s.slug}
                  onClick={() => navigate({ type: 'service', slug: s.slug })}
                  className="group bg-white rounded-3xl p-6 border border-gray-100 shadow-sm card-hover text-left"
                >
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${s.color} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                    <RelIcon size={22} className="text-white" />
                  </div>
                  <h3 className="font-semibold text-primary text-base mb-2">{s.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed mb-3">{s.shortDesc}</p>
                  <div className="flex items-center gap-1 text-accent-500 text-sm font-semibold">
                    <span>Learn more</span>
                    <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 relative overflow-hidden animated-bg">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-accent-500/20 blur-3xl blob-1 pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-secondary-500/20 blur-3xl blob-2 pointer-events-none" />

        <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
          <h2 className="font-display text-3xl md:text-5xl font-bold text-white leading-tight mb-6">
            Ready to Transform Your Business?
          </h2>
          <p className="text-white/60 text-lg mb-8 max-w-xl mx-auto">
            Get a free homepage preview for your {service.title.toLowerCase()} project. No commitment, no pressure.
          </p>
          <a
            href="https://wa.me/?text=Hi%20Lixxon%20Studio!%20I'd%20like%20a%20free%20homepage%20preview%20for%20my%20business."
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-3 px-10 py-5 bg-white text-primary font-bold text-lg rounded-2xl shadow-2xl hover:-translate-y-1 transition-all duration-300"
          >
            <span>Get My Free Homepage Preview</span>
            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </a>
        </div>
      </section>
    </div>
  );
}

function StatItem({ value, label, color }: { value: string; label: string; color: string }) {
  const [ref, isVisible] = useIntersectionObserver({ threshold: 0.5 });
  const numericValue = parseInt(value.replace(/[^0-9]/g, '')) || 0;
  const hasNumeric = /[0-9]/.test(value) && !value.includes('Top') && !value.includes('st');
  const count = useCounter(numericValue, 2000, isVisible && hasNumeric);

  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} className="text-center bg-white rounded-3xl p-8 border border-gray-100 shadow-sm">
      <div className={`text-4xl md:text-5xl font-display font-bold bg-gradient-to-br ${color} bg-clip-text text-transparent`}>
        {hasNumeric ? count : value}
      </div>
      <div className="text-gray-500 text-sm mt-2">{label}</div>
    </div>
  );
}
