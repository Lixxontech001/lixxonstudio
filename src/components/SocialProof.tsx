import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import { useCounter } from '../hooks/useCounter';

const stats = [
  { value: 200, suffix: '+', label: 'Businesses Helped', description: 'Across multiple industries' },
  { value: 97, suffix: '%', label: 'Client Satisfaction', description: 'From post-project surveys' },
  { value: 98, suffix: '', label: 'PageSpeed Score', description: 'Average across all sites' },
  { value: 12, suffix: '+', label: 'Countries Served', description: 'Global reach, local feel' },
  { value: 300, suffix: '+', label: 'Projects Designed', description: 'And counting every week' },
];

function StatCard({ value, suffix, label, description, isVisible }: typeof stats[0] & { isVisible: boolean }) {
  const count = useCounter(value, 2200, isVisible);
  return (
    <div className="flex flex-col items-center text-center gap-2 group">
      <div className="text-5xl md:text-6xl font-display font-bold text-primary tracking-tight group-hover:scale-110 transition-transform duration-300">
        {count}
        <span className="gradient-text">{suffix}</span>
      </div>
      <div className="font-semibold text-primary text-sm">{label}</div>
      <div className="text-gray-400 text-xs">{description}</div>
    </div>
  );
}

export default function SocialProof() {
  const [ref, isVisible] = useIntersectionObserver({ threshold: 0.3 });

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className="relative py-20 bg-white border-b border-gray-100"
    >
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-accent-500/30 to-transparent" />

      <div className="max-w-7xl mx-auto px-6">
        <div className={`text-center mb-16 section-reveal ${isVisible ? 'revealed' : ''}`}>
          <p className="text-accent-500 text-sm font-semibold tracking-widest uppercase mb-3">By The Numbers</p>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-primary">
            Results That Speak for Themselves
          </h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-10">
          {stats.map((stat, i) => (
            <div key={stat.label} className={`section-reveal reveal-delay-${i + 1} ${isVisible ? 'revealed' : ''}`}>
              <StatCard {...stat} isVisible={isVisible} />
            </div>
          ))}
        </div>

        <div className={`mt-20 section-reveal reveal-delay-6 ${isVisible ? 'revealed' : ''}`}>
          <p className="text-center text-gray-400 text-xs font-medium tracking-widest uppercase mb-8">
            Trusted by businesses across every industry
          </p>
          <div className="overflow-hidden relative">
            <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-white to-transparent z-10" />
            <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-white to-transparent z-10" />
            <div className="marquee-track">
              {[
                'Restaurant', 'Hotel', 'Clinic', 'Law Firm', 'Gym', 'Salon', 'Real Estate',
                'Church', 'School', 'Coffee Shop', 'Fashion', 'E-Commerce', 'Dental Clinic',
                'Photography', 'Consulting', 'Restaurant', 'Hotel', 'Clinic', 'Law Firm',
                'Gym', 'Salon', 'Real Estate', 'Church', 'School', 'Coffee Shop',
              ].map((label, i) => (
                <div key={i} className="flex items-center gap-3 mx-6 whitespace-nowrap">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent-500/50" />
                  <span className="text-gray-400 font-medium text-sm">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
