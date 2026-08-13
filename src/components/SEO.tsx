import { Helmet } from 'react-helmet-async';
import { useNavigation } from '../context/NavigationContext';
import { usePostBySlug, usePosts } from '../hooks/useSupabase';

const SITE_NAME = 'Lixxon Studio';
const SITE_URL = typeof window !== 'undefined' ? window.location.origin : 'https://lixxonstudio.com';
const DEFAULT_DESCRIPTION = 'A daily digital magazine covering skincare science, intentional style, and minimalist wellness. Expert-written, beautifully edited.';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export default function SEO() {
  const { route } = useNavigation();
  const slug = route.name === 'article' ? route.slug : null;
  const { post } = usePostBySlug(slug);
  const { posts } = usePosts();

  let title = `${SITE_NAME} — Skincare, Style & Wellness`;
  let description = DEFAULT_DESCRIPTION;
  let image = '';
  let url = SITE_URL;

  if (route.name === 'article' && post) {
    title = `${post.title} | ${SITE_NAME}`;
    description = post.excerpt || DEFAULT_DESCRIPTION;
    image = post.cover_image || '';
    url = `${SITE_URL}/blog/${post.slug}`;
  } else if (route.name === 'category') {
    const cat = post?.category;
    const catName = cat?.name || route.slug;
    title = `${catName} Articles | ${SITE_NAME}`;
    description = `Explore ${catName.toLowerCase()} articles on ${SITE_NAME}. ${DEFAULT_DESCRIPTION}`;
    url = `${SITE_URL}/category/${route.slug}`;
  } else if (route.name === 'about') {
    title = `About | ${SITE_NAME}`;
    description = `A daily magazine for the slow living movement. Learn about our editorial team and mission.`;
    url = `${SITE_URL}/about`;
  } else if (route.name === 'contact') {
    title = `Contact | ${SITE_NAME}`;
    description = `Get in touch with our editorial team for story pitches, partnerships, or general inquiries.`;
    url = `${SITE_URL}/contact`;
  } else if (route.name === 'privacy') {
    title = `Privacy Policy | ${SITE_NAME}`;
    url = `${SITE_URL}/privacy`;
  } else if (route.name === 'terms') {
    title = `Terms of Service | ${SITE_NAME}`;
    url = `${SITE_URL}/terms`;
  } else if (route.name === 'product') {
    const product = posts.find(p => slugify(p.title) === route.slug);
    if (product) {
      title = `${product.title} | ${SITE_NAME}`;
      description = product.excerpt || DEFAULT_DESCRIPTION;
      image = product.cover_image || '';
      url = `${SITE_URL}/product/${route.slug}`;
    }
  } else if (route.name === 'notFound') {
    title = `Page Not Found | ${SITE_NAME}`;
  }

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={route.name === 'article' ? 'article' : 'website'} />
      {image && <meta property="og:image" content={image} />}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {image && <meta name="twitter:image" content={image} />}
    </Helmet>
  );
}
