import { usePosts, useCategories } from '../hooks/useSupabase';
import Hero from './Hero';
import Newsletter from './Newsletter';
import ProductGrid from './ProductGrid';
import MagazineFeed from './MagazineFeed';
import EditorsPicks from './EditorsPicks';
import EmptyState from './EmptyState';
import ContactForm from './ContactForm';
import { Mail } from 'lucide-react';
import { HeroSkeleton, FeedSkeleton } from './Skeletons';
import { useNavigation } from '../context/NavigationContext';
import { useState } from 'react';

export function HomePage() {
  const { posts, loading } = usePosts();
  const { categories } = useCategories();
  const [activeCategory, setActiveCategory] = useState('all');

  const featured = posts.filter(p => p.featured);
  const editorsPicks = posts.filter(p => p.editors_pick);
  const heroPosts = featured.length > 0 ? featured : posts.slice(0, 3);

  const filteredPosts = activeCategory === 'all'
    ? posts
    : posts.filter(p => p.category?.slug === activeCategory);

  return (
    <main>
      {loading ? <HeroSkeleton /> : <Hero featuredPosts={heroPosts} />}
      {!loading && editorsPicks.length > 0 && <EditorsPicks posts={editorsPicks} />}
      <Newsletter />
      <ProductGrid />
      {!loading && posts.length > 0 && (
        <MagazineFeed
          posts={filteredPosts}
          categories={categories}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
        />
      )}
    </main>
  );
}

export function CategoryPage({ slug }: { slug: string }) {
  const { posts, loading } = usePosts();
  const { categories } = useCategories();
  const { navigate } = useNavigation();
  const filtered = posts.filter(p => p.category?.slug === slug);

  const category = categories.find(c => c.slug === slug);
  const categoryName = category?.name || slug;
  const categoryDesc = category?.description;

  return (
    <main>
      <div className="container-narrow pt-16 pb-12 text-center">
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Category</p>
        <h1 className="font-serif text-4xl md:text-6xl text-charcoal font-light capitalize">{categoryName}</h1>
        {categoryDesc && <p className="text-charcoal-muted text-lg mt-5 leading-relaxed max-w-lg mx-auto">{categoryDesc}</p>}
      </div>

      {loading ? <FeedSkeleton /> : filtered.length === 0 ? (
        <EmptyState message="No stories in this category yet" />
      ) : (
        <>
          <MagazineFeed
            posts={filtered}
            categories={categories}
            activeCategory={slug}
            onCategoryChange={(newSlug) => navigate({ name: 'category', slug: newSlug })}
          />
          <Newsletter />
        </>
      )}
    </main>
  );
}

export function AboutPage() {
  const { posts, loading } = usePosts();

  return (
    <main>
      {loading ? <HeroSkeleton /> : posts.filter(p => p.featured).length > 0 ? (
        <Hero featuredPosts={posts.filter(p => p.featured).slice(0, 1)} />
      ) : null}
      <AboutContent />
      <Newsletter />
    </main>
  );
}

function AboutContent() {
  const { navigate } = useNavigation();

  return (
    <section className="container-narrow py-16 md:py-20">
      <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Our Story</p>
      <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-charcoal font-light leading-[1.1] text-balance">
        A daily magazine for the slow living movement.
      </h1>

      <div className="article-prose mt-12">
        <p className="text-lg leading-relaxed">
          Lixxon Studio was founded on a simple belief: that beauty, style, and wellness are not separate pursuits but facets of a single, intentional life. In a world of ten-step routines and endless trends, we advocate for fewer, better choices.
        </p>
        <p>
          Our editorial team, led by beauty editors, style directors, and clinical wellness experts, translates the latest research into rituals you can actually follow. Every article is fact-checked, every product recommendation is tested, and every story is written to be read slowly, with a cup of coffee and a moment of quiet.
        </p>

        <h2>What We Cover</h2>
        <p>
          We write about skincare with a scientific lens, covering ingredients, concentrations, and protocols backed by dermatological research. We cover style through the lens of timelessness rather than trend. And we approach wellness with a clinical yet holistic perspective, focusing on the foundational habits that actually move the needle.
        </p>

        <blockquote>
          We believe the best beauty routine is the one you can sustain. The best wardrobe is the one that makes you feel like yourself. And the best wellness practice is the one you return to, day after day.
        </blockquote>

        <h2>Our Promise</h2>
        <p>
          No clickbait. No fear-mongering. No ten-step routines you will abandon in a week. Just clear, expert guidance for a more intentional daily life, written by people who live and breathe this work.
        </p>

        <h2>Join Us</h2>
        <p>
          Whether you are starting your first skincare routine, refining a capsule wardrobe, or simply looking for a calmer morning, we are glad you are here. Explore our latest stories below, or subscribe to The Daily Reset for a curated edit in your inbox each morning.
        </p>

        <div className="mt-8 not-prose">
          <button
            onClick={() => navigate({ name: 'home' })}
            className="inline-flex items-center gap-3 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm"
          >
            Explore the Magazine
          </button>
        </div>
      </div>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <section className="container-narrow py-16 md:py-20">
      <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Legal</p>
      <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light">Privacy Policy</h1>
      <div className="article-prose mt-10">
        <p><em>Last updated: August 2026</em></p>
        <p>
          Lixxon Studio respects your privacy. This policy explains what information we collect, how we use it, and the choices you have. We collect email addresses when you subscribe to our newsletter, and we use them solely to send you our daily editorial content.
        </p>
        <h2>Information We Collect</h2>
        <p>
          We collect your email address when you voluntarily subscribe to The Daily Reset newsletter. We also collect name and message content when you submit our contact form. We do not sell, rent, or share your personal information with third parties. We may use anonymized analytics to understand which articles are most read.
        </p>
        <h2>How We Use Your Information</h2>
        <p>
          Newsletter subscriptions are used exclusively to deliver our daily editorial content and occasional editorial announcements. Contact form submissions are used to respond to your inquiry and are not added to any marketing list.
        </p>
        <h2>Cookies</h2>
        <p>
          We use minimal cookies to improve site performance and understand reader preferences. We do not use cookies for targeted advertising.
        </p>
        <h2>Your Rights</h2>
        <p>
          You may unsubscribe from our newsletter at any time by clicking the unsubscribe link in any email. You may request deletion of your data by contacting us at privacy@lixxonstudio.com. We will process your request within 30 days.
        </p>
        <h2>Contact</h2>
        <p>
          Questions about this policy can be sent to privacy@lixxonstudio.com. We are committed to resolving any privacy concerns promptly and transparently.
        </p>
      </div>
    </section>
  );
}

export function TermsPage() {
  return (
    <section className="container-narrow py-16 md:py-20">
      <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Legal</p>
      <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light">Terms of Service</h1>
      <div className="article-prose mt-10">
        <p><em>Last updated: August 2026</em></p>
        <p>
          By accessing Lixxon Studio, you agree to these terms. Our content is for informational purposes only and is not a substitute for professional medical or dermatological advice. Always consult a qualified professional before starting any skincare or wellness routine.
        </p>
        <h2>Content Ownership</h2>
        <p>
          All articles, photographs, and editorial content on Lixxon Studio are the property of Lixxon Studio and may not be reproduced, distributed, or republished without written permission. Excerpts and links may be shared with appropriate attribution.
        </p>
        <h2>Affiliate Disclosure</h2>
        <p>
          Some product links on Lixxon Studio may be affiliate links. If you purchase through these links, we may earn a commission at no additional cost to you. We only recommend products our editors genuinely use and endorse. Affiliate relationships do not influence our editorial coverage.
        </p>
        <h2>User Conduct</h2>
        <p>
          When submitting forms or contacting our team, you agree to provide accurate information and to use our contact channels respectfully. We reserve the right to disregard submissions that contain abusive, promotional, or irrelevant content.
        </p>
        <h2>Limitation of Liability</h2>
        <p>
          Lixxon Studio is not liable for any damages arising from the use of information published on this site. Skincare and wellness routines involve personal health decisions that should be made in consultation with a qualified professional.
        </p>
        <h2>Changes to These Terms</h2>
        <p>
          We may update these terms from time to time. Continued use of the site after changes constitutes acceptance of the updated terms. We encourage you to review this page periodically.
        </p>
      </div>
    </section>
  );
}

export function ContactPage() {
  return (
    <section className="container-narrow py-16 md:py-20">
      <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Get In Touch</p>
      <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light">Contact Us</h1>
      <p className="text-charcoal-muted text-lg mt-5 leading-relaxed max-w-lg">
        Have a question, a story idea, or a product you would like us to review? We would love to hear from you. Our editorial team reads every message.
      </p>

      <div className="grid lg:grid-cols-3 gap-12 mt-12">
        <div className="lg:col-span-2">
          <ContactForm />
        </div>
        <div className="space-y-4">
          <ContactInfoCard label="Editorial" email="editorial@lixxonstudio.com" desc="For story pitches and editorial inquiries." />
          <ContactInfoCard label="Partnerships" email="partners@lixxonstudio.com" desc="For brand collaborations and affiliate partnerships." />
          <ContactInfoCard label="General" email="hello@lixxonstudio.com" desc="For everything else." />
        </div>
      </div>
    </section>
  );
}

function ContactInfoCard({ label, email, desc }: { label: string; email: string; desc: string }) {
  return (
    <div className="border border-taupe/40 rounded-sm p-6 bg-porcelain">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-taupe-light mb-3">
        <Mail size={16} strokeWidth={1.5} className="text-bronze" />
      </div>
      <p className="text-[10px] tracking-editorial uppercase text-bronze mb-1">{label}</p>
      <p className="font-serif text-base text-charcoal">{email}</p>
      <p className="text-sm text-charcoal-muted mt-2 leading-relaxed">{desc}</p>
    </div>
  );
}
