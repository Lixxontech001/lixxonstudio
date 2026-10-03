import { useEffect } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { useAuth } from '../context/AuthContext';
import AdminLayout from './AdminLayout';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import AdminArticles from './pages/AdminArticles';
import AdminArticleEditor from './pages/AdminArticleEditor';
import AdminCategories from './pages/AdminCategories';
import AdminAuthors from './pages/AdminAuthors';
import AdminComments from './pages/AdminComments';
import AdminMedia from './pages/AdminMedia';
import AdminFeatured from './pages/AdminFeatured';
import AdminMessages from './pages/AdminMessages';
import AdminSettings from './pages/AdminSettings';
import AdminProducts from './pages/AdminProducts';
import AdminProductEditor from './pages/AdminProductEditor';
import AdminOrders from './pages/AdminOrders';
import AdminCustomers from './pages/AdminCustomers';
import AdminCollections from './pages/AdminCollections';
import AdminCollectionEditor from './pages/AdminCollectionEditor';
import AdminNewsletter from './pages/AdminNewsletter';
import AdminAnalytics from './pages/AdminAnalytics';
import AdminSponsored from './pages/AdminSponsored';
import AdminPromoCodes from './pages/AdminPromoCodes';
import AdminReviews from './pages/AdminReviews';
import AdminPolls from './pages/AdminPolls';
import AdminRefunds from './pages/AdminRefunds';
import AdminAbandonedCarts from './pages/AdminAbandonedCarts';
import AdminActivityLog from './pages/AdminActivityLog';
import AdminContentTemplates from './pages/AdminContentTemplates';
import AdminGiftCards from './pages/AdminGiftCards';
import AdminFeedback from './pages/AdminFeedback';
import AdminSocialShares from './pages/AdminSocialShares';
import AdminSubscribersPrefs from './pages/AdminSubscribersPrefs';

export default function AdminApp() {
  const { route, navigate } = useNavigation();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (session && route.name === 'admin-login') {
      navigate({ name: 'admin-dashboard' });
    }
  }, [session, route.name, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!session && route.name !== 'admin-login') {
    return <AdminLogin />;
  }

  if (route.name === 'admin-login') {
    return <AdminLogin />;
  }

  const renderPage = () => {
    switch (route.name) {
      case 'admin-dashboard': return <AdminDashboard />;
      case 'admin-articles': return <AdminArticles />;
      case 'admin-article-new': return <AdminArticleEditor isNew />;
      case 'admin-article-edit': return <AdminArticleEditor postId={route.id} />;
      case 'admin-categories': return <AdminCategories />;
      case 'admin-authors': return <AdminAuthors />;
      case 'admin-comments': return <AdminComments />;
      case 'admin-messages': return <AdminMessages />;
      case 'admin-media': return <AdminMedia />;
      case 'admin-featured': return <AdminFeatured />;
      case 'admin-settings': return <AdminSettings />;
      case 'admin-products': return <AdminProducts />;
      case 'admin-product-new': return <AdminProductEditor isNew />;
      case 'admin-product-edit': return <AdminProductEditor productId={route.id} />;
      case 'admin-orders': return <AdminOrders />;
      case 'admin-customers': return <AdminCustomers />;
      case 'admin-collections': return <AdminCollections />;
      case 'admin-collection-new': return <AdminCollectionEditor isNew />;
      case 'admin-collection-edit': return <AdminCollectionEditor collectionId={route.id} />;
      case 'admin-newsletter': return <AdminNewsletter />;
      case 'admin-analytics': return <AdminAnalytics />;
      case 'admin-sponsored': return <AdminSponsored />;
      case 'admin-promo-codes': return <AdminPromoCodes />;
      case 'admin-reviews': return <AdminReviews />;
      case 'admin-polls': return <AdminPolls />;
      case 'admin-refunds': return <AdminRefunds />;
      case 'admin-abandoned-carts': return <AdminAbandonedCarts />;
      case 'admin-activity-log': return <AdminActivityLog />;
      case 'admin-content-templates': return <AdminContentTemplates />;
      case 'admin-gift-cards': return <AdminGiftCards />;
      case 'admin-feedback': return <AdminFeedback />;
      case 'admin-social-shares': return <AdminSocialShares />;
      case 'admin-subscribers-prefs': return <AdminSubscribersPrefs />;
      default: return <AdminDashboard />;
    }
  };

  return <AdminLayout>{renderPage()}</AdminLayout>;
}
