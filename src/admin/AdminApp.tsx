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
import AdminGlossary from './pages/AdminGlossary';
import AdminSeries from './pages/AdminSeries';
import AdminQuestions from './pages/AdminQuestions';
import AdminAccess from './pages/AdminAccess';
import AdminDataExplorer from './pages/AdminDataExplorer';
import AdminHealth from './pages/AdminHealth';
import AdminGrowth from './pages/AdminGrowth';
import AdminAdvisor from './pages/AdminAdvisor';
import AdminFrontend from './pages/AdminFrontend';
import AdminBackups from './pages/AdminBackups';
import AdminSecurity from './pages/AdminSecurity';
import MfaGate from './MfaGate';
import { canAccess } from './permissions';
import { ShieldAlert } from 'lucide-react';

export default function AdminApp() {
  const { route, navigate } = useNavigation();
  const { session, loading, isAdmin, adminAccess, email, signOut, refreshAdmin } = useAuth();

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

  // Signed in but not on the team (e.g. a customer who typed /admin), or suspended.
  // RLS already blocks every admin query; this just gives them a clear screen.
  if (!isAdmin) {
    const suspended = adminAccess?.status === 'suspended';
    return (
      <MfaGate onVerified={refreshAdmin}>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="max-w-md text-center bg-white border border-gray-200 rounded-sm p-8">
            <ShieldAlert size={28} className="mx-auto text-amber-500 mb-4" />
            <h1 className="font-serif text-2xl text-charcoal mb-2">{suspended ? 'Access suspended' : 'No admin access'}</h1>
            <p className="text-sm text-gray-500 mb-6">
              {suspended
                ? <>This account (<strong>{email}</strong>) is on the team but its access is suspended. An owner can restore it under Admin → Team &amp; access.</>
                : <>You are signed in as <strong>{email}</strong>, but this account is not on the team. Ask an owner to add you under Admin → Team &amp; access.</>}
            </p>
            <div className="flex justify-center gap-3 text-sm">
              <a href="/account" className="px-4 py-2 border border-gray-300 rounded-sm hover:border-bronze">Go to my account</a>
              <button onClick={() => signOut().then(() => navigate({ name: 'admin-login' }))} className="px-4 py-2 bg-charcoal text-white rounded-sm hover:bg-bronze">Sign out</button>
            </div>
          </div>
        </div>
      </MfaGate>
    );
  }

  if (!canAccess(adminAccess, route.name)) {
    return (
      <AdminLayout>
        <div className="max-w-md mx-auto text-center py-20">
          <ShieldAlert size={28} className="mx-auto text-amber-500 mb-4" />
          <h1 className="font-serif text-2xl text-charcoal mb-2">Not available to your role</h1>
          <p className="text-sm text-gray-500">
            Your role is <strong>{adminAccess?.role_label || adminAccess?.role}</strong>. This section needs a permission it does not have — an owner can grant it under Team &amp; access.
          </p>
        </div>
      </AdminLayout>
    );
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
      case 'admin-glossary': return <AdminGlossary />;
      case 'admin-series': return <AdminSeries />;
      case 'admin-questions': return <AdminQuestions />;
      case 'admin-team': return <AdminAccess />; // legacy link — the page it used to open is now Team & access
      case 'admin-access': return <AdminAccess />;
      case 'admin-data': return <AdminDataExplorer />;
      case 'admin-health': return <AdminHealth />;
      case 'admin-growth': return <AdminGrowth />;
      case 'admin-advisor': return <AdminAdvisor />;
      case 'admin-frontend': return <AdminFrontend />;
      case 'admin-backups': return <AdminBackups />;
      case 'admin-security': return <AdminSecurity />;
      default: return <AdminDashboard />;
    }
  };

  return <MfaGate onVerified={refreshAdmin}><AdminLayout>{renderPage()}</AdminLayout></MfaGate>;
}
