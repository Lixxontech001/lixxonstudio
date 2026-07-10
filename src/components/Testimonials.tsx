import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import { Star } from 'lucide-react';

const testimonials = [
  {
    name: 'Marcus Thompson',
    role: 'Owner, Savoria Restaurant',
    avatar: 'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    text: 'Before Lixxon Studio, we relied entirely on Instagram for bookings. Within 60 days of our new website launching, our online reservations tripled. The design is absolutely stunning and customers compliment us on it constantly.',
    rating: 5,
    result: '+180% online reservations',
    industry: 'Restaurant',
  },
  {
    name: 'Dr. Sarah Chen',
    role: 'Director, MedCore Clinic',
    avatar: 'https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    text: 'Our old website was driving patients away. The new one immediately communicates trust and professionalism. Patient inquiries doubled in the first month, and we now get 90% of new patient appointments through the website.',
    rating: 5,
    result: '+200% patient inquiries',
    industry: 'Healthcare',
  },
  {
    name: 'James Okafor',
    role: 'GM, Azure Crest Hotel',
    avatar: 'https://images.pexels.com/photos/1681010/pexels-photo-1681010.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    text: 'The booking system they built for us paid for the entire website in the first month alone. We used to lose guests to OTA platforms. Now we capture direct bookings and save on commission fees every single week.',
    rating: 5,
    result: '+240% direct bookings',
    industry: 'Hospitality',
  },
  {
    name: 'Priya Sharma',
    role: 'Owner, Luxe Salon and Spa',
    avatar: 'https://images.pexels.com/photos/1130626/pexels-photo-1130626.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    text: 'I was nervous about investing in a website, so the free homepage preview completely won me over. I could see exactly what I was getting before committing. The final website is beyond what I imagined, it looks like a luxury brand.',
    rating: 5,
    result: '+210% bookings',
    industry: 'Beauty',
  },
  {
    name: 'Robert Harrington',
    role: 'Partner, Sterling Law Group',
    avatar: 'https://images.pexels.com/photos/2182970/pexels-photo-2182970.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    text: 'In the legal industry, first impressions are everything. Our new website positioned us as the premium choice in our city. Clients frequently say they chose us over competitors specifically because our website looked the most professional.',
    rating: 5,
    result: '+150% consultations',
    industry: 'Legal',
  },
  {
    name: 'Nina Kowalski',
    role: 'CEO, Atelier Fashion',
    avatar: 'https://images.pexels.com/photos/1065084/pexels-photo-1065084.jpeg?auto=compress&cs=tinysrgb&w=100&h=100&fit=crop',
    text: 'We went from selling through Instagram DMs to a full e-commerce website with automated checkout. Revenue grew 280% in 4 months. Lixxon Studio understood our brand aesthetic perfectly from day one.',
    rating: 5,
    result: '+280% online revenue',
    industry: 'Fashion',
  },
];

export default function Testimonials() {
  const [ref, isVisible] = useIntersectionObserver({ threshold: 0.1 });

  return (
    <section
      id="testimonials"
      ref={ref as React.RefObject<HTMLElement>}
      className="py-28 bg-gray-50 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className={`text-center mb-16 section-reveal ${isVisible ? 'revealed' : ''}`}>
          <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-accent-100 text-accent-600 text-xs font-semibold rounded-full tracking-widest uppercase mb-4">
            Real Results
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-primary leading-tight">
            Businesses That Made the{' '}
            <span className="gradient-text">Right Decision</span>
          </h2>
          <p className="mt-4 text-gray-500 text-lg max-w-2xl mx-auto">
            Don't take our word for it, here's what business owners say after working with us.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <div
              key={t.name}
              className={`group bg-white rounded-3xl p-7 border border-gray-100 shadow-sm card-hover section-reveal reveal-delay-${Math.min(i + 1, 6)} ${isVisible ? 'revealed' : ''}`}
            >
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <img src={t.avatar} alt={t.name} className="w-12 h-12 rounded-2xl object-cover" loading="lazy" />
                  <div>
                    <div className="font-semibold text-primary text-sm">{t.name}</div>
                    <div className="text-gray-400 text-xs">{t.role}</div>
                  </div>
                </div>
                <span className="text-[10px] font-semibold px-2.5 py-1 bg-accent-50 text-accent-600 rounded-full">{t.industry}</span>
              </div>

              <div className="flex items-center gap-0.5">
                {[...Array(t.rating)].map((_, i) => (
                  <Star key={i} size={14} fill="#F59E0B" className="text-amber-400" />
                ))}
              </div>

              <p className="mt-4 text-gray-600 text-sm leading-relaxed">&ldquo;{t.text}&rdquo;</p>

              <div className="mt-5 pt-5 border-t border-gray-50 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-green-700 font-semibold text-xs">{t.result}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={`mt-16 flex flex-wrap items-center justify-center gap-8 section-reveal reveal-delay-4 ${isVisible ? 'revealed' : ''}`}>
          {[
            { value: '4.9/5', label: 'Average Rating' },
            { value: '127', label: 'Verified Reviews' },
            { value: '98%', label: 'Would Recommend' },
            { value: '0', label: 'Refund Requests' },
          ].map((stat, i) => (
            <div key={i} className="text-center">
              <div className="font-display font-bold text-3xl text-primary">{stat.value}</div>
              <div className="text-gray-400 text-xs mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
