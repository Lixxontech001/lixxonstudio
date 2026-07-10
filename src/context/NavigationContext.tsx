import { createContext, useContext, useState, useCallback } from 'react';

export type Page =
  | { type: 'home' }
  | { type: 'service'; slug: string }
  | { type: 'project'; slug: string };

interface NavigationContextType {
  currentPage: Page;
  navigate: (page: Page) => void;
  goHome: () => void;
}

const NavigationContext = createContext<NavigationContextType>({
  currentPage: { type: 'home' },
  navigate: () => {},
  goHome: () => {},
});

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [currentPage, setCurrentPage] = useState<Page>({ type: 'home' });

  const navigate = useCallback((page: Page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const goHome = useCallback(() => {
    setCurrentPage({ type: 'home' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <NavigationContext.Provider value={{ currentPage, navigate, goHome }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  return useContext(NavigationContext);
}
