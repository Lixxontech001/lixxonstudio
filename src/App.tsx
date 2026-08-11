import { useNavigation } from './context/NavigationContext';
import Header from './components/Header';
import Footer from './components/Footer';
import { HomePage, CategoryPage, AboutPage, PrivacyPage, TermsPage, ContactPage } from './components/Pages';
import ArticleReader from './components/ArticleReader';
import NotFoundPage from './components/NotFoundPage';

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
    <div className="min-h-screen bg-porcelain">
      <Header />
      {renderPage()}
      <Footer />
    </div>
  );
}
