import { useState } from 'react';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import { ChevronDown, MessageCircle } from 'lucide-react';

const faqs = [
  { q: 'How much does a website cost?', a: "Every project is custom, so pricing depends on the size and complexity of your website. Our process starts with a free homepage design. Once you see and love it, we give you a clear, transparent quote for the full website with no hidden fees." },
  { q: 'How long does it take to build a website?', a: "Most websites are completed within 7 to 14 business days after approval of the homepage design. Larger projects like e-commerce stores may take 3 to 4 weeks. We always give you a clear timeline before starting." },
  { q: "What if I don't like the design?", a: "That is exactly why we offer the free homepage first. You can request as many revisions as you need until you love it. We don't proceed to development until you are 100% happy with the homepage design." },
  { q: 'Do I need any technical knowledge to manage my website?', a: "No technical skills required. We build your website on a user-friendly platform and provide a simple training session so you can update text, photos, and prices yourself. We also offer ongoing maintenance packages." },
  { q: 'Will my website show up on Google?', a: "Every website we build includes proper SEO foundations: clean code structure, meta tags, sitemaps, and Google Search Console setup. We also integrate Google Business Profile. Results improve over time with consistent use." },
  { q: 'Can you add WhatsApp and online booking to my website?', a: "Absolutely. WhatsApp integration, online booking systems, reservation forms, contact forms, and social media integration are all standard features we can include in your website." },
  { q: 'Do you work with businesses in my country?', a: "Yes. We work with businesses globally. Since everything is done digitally (design reviews, communication, payments), location doesn't matter. We currently serve clients across 12+ countries." },
  { q: "What happens after my website launches?", a: "We don't disappear after launch. We offer monthly maintenance packages that include security updates, content updates, backups, and priority support. We are your long-term digital partner." },
  { q: "I only use Facebook/Instagram, do I really need a website?", a: "Social media is rented land. Facebook can limit your reach, change its algorithm, or shut down your page anytime. A website is your own digital property that works 24/7, ranks on Google, and makes your business look established and trustworthy to customers who search for you." },
  { q: 'How do I get started?', a: 'Simply click "Get My Free Homepage Preview" and message us on WhatsApp. We will schedule a short discovery call, learn about your business, and start designing your homepage, completely free.' },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [ref, isVisible] = useIntersectionObserver({ threshold: 0.1 });

  return (
    <section
      id="faq"
      ref={ref as React.RefObject<HTMLElement>}
      className="py-28 bg-white relative"
    >
      <div className="max-w-4xl mx-auto px-6">
        <div className={`text-center mb-16 section-reveal ${isVisible ? 'revealed' : ''}`}>
          <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-accent-100 text-accent-600 text-xs font-semibold rounded-full tracking-widest uppercase mb-4">
            FAQ
          </span>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-primary leading-tight">
            Questions Business Owners{' '}
            <span className="gradient-text">Always Ask</span>
          </h2>
          <p className="mt-4 text-gray-500 text-lg max-w-xl mx-auto">
            Everything you need to know before making the best decision for your business.
          </p>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className={`border rounded-2xl overflow-hidden transition-all duration-300 section-reveal reveal-delay-${Math.min((i % 3) + 1, 6)} ${isVisible ? 'revealed' : ''} ${
                openIndex === i ? 'border-accent-200 shadow-md shadow-accent-100' : 'border-gray-100 hover:border-gray-200'
              }`}
            >
              <button
                className="w-full text-left px-6 py-5 flex items-center justify-between gap-4 group"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                <span className={`font-semibold text-base transition-colors ${openIndex === i ? 'text-accent-600' : 'text-primary group-hover:text-accent-600'}`}>
                  {faq.q}
                </span>
                <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300 ${
                  openIndex === i ? 'bg-accent-500 text-white rotate-180' : 'bg-gray-100 text-gray-400'
                }`}>
                  <ChevronDown size={16} />
                </div>
              </button>

              <div className={`faq-content ${openIndex === i ? 'open' : ''}`}>
                <p className="px-6 pb-5 text-gray-500 leading-relaxed text-sm border-t border-gray-50 pt-4">
                  {faq.a}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className={`mt-12 text-center section-reveal reveal-delay-4 ${isVisible ? 'revealed' : ''}`}>
          <p className="text-gray-500">Still have questions?</p>
          <a
            href="https://wa.me/2349040057383?text=Hi%20Lixxon%20Studio!%20I%20have%20a%20question."
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-accent-600 font-semibold hover:underline"
          >
            <MessageCircle size={16} />
            <span>Message us on WhatsApp, we reply within 2 hours</span>
          </a>
        </div>
      </div>
    </section>
  );
}
