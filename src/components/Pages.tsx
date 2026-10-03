import { useEffect } from 'react';
import { usePosts, useCategories, usePaginatedPosts } from '../hooks/useSupabase';
import Hero from './Hero';
import Newsletter from './Newsletter';
import ProductGrid from './ProductGrid';
import MagazineFeed from './MagazineFeed';
import EditorsPicks from './EditorsPicks';
import TrendingSection from './TrendingSection';
import PersonalizedRecommendations from './PersonalizedRecommendations';
import MostReadThisWeek from './MostReadThisWeek';
import EmptyState from './EmptyState';
import ContactForm from './ContactForm';
import CategoryBanner from './CategoryBanner';
import Pagination from './Pagination';
import { HeroSkeleton, FeedSkeleton } from './Skeletons';
import { useNavigation, Link } from '../context/NavigationContext';
import { Mail } from 'lucide-react';
import { Helmet } from 'react-helmet-async';

export function HomePage({ page }: { page: number }) {
  const { posts, loading } = usePosts();
  const { categories } = useCategories();
  const { navigate } = useNavigation();
  const { posts: paginatedPosts, totalPages, loading: pagLoading } = usePaginatedPosts(null, page);

  useEffect(() => { window.scrollTo(0, 0); }, [page]);

  const featured = posts.filter(p => p.featured);
  const editorsPicks = posts.filter(p => p.editors_pick);
  const heroPosts = featured.length > 0 ? featured : posts.slice(0, 4);
  const trendingPosts = posts.slice(0, 5);

  const buildRoute = (p: number) => ({ name: 'home' as const, page: p });

  return (
    <main>
      {loading ? <HeroSkeleton /> : <Hero featuredPosts={heroPosts} />}
      <Newsletter />
      {!loading && trendingPosts.length > 0 && <TrendingSection posts={trendingPosts} />}
      {!loading && editorsPicks.length > 0 && <EditorsPicks posts={editorsPicks} />}
      <ProductGrid />
      {!loading && <MostReadThisWeek />}
      {!loading && <PersonalizedRecommendations />}
      {pagLoading ? (
        <FeedSkeleton />
      ) : (
        <>
          <MagazineFeed
            posts={paginatedPosts}
            categories={categories}
            activeCategory={'all'}
            onCategoryChange={(slug) => slug === 'all' ? navigate({ name: 'home', page: 1 }) : navigate({ name: 'category', slug, page: 1 })}
          />
          {totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} buildRoute={buildRoute} />}
        </>
      )}
    </main>
  );
}

export function CategoryPage({ slug, page }: { slug: string; page: number }) {
  const { categories } = useCategories();
  const { navigate } = useNavigation();
  const { posts, total, totalPages, loading } = usePaginatedPosts(slug, page);

  useEffect(() => { window.scrollTo(0, 0); }, [slug, page]);

  const category = categories.find(c => c.slug === slug);

  if (!category && !loading) {
    return <EmptyState message="Category not found" />;
  }

  const buildRoute = (p: number) => ({ name: 'category' as const, slug, page: p });

  return (
    <main>
      {category && <CategoryBanner category={category} postCount={total} />}
      {loading ? <FeedSkeleton /> : posts.length === 0 ? (
        <EmptyState message="No stories in this category yet" />
      ) : (
        <>
          <MagazineFeed
            posts={posts}
            categories={categories}
            activeCategory={slug}
            onCategoryChange={(newSlug) => navigate({ name: 'category', slug: newSlug, page: 1 })}
          />
          <Pagination currentPage={page} totalPages={totalPages} buildRoute={buildRoute} />
          <Newsletter />
        </>
      )}
    </main>
  );
}

export function AboutPage() {
  return (
    <main>
      <Helmet>
        <title>About | Lixxon Studio</title>
        <meta name="description" content="A daily magazine for the slow living movement. Learn about our editorial team and mission." />
      </Helmet>
      <AboutContent />
      <Newsletter />
    </main>
  );
}

function AboutContent() {
  return (
    <section className="container-narrow py-16 md:py-24">
      <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Our Story</p>
      <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-charcoal font-light leading-[1.1] text-balance">
        A daily magazine for the slow living movement.
      </h1>

      <div className="article-prose mt-12">
        <p className="text-lg leading-relaxed">
          Lixxon Studio was founded on a simple belief: that beauty, style, and wellness are not separate pursuits but facets of a single, intentional life. In a world of ten-step routines and endless trends, we advocate for fewer, better choices — products and rituals that earn their place on your shelf and in your morning.
        </p>
        <p>
  Our editorial team translates the latest research into rituals you can actually follow. Every article is carefully researched, every product recommendation is considered, and every story is written to be read slowly, with a cup of coffee and a moment of quiet.
        </p>

        <h2>What We Cover</h2>
        <p>
          We write about skincare with a scientific lens, covering ingredients, concentrations, and protocols backed by dermatological research — not marketing claims. We cover style through the lens of timelessness rather than trend, building wardrobes that last for years, not weeks. And we approach wellness with a clinical yet holistic perspective, focusing on the foundational habits that actually move the needle: sleep, movement, nutrition, and stress management.
        </p>
        <p>
          Our coverage spans three core pillars. In <strong>Skincare</strong>, we break down the science of ingredients like retinol, vitamin C, and hyaluronic acid, explain how to build routines that work for your skin type, and review products with honesty and rigor. In <strong>Style</strong>, we explore capsule wardrobes, sustainable fabrics, and the art of dressing with intention. In <strong>Wellness</strong>, we examine the evidence behind supplements, sleep optimization, and mindfulness practices, separating what works from what is merely well-marketed.
        </p>

        <blockquote>
          We believe the best beauty routine is the one you can sustain. The best wardrobe is the one that makes you feel like yourself. And the best wellness practice is the one you return to, day after day.
        </blockquote>

        <h2>Our Editorial Standards</h2>
        <p>
          Every article published on Lixxon Studio is held to the same standard. We research our topics thoroughly, reference credible sources where applicable, and distinguish between established knowledge and emerging trends. We do not accept paid placements, and our affiliate relationships never influence which products we recommend — if we would not use it ourselves, we will not recommend it to you.
        </p>

        <h2>Our Promise</h2>
        <p>
          No clickbait. No fear-mongering. No ten-step routines you will abandon in a week. Just clear, expert guidance for a more intentional daily life, written by people who live and breathe this work.
        </p>

        <h2>The Daily Reset</h2>
        <p>
          Each morning, we publish a carefully edited selection of stories designed to be read in the time it takes to finish your coffee. The Daily Reset newsletter distills this further — a single email with the day's most worth-your-attention piece, delivered before your inbox fills with noise. We would love for you to join us.
        </p>

        <h2>Join Us</h2>
        <p>
          Whether you are starting your first skincare routine, refining a capsule wardrobe, or simply looking for a calmer morning, we are glad you are here. Explore our latest stories, subscribe to The Daily Reset, or reach out to our editorial team with a story you would like us to tell.
        </p>

        <div className="mt-8 not-prose flex flex-col sm:flex-row gap-4">
          <Link to={{ name: 'home', page: 1 }} className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm">
            Explore the Magazine
          </Link>
          <Link to={{ name: 'contact' }} className="inline-flex items-center justify-center gap-3 px-8 py-4 border border-charcoal text-charcoal text-xs tracking-editorial uppercase font-medium hover:bg-charcoal hover:text-white transition-all duration-500 rounded-sm">
            Get in Touch
          </Link>
        </div>
      </div>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <section className="container-narrow py-16 md:py-20">
      <Helmet>
        <title>Privacy Policy | Lixxon Studio</title>
      </Helmet>
      <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Legal</p>
      <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light">Privacy Policy</h1>
      <div className="article-prose mt-10">
        <p><em>Last updated: September 2026</em></p>
        <p>
          Lixxon Studio respects your privacy. This policy explains what information we collect, how we use it, and the choices you have.
        </p>
        <h2>Information We Collect</h2>
        <p>
          We collect your email address when you voluntarily subscribe to The Daily Reset newsletter. We also collect name and message content when you submit our contact form. We do not sell, rent, or share your personal information with third parties.
        </p>
        <h2>How We Use Your Information</h2>
        <p>
          Newsletter subscriptions are used exclusively to deliver our daily editorial content. Contact form submissions are used to respond to your inquiry and are not added to any marketing list.
        </p>
        <h2>Cookies</h2>
        <p>
          We use minimal cookies to improve site performance and understand reader preferences. We do not use cookies for targeted advertising.
        </p>
        <h2>Your Rights</h2>
        <p>
          You may unsubscribe from our newsletter at any time. You may request deletion of your data by contacting us at privacy@lixxonstudio.com.
        </p>
      </div>
    </section>
  );
}

export function TermsPage() {
  return (
    <section className="container-narrow py-16 md:py-20">
      <Helmet>
        <title>Terms of Service | Lixxon Studio</title>
      </Helmet>
      <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Legal</p>
      <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light">Terms of Service</h1>
      <div className="article-prose mt-10">
        <p><em>Last updated: September 2026</em></p>
        <p>
          By accessing Lixxon Studio, you agree to these terms. Our content is for informational purposes only and is not a substitute for professional medical or dermatological advice.
        </p>
        <h2>Content Ownership</h2>
        <p>
          All articles, photographs, and editorial content on Lixxon Studio are the property of Lixxon Studio and may not be reproduced without written permission.
        </p>
        <h2>Affiliate Disclosure</h2>
        <p>
          Some product links on Lixxon Studio may be affiliate links. If you purchase through these links, we may earn a commission at no additional cost to you. We only recommend products our editors genuinely use and endorse.
        </p>
        <h2>Limitation of Liability</h2>
        <p>
          Lixxon Studio is not liable for any damages arising from the use of information published on this site. Skincare and wellness routines involve personal health decisions that should be made in consultation with a qualified professional.
        </p>
      </div>
    </section>
  );
}

export function ContactPage() {
  return (
    <section className="container-narrow py-16 md:py-20">
      <Helmet>
        <title>Contact | Lixxon Studio</title>
        <meta name="description" content="Get in touch with our editorial team for story pitches, partnerships, or general inquiries." />
      </Helmet>
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
