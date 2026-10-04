import { Suspense, useEffect, useState } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { Analytics } from '@vercel/analytics/react';
import { useNavigation, routeToPath } from './context/NavigationContext';
import Header from './components/Header';
import Footer from './components/Footer';
import BackToTop from './components/BackToTop';
import SEO from './components/SEO';
import {FeedSkeleton} from './components/Skeletons';
import CartDrawer from './components/shop/CartDrawer';
import CookieConsent from './components/CookieConsent';
import FeedbackWidget from './components/FeedbackWidget';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { WishlistProvider } from './context/WishlistContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { HomePage, CategoryPage, AboutPage, PrivacyPage, TermsPage, ContactPage } from './components/Pages';
import { SkipLink, AnnouncementBar, MaintenanceGate } from './components/SiteChrome';
import ShortcutsHelp from './components/ShortcutsHelp';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { lazyWithRetry } from './lib/chunkRecovery';

const ArticleReader = lazyWithRetry(() => import('./components/ArticleReader'));
const ProductDetail = lazyWithRetry(() => import('./components/ProductDetail'));
const SearchPage = lazyWithRetry(() => import('./components/SearchPage'));
const NotFoundPage = lazyWithRetry(() => import('./components/NotFoundPage'));
const ShopPage = lazyWithRetry(() => import('./components/shop/ShopPage'));
const ShopProductPage = lazyWithRetry(() => import('./components/shop/ShopProductPage'));
const ShopCategoryPage = lazyWithRetry(() => import('./components/shop/ShopCategoryPage'));
const CartPage = lazyWithRetry(() => import('./components/shop/CartPage'));
const CheckoutPage = lazyWithRetry(() => import('./components/shop/CheckoutPage'));
const WishlistPage = lazyWithRetry(() => import('./components/shop/WishlistPage'));
const AccountPage = lazyWithRetry(() => import('./components/shop/AccountPage'));
const AccountOrdersPage = lazyWithRetry(() => import('./components/shop/AccountOrdersPage'));
const AccountDownloadsPage = lazyWithRetry(() => import('./components/shop/AccountDownloadsPage'));
const CollectionsPage = lazyWithRetry(() => import('./components/shop/CollectionsPage'));
const CollectionDetailPage = lazyWithRetry(() => import('./components/shop/CollectionDetailPage'));
const ReadingHistoryPage = lazyWithRetry(() => import('./components/ReadingHistoryPage'));
const BookmarksPage = lazyWithRetry(() => import('./components/BookmarksPage'));
const AuthorPage = lazyWithRetry(() => import('./components/AuthorPage'));
const TagPage = lazyWithRetry(() => import('./components/TagPage'));
const WeeklyDigestPage = lazyWithRetry(() => import('./components/WeeklyDigestPage'));
const NewsletterPreferencesPage = lazyWithRetry(() => import('./components/NewsletterPreferencesPage'));
const ReadingListsPage = lazyWithRetry(() => import('./components/ReadingListsPage'));
const GiftCardsPage = lazyWithRetry(() => import('./components/shop/GiftCardsPage'));
const OrderTrackingPage = lazyWithRetry(() => import('./components/shop/OrderTrackingPage'));
const ProductComparisonPage = lazyWithRetry(() => import('./components/pages/ProductComparisonPage'));
const SeriesPage = lazyWithRetry(() => import('./components/pages/SeriesPage'));
const SeriesIndexPage = lazyWithRetry(() => import('./components/pages/SeriesPage').then(m => ({ default: m.SeriesIndexPage })));
const GlossaryPage = lazyWithRetry(() => import('./components/pages/GlossaryPage'));
const NewsletterStatusPage = lazyWithRetry(() => import('./components/pages/NewsletterStatusPage'));
const AccountProfilePage = lazyWithRetry(() => import('./components/shop/AccountProfilePage'));
const AccountRefundsPage = lazyWithRetry(() => import('./components/shop/AccountRefundsPage'));
const ReaderProfilePage = lazyWithRetry(() => import('./components/pages/ReaderProfilePage'));
const SharedListPage = lazyWithRetry(() => import('./components/pages/ReaderProfilePage').then(m => ({ default: m.SharedListPage })));
const AdminApp = lazyWithRetry(() => import('./admin/AdminApp'));

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

/** GA only loads after the visitor accepts cookies (consent-gated; see CookieConsent). */
function GA4() {
  const [consented, setConsented] = useState(() => localStorage.getItem('lixxon_cookie_consent') === 'accepted');
  useEffect(() => {
    const h = () => setConsented(localStorage.getItem('lixxon_cookie_consent') === 'accepted');
    window.addEventListener('lixxon:consent', h);
    return () => window.removeEventListener('lixxon:consent', h);
  }, []);
  if (!GA_MEASUREMENT_ID || !consented) return null;
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
  const routeKey = routeToPath(route);
  useKeyboardShortcuts();
  const { showToast } = useToast();
  useEffect(() => {
    const h = () =>
      showToast(
        'New version available — reload.',
        'info',
        { label: 'Reload', onClick: () => window.location.reload() },
        15000
      );
    window.addEventListener('lixxon:update-ready', h);
    return () => window.removeEventListener('lixxon:update-ready', h);
  }, [showToast]);

  useEffect(() => {
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
      case 'gift-cards':
        return <GiftCardsPage />;
      case 'order-tracking':
        return <OrderTrackingPage orderNumber={route.orderNumber} />;
      case 'product-comparison':
        return <ProductComparisonPage />;
      case 'series':
        return <SeriesPage slug={route.slug} />;
      case 'series-index':
        return <SeriesIndexPage />;
      case 'glossary':
        return <GlossaryPage />;
      case 'newsletter-confirm':
        return <NewsletterStatusPage mode="confirm" token={route.token} />;
      case 'newsletter-unsubscribe':
        return <NewsletterStatusPage mode="unsubscribe" token={route.token} />;
      case 'account-profile':
        return <AccountProfilePage />;
      case 'account-refunds':
        return <AccountRefundsPage />;
      case 'reader':
        return <ReaderProfilePage handle={route.handle} />;
      case 'shared-list':
        return <SharedListPage token={route.token} />;
      case 'notFound':
        return <NotFoundPage />;
      default:
        return <HomePage page={1} />;
    }
  };

  return (
    <MaintenanceGate>
      <SkipLink />
      <SEO />
      <GA4 />
      <AnnouncementBar />
      <Header />
      <Suspense fallback={<LazyFallback />}>
        {renderPage()}
      </Suspense>
      <Footer />
      <BackToTop />
      <CartDrawer />
      <CookieConsent />
      <FeedbackWidget />
      <ShortcutsHelp />
      <Analytics />
    </MaintenanceGate>
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
