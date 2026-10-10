import { displayImageUrl } from '../../lib/images';
import { useEffect } from 'react';
import { Download, ArrowRight, Lock, Clock, Loader2 } from 'lucide-react';
import { Link } from '../../context/NavigationContext';
import { useDownloadEntitlements } from '../../hooks/useCommerce';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../../context/AuthContext';
import CustomerGate from './CustomerGate';
import { useDownload } from '../../hooks/useDownload';

export default function AccountDownloadsPage() {
  return <CustomerGate title="My Downloads" intro="Sign in with your purchase email to access your digital products."><DownloadsInner /></CustomerGate>;
}

function DownloadsInner() {
  const { email } = useAuth();
  const { entitlements, loading, refetch } = useDownloadEntitlements(email);
  const { download, busyToken } = useDownload();

  useEffect(() => { window.scrollTo(0, 0); }, []);

  // deep link from the receipt email: /account/downloads?token=...
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (token && !loading) {
      const ent = entitlements.find(e => e.download_token === token);
      if (ent) { download(token).then(refetch); window.history.replaceState({}, '', '/account/downloads'); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  return (
    <main>
      <Helmet><title>My Downloads | Lixxon Studio</title><meta name="robots" content="noindex, nofollow" /></Helmet>

      <section className="container-wide pt-12 pb-8">
        <Link to={{ name: 'account' }} className="text-xs tracking-editorial uppercase text-charcoal-muted hover:text-bronze transition-colors">← Back to Account</Link>
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light mt-6">My Downloads</h1>
      </section>

      <section className="container-wide pb-16">
        {loading ? (
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => <div key={i} className="skeleton h-20 rounded-sm" />)}
          </div>
        ) : entitlements.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-6">
              <Download size={24} strokeWidth={1.5} className="text-bronze" />
            </div>
            <h2 className="font-serif text-2xl text-charcoal font-light">No downloads available</h2>
            <p className="text-charcoal-muted text-sm mt-3">Your purchased digital products will appear here.</p>
            <Link to={{ name: 'shop' }} className="inline-flex items-center gap-3 mt-6 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm">
              Browse Shop <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {entitlements.map(ent => {
              const isExpired = ent.expires_at && new Date(ent.expires_at) < new Date();
              const downloadsLeft = ent.max_downloads - ent.download_count;
              return (
                <div key={ent.id} className="bg-white rounded-sm luxury-shadow p-6 flex flex-col sm:flex-row items-start gap-4">
                  <div className="w-16 h-16 rounded-sm overflow-hidden bg-taupe-light flex-shrink-0">
                    {ent.product?.image_url && <img src={displayImageUrl(ent.product.image_url)} alt={ent.product.name} className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-serif text-lg text-charcoal">{ent.product?.name || 'Digital product'}</h3>
                    <p className="text-xs text-charcoal-muted mt-1">Purchased {new Date(ent.created_at).toLocaleDateString()}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-charcoal-muted">
                      <span className="flex items-center gap-1">
                        <Download size={12} /> {downloadsLeft} downloads remaining
                      </span>
                      {ent.expires_at && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} /> Expires {new Date(ent.expires_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => download(ent.download_token).then(refetch)}
                    disabled={!!isExpired || downloadsLeft <= 0 || busyToken === ent.download_token}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isExpired ? <><Lock size={14} /> Expired</> : busyToken === ent.download_token ? <><Loader2 size={14} className="animate-spin" /> Preparing</> : <><Download size={14} /> Download</>}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
