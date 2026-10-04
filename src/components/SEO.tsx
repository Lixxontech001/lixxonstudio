import { Helmet } from 'react-helmet-async';
import { useNavigation } from '../context/NavigationContext';
import { usePostBySlug, useCategories, useProducts } from '../hooks/useSupabase';
import { useSiteConfig } from '../hooks/useSiteConfig';

const SITE_NAME = 'Lixxon Studio';
const SITE_URL = typeof window !== 'undefined' ? window.location.origin : 'https://lixxonstudio.com';
const DEFAULT_DESCRIPTION = 'A daily digital magazine covering skincare science, intentional style, and minimalist wellness. Expert-written, beautifully edited.';

export default function SEO() {
  const { route } = useNavigation();
  const slug = route.name === 'article' ? route.slug : null;
  const { post } = usePostBySlug(slug);
  const { categories } = useCategories();
  const { products } = useProducts();
  const { config } = useSiteConfig();
  // Admin → Front end → SEO holds the site-wide defaults; a page-level value always wins.
  const seo = config.seo_defaults || {};
  const suffix = seo.title_suffix || ` | ${SITE_NAME}`;

  let title = `${SITE_NAME} — Skincare, Style & Wellness`;
  let description = seo.description || DEFAULT_DESCRIPTION;
  let image = '';
  let url = SITE_URL;

  if (route.name === 'article' && post) {
    title = `${post.seo_title || post.title} | ${SITE_NAME}`;
    description = post.seo_description || post.excerpt || DEFAULT_DESCRIPTION;
    image = post.cover_image || '';
    url = post.canonical_url || `${SITE_URL}/blog/${post.slug}`;
  } else if (route.name === 'category') {
    const cat = categories.find(c => c.slug === route.slug);
    const catName = cat?.name || route.slug;
    title = `${catName} Articles | ${SITE_NAME}`;
    description = `Explore ${catName.toLowerCase()} articles on ${SITE_NAME}. ${DEFAULT_DESCRIPTION}`;
    url = `${SITE_URL}/category/${route.slug}`;
  } else if (route.name === 'search') {
    title = route.query ? `Search: ${route.query} | ${SITE_NAME}` : `Search | ${SITE_NAME}`;
    description = `Search results on ${SITE_NAME}`;
    url = `${SITE_URL}/search?q=${encodeURIComponent(route.query)}`;
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
  } else if (route.name === 'shop') {
    title = `Shop | ${SITE_NAME}`;
    description = `Digital guides and curated essentials from ${SITE_NAME}. Skincare routines, style guides, and wellness resources.`;
    url = `${SITE_URL}/shop`;
  } else if (route.name === 'shop-category') {
    title = `Shop: ${route.slug} | ${SITE_NAME}`;
    description = `Browse ${route.slug} products in the ${SITE_NAME} shop.`;
    url = `${SITE_URL}/shop/category/${route.slug}`;
  } else if (route.name === 'shop-product') {
    const product = products.find(p => p.slug === route.slug);
    if (product) {
      title = `${product.name} | ${SITE_NAME}`;
      description = product.description || DEFAULT_DESCRIPTION;
      image = product.image_url || '';
      url = `${SITE_URL}/shop/product/${route.slug}`;
    } else {
      title = `Shop | ${SITE_NAME}`;
      url = `${SITE_URL}/shop/product/${route.slug}`;
    }
  } else if (route.name === 'collections') {
    title = `Collections | ${SITE_NAME}`;
    description = `Curated editorial collections from ${SITE_NAME} — themed guides for intentional living.`;
    url = `${SITE_URL}/collections`;
  } else if (route.name === 'collection') {
    title = `Collection | ${SITE_NAME}`;
    description = `Explore this curated collection of articles from ${SITE_NAME}.`;
    url = `${SITE_URL}/collections/${route.slug}`;
  } else if (route.name === 'cart') {
    title = `Cart | ${SITE_NAME} Shop`;
    url = `${SITE_URL}/shop/cart`;
  } else if (route.name === 'wishlist') {
    title = `Wishlist | ${SITE_NAME} Shop`;
    url = `${SITE_URL}/shop/wishlist`;
  } else if (route.name === 'account') {
    title = `Account | ${SITE_NAME}`;
    url = `${SITE_URL}/account`;
  } else if (route.name === 'notFound') {
    title = `Page Not Found | ${SITE_NAME}`;
  }

  if (suffix !== ` | ${SITE_NAME}`) {
    const fixed = ` | ${SITE_NAME}`;
    if (title.endsWith(fixed)) title = title.slice(0, -fixed.length) + suffix;
  }
  if (!image && seo.og_image) image = seo.og_image;

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
      {seo.twitter && <meta name="twitter:site" content={seo.twitter} />}
      {route.name === 'home' && seo.robots && <meta name="robots" content={seo.robots} />}
      {route.name.startsWith('admin') && <meta name="robots" content="noindex, nofollow" />}
      {route.name === 'search' && <meta name="robots" content="noindex, follow" />}
      {(route.name === 'cart' || route.name === 'wishlist' || route.name === 'account' || route.name === 'account-orders' || route.name === 'account-downloads' || route.name === 'checkout') && <meta name="robots" content="noindex, nofollow" />}
    </Helmet>
  );
}
