import { lazy, Suspense, useEffect } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { Analytics } from '@vercel/analytics/react';
import { useNavigation } from './context/NavigationContext';
import Header from './components/Header';
import Footer from './components/Footer';
import BackToTop from './components/BackToTop';
import SEO from './components/SEO';
import { HeroSkeleton, FeedSkeleton } from './components/Skeletons';
import CartDrawer from './components/shop/CartDrawer';
import CookieConsent from './components/CookieConsent';
import FeedbackWidget from './components/FeedbackWidget';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { WishlistProvider } from './context/WishlistContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { HomePage, CategoryPage, AboutPage, PrivacyPage, TermsPage, ContactPage } from './components/Pages';

const ArticleReader = lazy(() => import('./components/ArticleReader'));
const ProductDetail = lazy(() => import('./components/ProductDetail'));
const SearchPage = lazy(() => import('./components/SearchPage'));
const NotFoundPage = lazy(() => import('./components/NotFoundPage'));
const ShopPage = lazy(() => import('./components/shop/ShopPage'));
const ShopProductPage = lazy(() => import('./components/shop/ShopProductPage'));
const ShopCategoryPage = lazy(() => import('./components/shop/ShopCategoryPage'));
const CartPage = lazy(() => import('./components/shop/CartPage'));
const CheckoutPage = lazy(() => import('./components/shop/CheckoutPage'));
const WishlistPage = lazy(() => import('./components/shop/WishlistPage'));
const AccountPage = lazy(() => import('./components/shop/AccountPage'));
const AccountOrdersPage = lazy(() => import('./components/shop/AccountOrdersPage'));
const AccountDownloadsPage = lazy(() => import('./components/shop/AccountDownloadsPage'));
const CollectionsPage = lazy(() => import('./components/shop/CollectionsPage'));
const CollectionDetailPage = lazy(() => import('./components/shop/CollectionDetailPage'));
const ReadingHistoryPage = lazy(() => import('./components/ReadingHistoryPage'));
const BookmarksPage = lazy(() => import('./components/BookmarksPage'));
const AuthorPage = lazy(() => import('./components/AuthorPage'));
const TagPage = lazy(() => import('./components/TagPage'));
const WeeklyDigestPage = lazy(() => import('./components/WeeklyDigestPage'));
const NewsletterPreferencesPage = lazy(() => import('./components/NewsletterPreferencesPage'));
const ReadingListsPage = lazy(() => import('./components/ReadingListsPage'));
const MostReadThisWeek = lazy(() => import('./components/MostReadThisWeek'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

function GA4() {
  if (!GA_MEASUREMENT_ID) return null;
  return (
    <>
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} />
      <script dangerouslySetInnerHTML={{ __html: `window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${GA_MEASUREMENT_ID}');` }} />
    </>
  );
}

function LazyFallback() {
  return <div className="min-h-[60vh]"><FeedSkeleton /></div>;
}

function AppContent() {
  const { route } = useNavigation();
  const routeKey = route.name + (route.slug || '') + (route.tag || '') + (route.page || 1);

  useEffect(() => {
    const key = route.name + (route.slug || '') + (route.tag || '') + (route.page || 1);
    const main = document.querySelector('main');
    if (main) {
      main.classList.remove('page-enter');
      void main.offsetWidth;
      main.classList.add('page-enter');
    }
  }, [routeKey]);

  if (route.name.startsWith('admin') || route.name === 'admin') {
    return (
      <Suspense fallback={<div className="min-h-screen bg-gray-50 animate-pulse" />}>
        <AdminApp />
      </Suspense>
    );
  }

  const renderPage = () => {
    switch (route.name) {
      case 'home':
        return <HomePage page={route.page} />;
      case 'article':
        return <ArticleReader slug={route.slug} />;
      case 'category':
        return <CategoryPage slug={route.slug} page={route.page} />;
      case 'product':
        return <ProductDetail slug={route.slug} />;
      case 'search':
        return <SearchPage query={route.query} page={route.page} />;
      case 'about':
        return <AboutPage />;
      case 'privacy':
        return <PrivacyPage />;
      case 'terms':
        return <TermsPage />;
      case 'contact':
        return <ContactPage />;
      case 'shop':
        return <ShopPage />;
      case 'shop-category':
        return <ShopCategoryPage slug={route.slug} />;
      case 'shop-product':
        return <ShopProductPage slug={route.slug} />;
      case 'cart':
        return <CartPage />;
      case 'checkout':
        return <CheckoutPage />;
      case 'wishlist':
        return <WishlistPage />;
      case 'account':
        return <AccountPage />;
      case 'account-orders':
        return <AccountOrdersPage />;
      case 'account-downloads':
        return <AccountDownloadsPage />;
      case 'collections':
        return <CollectionsPage />;
      case 'collection':
        return <CollectionDetailPage slug={route.slug} />;
      case 'reading-history':
        return <ReadingHistoryPage />;
      case 'bookmarks':
        return <BookmarksPage />;
      case 'author':
        return <AuthorPage slug={route.slug} />;
      case 'tag':
        return <TagPage tag={route.tag} page={route.page} />;
      case 'weekly-digest':
        return <WeeklyDigestPage />;
      case 'newsletter-preferences':
        return <NewsletterPreferencesPage />;
      case 'reading-lists':
        return <ReadingListsPage />;
      case 'notFound':
        return <NotFoundPage />;
      default:
        return <HomePage page={1} />;
    }
  };

  return (
    <>
      <SEO />
      <GA4 />
      <Header />
      <Suspense fallback={<LazyFallback />}>
        {renderPage()}
      </Suspense>
      <Footer />
      <BackToTop />
      <CartDrawer />
      <CookieConsent />
      <FeedbackWidget />
      <Analytics />
    </>
  );
}

export default function App() {
  return (
    <HelmetProvider>
      <ThemeProvider>
        <ToastProvider>
          <WishlistProvider>
            <CartProvider>
              <AuthProvider>
                <AppContent />
              </AuthProvider>
            </CartProvider>
          </WishlistProvider>
        </ToastProvider>
      </ThemeProvider>
    </HelmetProvider>
  );
}
