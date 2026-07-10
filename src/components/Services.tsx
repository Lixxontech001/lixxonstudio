import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import { useNavigation } from '../context/NavigationContext';
import { ArrowRight } from 'lucide-react';
import { services } from '../data/services';

export default function Services() {
  const [ref, isVisible] = useIntersectionObserver({ threshold: 0.1 });
  const { navigate } = useNavigation();

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section
      id="services"
      ref={ref as React.RefObject<HTMLElement>}
      className="py-28 bg-gray-50"
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className={`text-center mb-16 section-reveal ${isVisible ? 'revealed' : ''}`}>
          <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-accent-100 text-accent-600 text-xs font-semibold rounded-full tracking-widest uppercase mb-4">
            What We Build
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-primary leading-tight">
            Websites for Every{' '}
            <span className="gradient-text">Business Type</span>
          </h2>
          <p className="mt-4 text-gray-500 text-lg max-w-2xl mx-auto leading-relaxed">
            Whether you run a restaurant or a law firm, we build premium websites tailored to your industry, designed to impress and built to convert.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {services.map((service, i) => {
            const Icon = service.icon;
            return (
              <button
                key={service.slug}
                onClick={() => navigate({ type: 'service', slug: service.slug })}
                className={`group relative bg-white rounded-3xl p-6 border border-gray-100 shadow-sm card-hover cursor-pointer text-left section-reveal reveal-delay-${Math.min((i % 4) + 1, 6)} ${isVisible ? 'revealed' : ''}`}
              >
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${service.color} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                  <Icon size={22} className="text-white" />
                </div>

                <h3 className="font-semibold text-primary text-base mb-2">{service.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed mb-4">{service.shortDesc}</p>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {service.industries.map((ind) => (
                    <span key={ind} className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${service.bg} text-gray-600`}>
                      {ind}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-1 text-accent-500 text-sm font-semibold transition-all duration-300">
                  <span>Learn more</span>
                  <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                </div>

                <div className={`absolute bottom-0 left-0 right-0 h-1 rounded-b-3xl bg-gradient-to-r ${service.color} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
              </button>
            );
          })}
        </div>

        <div className={`text-center mt-14 section-reveal reveal-delay-4 ${isVisible ? 'revealed' : ''}`}>
          <p className="text-gray-500 mb-5">Don't see your industry? We build websites for all types of businesses.</p>
          <button
            onClick={() => scrollToSection('free-preview')}
            className="btn-primary inline-flex"
          >
            <span>Get a Free Consultation</span>
            <ArrowRight size={18} className="relative z-10" />
          </button>
        </div>
      </div>
    </section>
  );
}
