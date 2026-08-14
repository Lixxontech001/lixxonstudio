import { HelmetProvider } from 'react-helmet-async';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { useNavigation } from './context/NavigationContext';
import Header from './components/Header';
import Footer from './components/Footer';
import { HomePage, CategoryPage, AboutPage, PrivacyPage, TermsPage, ContactPage } from './components/Pages';
import ArticleReader from './components/ArticleReader';
import ProductDetail from './components/ProductDetail';
import NotFoundPage from './components/NotFoundPage';
import SEO from './components/SEO';

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

function GA4() {
  if (!GA_MEASUREMENT_ID) return null;
  return (
    <>
      <script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');`,
        }}
      />
    </>
  );
}

export default function App() {
  const { route } = useNavigation();

  const renderPage = () => {
    switch (route.name) {
      case 'home':
        return <HomePage />;
      case 'article':
        return <ArticleReader slug={route.slug} />;
      case 'category':
        return <CategoryPage slug={route.slug} />;
      case 'product':
        return <ProductDetail slug={route.slug} />;
      case 'about':
        return <AboutPage />;
      case 'privacy':
        return <PrivacyPage />;
      case 'terms':
        return <TermsPage />;
      case 'contact':
        return <ContactPage />;
      case 'notFound':
        return <NotFoundPage />;
      default:
        return <HomePage />;
    }
  };

  return (
    <HelmetProvider>
      <div className="min-h-screen bg-porcelain overflow-x-hidden">
        <SEO />
        <GA4 />
        <Header />
        {renderPage()}
        <Footer />
        <Analytics />
      </div>
    </HelmetProvider>
  );
}
