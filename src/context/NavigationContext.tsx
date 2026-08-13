import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'article'; slug: string }
  | { name: 'category'; slug: string }
  | { name: 'product'; slug: string }
  | { name: 'privacy' }
  | { name: 'terms' }
  | { name: 'contact' }
  | { name: 'about' }
  | { name: 'notFound' };

interface NavigationContextType {
  route: Route;
  navigate: (route: Route) => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

function parsePath(): Route {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'blog' && parts[1]) return { name: 'article', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'category' && parts[1]) return { name: 'category', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'product' && parts[1]) return { name: 'product', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'privacy') return { name: 'privacy' };
  if (parts[0] === 'terms') return { name: 'terms' };
  if (parts[0] === 'contact') return { name: 'contact' };
  if (parts[0] === 'about') return { name: 'about' };
  return { name: 'notFound' };
}

function routeToPath(route: Route): string {
  switch (route.name) {
    case 'home': return '/';
    case 'article': return `/blog/${encodeURIComponent(route.slug)}`;
    case 'category': return `/category/${encodeURIComponent(route.slug)}`;
    case 'product': return `/product/${encodeURIComponent(route.slug)}`;
    case 'privacy': return '/privacy';
    case 'terms': return '/terms';
    case 'contact': return '/contact';
    case 'about': return '/about';
    case 'notFound': return '/not-found';
  }
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(parsePath());

  useEffect(() => {
    const onPopState = () => {
      setRoute(parsePath());
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (newRoute: Route) => {
    const path = routeToPath(newRoute);
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
      setRoute(newRoute);
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

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
