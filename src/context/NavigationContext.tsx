import { createContext, useContext, useState, useEffect, useCallback, type ReactNode, type MouseEvent } from 'react';

export type Route =
  | { name: 'home'; page: number }
  | { name: 'article'; slug: string }
  | { name: 'category'; slug: string; page: number }
  | { name: 'product'; slug: string }
  | { name: 'search'; query: string; page: number }
  | { name: 'privacy' }
  | { name: 'terms' }
  | { name: 'contact' }
  | { name: 'about' }
  | { name: 'shop' }
  | { name: 'shop-category'; slug: string }
  | { name: 'shop-product'; slug: string }
  | { name: 'cart' }
  | { name: 'checkout' }
  | { name: 'wishlist' }
  | { name: 'account' }
  | { name: 'account-orders' }
  | { name: 'account-downloads' }
  | { name: 'collections' }
  | { name: 'collection'; slug: string }
  | { name: 'admin' }
  | { name: 'admin-login' }
  | { name: 'admin-dashboard' }
  | { name: 'admin-articles' }
  | { name: 'admin-article-edit'; id: string }
  | { name: 'admin-article-new' }
  | { name: 'admin-categories' }
  | { name: 'admin-authors' }
  | { name: 'admin-comments' }
  | { name: 'admin-media' }
  | { name: 'admin-featured' }
  | { name: 'admin-messages' }
  | { name: 'admin-settings' }
  | { name: 'admin-products' }
  | { name: 'admin-product-edit'; id: string }
  | { name: 'admin-product-new' }
  | { name: 'admin-orders' }
  | { name: 'admin-customers' }
  | { name: 'admin-collections' }
  | { name: 'admin-collection-edit'; id: string }
  | { name: 'admin-collection-new' }
  | { name: 'admin-newsletter' }
  | { name: 'admin-analytics' }
  | { name: 'admin-sponsored' }
  | { name: 'reading-history' }
  | { name: 'bookmarks' }
  | { name: 'author'; slug: string }
  | { name: 'tag'; tag: string; page: number }
  | { name: 'weekly-digest' }
  | { name: 'newsletter-preferences' }
  | { name: 'reading-lists' }
  | { name: 'gift-cards' }
  | { name: 'order-tracking'; orderNumber: string }
  | { name: 'product-comparison' }
  | { name: 'admin-promo-codes' }
  | { name: 'admin-reviews' }
  | { name: 'admin-polls' }
  | { name: 'admin-refunds' }
  | { name: 'admin-abandoned-carts' }
  | { name: 'admin-activity-log' }
  | { name: 'admin-content-templates' }
  | { name: 'admin-gift-cards' }
  | { name: 'admin-feedback' }
  | { name: 'admin-social-shares' }
  | { name: 'admin-subscribers-prefs' }
  | { name: 'notFound' };

interface NavigationContextType {
  route: Route;
  navigate: (route: Route) => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

function parsePath(): Route {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(window.location.search);

  if (parts.length === 0) return { name: 'home', page: parseInt(params.get('page') || '1', 10) };
  if (parts[0] === 'blog' && parts[1]) return { name: 'article', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'category' && parts[1]) return { name: 'category', slug: decodeURIComponent(parts[1]), page: parseInt(params.get('page') || '1', 10) };
  if (parts[0] === 'product' && parts[1]) return { name: 'product', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'search') return { name: 'search', query: params.get('q') || '', page: parseInt(params.get('page') || '1', 10) };
  if (parts[0] === 'reading-history') return { name: 'reading-history' };
  if (parts[0] === 'bookmarks') return { name: 'bookmarks' };
  if (parts[0] === 'author' && parts[1]) return { name: 'author', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'tag' && parts[1]) return { name: 'tag', tag: decodeURIComponent(parts[1]), page: parseInt(params.get('page') || '1', 10) };
  if (parts[0] === 'weekly-digest') return { name: 'weekly-digest' };
  if (parts[0] === 'newsletter-preferences') return { name: 'newsletter-preferences' };
  if (parts[0] === 'reading-lists') return { name: 'reading-lists' };
  if (parts[0] === 'gift-cards') return { name: 'gift-cards' };
  if (parts[0] === 'order-tracking') return { name: 'order-tracking', orderNumber: params.get('order') || parts[1] || '' };
  if (parts[0] === 'product-comparison') return { name: 'product-comparison' };
  if (parts[0] === 'privacy') return { name: 'privacy' };
  if (parts[0] === 'terms') return { name: 'terms' };
  if (parts[0] === 'contact') return { name: 'contact' };
  if (parts[0] === 'about') return { name: 'about' };
  if (parts[0] === 'shop') {
    if (parts[1] === 'category' && parts[2]) return { name: 'shop-category', slug: decodeURIComponent(parts[2]) };
    if (parts[1] === 'cart') return { name: 'cart' };
    if (parts[1] === 'checkout') return { name: 'checkout' };
    if (parts[1] === 'wishlist') return { name: 'wishlist' };
    if (parts[1] === 'product' && parts[2]) return { name: 'shop-product', slug: decodeURIComponent(parts[2]) };
    return { name: 'shop' };
  }
  if (parts[0] === 'account') {
    if (parts[1] === 'orders') return { name: 'account-orders' };
    if (parts[1] === 'downloads') return { name: 'account-downloads' };
    return { name: 'account' };
  }
  if (parts[0] === 'collections') {
    if (parts[1]) return { name: 'collection', slug: decodeURIComponent(parts[1]) };
    return { name: 'collections' };
  }
  if (parts[0] === 'admin') {
    if (parts[1] === 'login') return { name: 'admin-login' };
    if (parts[1] === 'articles' && parts[2] === 'new') return { name: 'admin-article-new' };
    if (parts[1] === 'articles' && parts[2] === 'edit' && parts[3]) return { name: 'admin-article-edit', id: parts[3] };
    if (parts[1] === 'articles') return { name: 'admin-articles' };
    if (parts[1] === 'categories') return { name: 'admin-categories' };
    if (parts[1] === 'authors') return { name: 'admin-authors' };
    if (parts[1] === 'comments') return { name: 'admin-comments' };
    if (parts[1] === 'media') return { name: 'admin-media' };
    if (parts[1] === 'featured') return { name: 'admin-featured' };
    if (parts[1] === 'messages') return { name: 'admin-messages' };
    if (parts[1] === 'settings') return { name: 'admin-settings' };
    if (parts[1] === 'products' && parts[2] === 'new') return { name: 'admin-product-new' };
    if (parts[1] === 'products' && parts[2] === 'edit' && parts[3]) return { name: 'admin-product-edit', id: parts[3] };
    if (parts[1] === 'products') return { name: 'admin-products' };
    if (parts[1] === 'orders') return { name: 'admin-orders' };
    if (parts[1] === 'customers') return { name: 'admin-customers' };
    if (parts[1] === 'collections' && parts[2] === 'new') return { name: 'admin-collection-new' };
    if (parts[1] === 'collections' && parts[2] === 'edit' && parts[3]) return { name: 'admin-collection-edit', id: parts[3] };
    if (parts[1] === 'collections') return { name: 'admin-collections' };
    if (parts[1] === 'newsletter') return { name: 'admin-newsletter' };
    if (parts[1] === 'analytics') return { name: 'admin-analytics' };
    if (parts[1] === 'sponsored') return { name: 'admin-sponsored' };
    if (parts[1] === 'promo-codes') return { name: 'admin-promo-codes' };
    if (parts[1] === 'reviews') return { name: 'admin-reviews' };
    if (parts[1] === 'polls') return { name: 'admin-polls' };
    if (parts[1] === 'refunds') return { name: 'admin-refunds' };
    if (parts[1] === 'abandoned-carts') return { name: 'admin-abandoned-carts' };
    if (parts[1] === 'activity-log') return { name: 'admin-activity-log' };
    if (parts[1] === 'content-templates') return { name: 'admin-content-templates' };
    if (parts[1] === 'gift-cards') return { name: 'admin-gift-cards' };
    if (parts[1] === 'feedback') return { name: 'admin-feedback' };
    if (parts[1] === 'social-shares') return { name: 'admin-social-shares' };
    if (parts[1] === 'subscribers-prefs') return { name: 'admin-subscribers-prefs' };
    if (parts[1] === 'dashboard' || !parts[1]) return { name: 'admin-dashboard' };
    return { name: 'admin-dashboard' };
  }
  return { name: 'notFound' };
}

export function routeToPath(route: Route): string {
  switch (route.name) {
    case 'home': {
      const qs = route.page > 1 ? `?page=${route.page}` : '';
      return qs ? `/${qs}` : '/';
    }
    case 'article': return `/blog/${encodeURIComponent(route.slug)}`;
    case 'category': {
      const qs = route.page > 1 ? `?page=${route.page}` : '';
      return `/category/${encodeURIComponent(route.slug)}${qs}`;
    }
    case 'product': return `/product/${encodeURIComponent(route.slug)}`;
    case 'search': {
      const params = new URLSearchParams();
      if (route.query) params.set('q', route.query);
      if (route.page > 1) params.set('page', String(route.page));
      const qs = params.toString();
      return qs ? `/search?${qs}` : '/search';
    }
    case 'privacy': return '/privacy';
    case 'terms': return '/terms';
    case 'contact': return '/contact';
    case 'about': return '/about';
    case 'shop': return '/shop';
    case 'shop-category': return `/shop/category/${encodeURIComponent(route.slug)}`;
    case 'shop-product': return `/shop/product/${encodeURIComponent(route.slug)}`;
    case 'cart': return '/shop/cart';
    case 'checkout': return '/shop/checkout';
    case 'wishlist': return '/shop/wishlist';
    case 'account': return '/account';
    case 'account-orders': return '/account/orders';
    case 'account-downloads': return '/account/downloads';
    case 'collections': return '/collections';
    case 'collection': return `/collections/${encodeURIComponent(route.slug)}`;
    case 'admin': return '/admin';
    case 'admin-login': return '/admin/login';
    case 'admin-dashboard': return '/admin/dashboard';
    case 'admin-articles': return '/admin/articles';
    case 'admin-article-new': return '/admin/articles/new';
    case 'admin-article-edit': return `/admin/articles/edit/${route.id}`;
    case 'admin-categories': return '/admin/categories';
    case 'admin-authors': return '/admin/authors';
    case 'admin-comments': return '/admin/comments';
    case 'admin-media': return '/admin/media';
    case 'admin-featured': return '/admin/featured';
    case 'admin-messages': return '/admin/messages';
    case 'admin-settings': return '/admin/settings';
    case 'admin-products': return '/admin/products';
    case 'admin-product-new': return '/admin/products/new';
    case 'admin-product-edit': return `/admin/products/edit/${route.id}`;
    case 'admin-orders': return '/admin/orders';
    case 'admin-customers': return '/admin/customers';
    case 'admin-collections': return '/admin/collections';
    case 'admin-collection-new': return '/admin/collections/new';
    case 'admin-collection-edit': return `/admin/collections/edit/${route.id}`;
    case 'admin-newsletter': return '/admin/newsletter';
    case 'admin-analytics': return '/admin/analytics';
    case 'admin-sponsored': return '/admin/sponsored';
    case 'reading-history': return '/reading-history';
    case 'bookmarks': return '/bookmarks';
    case 'author': return `/author/${encodeURIComponent(route.slug)}`;
    case 'tag': {
      const qs = route.page > 1 ? `?page=${route.page}` : '';
      return `/tag/${encodeURIComponent(route.tag)}${qs}`;
    }
    case 'weekly-digest': return '/weekly-digest';
    case 'newsletter-preferences': return '/newsletter-preferences';
    case 'reading-lists': return '/reading-lists';
    case 'gift-cards': return '/gift-cards';
    case 'order-tracking': return `/order-tracking?order=${encodeURIComponent(route.orderNumber)}`;
    case 'product-comparison': return '/product-comparison';
    case 'admin-promo-codes': return '/admin/promo-codes';
    case 'admin-reviews': return '/admin/reviews';
    case 'admin-polls': return '/admin/polls';
    case 'admin-refunds': return '/admin/refunds';
    case 'admin-abandoned-carts': return '/admin/abandoned-carts';
    case 'admin-activity-log': return '/admin/activity-log';
    case 'admin-content-templates': return '/admin/content-templates';
    case 'admin-gift-cards': return '/admin/gift-cards';
    case 'admin-feedback': return '/admin/feedback';
    case 'admin-social-shares': return '/admin/social-shares';
    case 'admin-subscribers-prefs': return '/admin/subscribers-prefs';
    case 'notFound': return '/not-found';
  }
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(parsePath());

  useEffect(() => {
    const onPopState = () => setRoute(parsePath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((newRoute: Route) => {
    const path = routeToPath(newRoute);
    if (window.location.pathname + window.location.search !== path) {
      window.history.pushState({}, '', path);
      setRoute(newRoute);
    }
  }, []);

  return (
    <NavigationContext.Provider value={{ route, navigate }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
  return ctx;
}

interface LinkProps {
  to: Route;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  ariaLabel?: string;
  title?: string;
}

export function Link({ to, children, className, onClick, ariaLabel, title }: LinkProps) {
  const { navigate } = useNavigation();
  const href = routeToPath(to);

  const handleClick = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    navigate(to);
    if (onClick) onClick();
    if (to.name !== 'admin-article-edit' && to.name.startsWith('admin')) {
      // admin pages manage their own scroll
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [navigate, to, onClick]);

  return (
    <a href={href} onClick={handleClick} className={className} aria-label={ariaLabel} title={title}>
      {children}
    </a>
  );
}
