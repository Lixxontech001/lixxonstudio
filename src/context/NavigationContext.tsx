import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'article'; slug: string }
  | { name: 'category'; slug: string }
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

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#/, '');
  const parts = hash.split('/').filter(Boolean);

  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'blog' && parts[1]) return { name: 'article', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'category' && parts[1]) return { name: 'category', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'privacy') return { name: 'privacy' };
  if (parts[0] === 'terms') return { name: 'terms' };
  if (parts[0] === 'contact') return { name: 'contact' };
  if (parts[0] === 'about') return { name: 'about' };
  return { name: 'notFound' };
}

function routeToHash(route: Route): string {
  switch (route.name) {
    case 'home': return '';
    case 'article': return `blog/${encodeURIComponent(route.slug)}`;
    case 'category': return `category/${encodeURIComponent(route.slug)}`;
    case 'privacy': return 'privacy';
    case 'terms': return 'terms';
    case 'contact': return 'contact';
    case 'about': return 'about';
    case 'notFound': return 'not-found';
  }
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(parseHash());

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (newRoute: Route) => {
    const hash = routeToHash(newRoute);
    if (window.location.hash !== `#${hash}`) {
      window.location.hash = hash;
    } else {
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
