import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import {
  Zap, Smartphone, Search, Shield, MessageCircle, Calendar,
  Palette, BarChart3, Globe2, Settings, CheckCircle2
} from 'lucide-react';

const features = [
  {
    icon: Palette,
    title: 'Award-Worthy Design',
    desc: 'Every pixel is intentional. We create designs that stop scrollers and make visitors say wow.',
    color: 'from-pink-500 to-rose-500',
  },
  {
    icon: Smartphone,
    title: 'Mobile-First Responsive',
    desc: 'Over 70% of your visitors use mobile. Every website we build looks perfect on any screen size.',
    color: 'from-accent-500 to-blue-600',
  },
  {
    icon: Zap,
    title: 'Ultra-Fast Loading',
    desc: 'We optimize every website for 95+ PageSpeed scores. Fast sites rank higher and convert better.',
    color: 'from-amber-500 to-orange-500',
  },
  {
    icon: Search,
    title: 'SEO Foundations Built In',
    desc: 'Every website is built with proper SEO structure so Google can find and rank your business.',
    color: 'from-green-500 to-emerald-600',
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp Integration',
    desc: 'One-tap WhatsApp button so visitors can message you instantly. Never lose a lead again.',
    color: 'from-green-400 to-teal-500',
  },
  {
    icon: Calendar,
    title: 'Online Booking System',
    desc: 'Let customers book appointments 24/7 directly from your website, automatically confirmed.',
    color: 'from-secondary-500 to-cyan-600',
  },
  {
    icon: Globe2,
    title: 'Google Business Ready',
    desc: 'Integrated with Google Maps, Google Reviews, and structured data for maximum local visibility.',
    color: 'from-blue-500 to-accent-600',
  },
  {
    icon: Shield,
    title: 'Secure and Reliable',
    desc: 'SSL certificates, secure hosting, and regular backups. Your website runs safely, always.',
    color: 'from-gray-600 to-gray-800',
  },
  {
    icon: BarChart3,
    title: 'Analytics and Tracking',
    desc: 'Know exactly how many visitors you get, where they come from, and what they click on.',
    color: 'from-violet-500 to-purple-600',
  },
  {
    icon: Settings,
    title: 'Easy to Manage',
    desc: 'Update your own content, prices, and photos without any technical knowledge required.',
    color: 'from-teal-500 to-cyan-500',
  },
];

export default function WhyChooseUs() {
  const [ref, isVisible] = useIntersectionObserver({ threshold: 0.1 });

  return (
    <section
      id="why-us"
      ref={ref as React.RefObject<HTMLElement>}
      className="py-28 bg-white overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-20 items-center">
          {/* Left: Image */}
          <div className={`relative section-reveal ${isVisible ? 'revealed' : ''}`}>
            <div className="relative">
              <div className="img-zoom rounded-3xl overflow-hidden shadow-2xl">
                <img
                  src="https://images.pexels.com/photos/3182812/pexels-photo-3182812.jpeg?auto=compress&cs=tinysrgb&w=900"
                  alt="Premium web design team at work"
                  className="w-full h-[500px] object-cover"
                />
              </div>
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-primary/40 via-transparent to-accent-500/20" />

              {/* Floating card 1 */}
              <div
                className="absolute -top-6 -right-6 bg-white rounded-2xl p-4 shadow-2xl border border-gray-100"
                style={{ animation: 'float-1 5s ease-in-out infinite' }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                    <CheckCircle2 size={18} className="text-green-500" />
                  </div>
                  <div>
                    <div className="font-semibold text-primary text-sm">Project Delivered!</div>
                    <div className="text-gray-400 text-xs">Restaurant Website in 5 days</div>
                  </div>
                </div>
              </div>

              {/* Floating card 2 */}
              <div
                className="absolute -bottom-8 -left-8 bg-white rounded-2xl p-5 shadow-2xl border border-gray-100 max-w-[220px]"
                style={{ animation: 'float-2 6s ease-in-out 1s infinite' }}
              >
                <div className="flex items-center gap-1 mb-2">
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} width="11" height="11" viewBox="0 0 11 11" fill="#F59E0B">
                      <path d="M5.5 1l1.1 3.2H10L7.4 5.9 8.3 9 5.5 7.2 2.7 9l.9-3.1L1 4.2h3.4z"/>
                    </svg>
                  ))}
                </div>
                <p className="text-primary text-xs font-medium leading-snug">"Our bookings doubled in 3 months after our new website!"</p>
                <p className="text-gray-400 text-[10px] mt-1.5">Hotel Owner</p>
              </div>

              <div className="absolute -z-10 top-10 -left-10 w-64 h-64 bg-accent-100 rounded-full blur-3xl" />
            </div>
          </div>

          {/* Right: Features */}
          <div className={`section-reveal reveal-delay-2 ${isVisible ? 'revealed' : ''}`}>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-accent-100 text-accent-600 text-xs font-semibold rounded-full tracking-widest uppercase mb-5">
              Why Lixxon Studio
            </span>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-primary leading-tight mb-5">
              Everything Your Business{' '}
              <span className="gradient-text">Needs to Win Online</span>
            </h2>
            <p className="text-gray-500 text-lg leading-relaxed mb-10">
              We don't just build websites. We build growth engines, crafted for your specific industry and designed to turn visitors into customers.
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
              {features.map((feature, i) => {
                const FeatureIcon = feature.icon;
                return (
                  <div
                    key={feature.title}
                    className={`group flex items-start gap-3 p-4 rounded-2xl hover:bg-gray-50 transition-all duration-300 cursor-default section-reveal reveal-delay-${Math.min(i + 1, 6)} ${isVisible ? 'revealed' : ''}`}
                  >
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center flex-shrink-0 shadow-sm group-hover:scale-110 transition-transform`}>
                      <FeatureIcon size={16} className="text-white" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-primary text-sm">{feature.title}</h4>
                      <p className="text-gray-500 text-xs leading-relaxed mt-0.5">{feature.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
