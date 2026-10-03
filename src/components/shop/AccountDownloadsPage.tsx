import { useEffect, useState } from 'react';
import { Download, ArrowRight, Lock, Clock } from 'lucide-react';
import { Link, useNavigation } from '../../context/NavigationContext';
import { useDownloadEntitlements } from '../../hooks/useCommerce';
import { supabase } from '../../lib/supabaseClient';
import { Helmet } from 'react-helmet-async';

export default function AccountDownloadsPage() {
  const [email] = useState(() => localStorage.getItem('lixxon_customer_email') || '');
  const { entitlements, loading } = useDownloadEntitlements(email || null);
  const { navigate } = useNavigation();

  useEffect(() => { window.scrollTo(0, 0); }, []);

  if (!email) {
    navigate({ name: 'account' });
    return null;
  }

  const handleDownload = async (token: string, entitlementId: string) => {
    // Fetch a secure, expiring download URL from Supabase Storage
    const { data, error } = await supabase
      .from('download_entitlements')
      .select('file_path, download_count, max_downloads')
      .eq('download_token', token)
      .maybeSingle();

    if (error || !data) {
      alert('Download link is invalid or has expired.');
      return;
    }

    if (data.download_count >= data.max_downloads) {
      alert('You have reached the maximum number of downloads for this product.');
      return;
    }

    // Create a signed URL for the file (expires in 1 hour)
    const { data: urlData, error: urlError } = await supabase
      .storage
      .from('digital-products')
      .createSignedUrl(data.file_path, 3600);

    if (urlError || !urlData) {
      alert('Could not generate download link. Please try again.');
      return;
    }

    // Increment download count
    await supabase
      .from('download_entitlements')
      .update({ download_count: data.download_count + 1 })
      .eq('id', entitlementId);

    // Open the signed URL
    window.open(urlData.signedUrl, '_blank', 'noopener,noreferrer');
  };

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
                    {ent.product?.image_url && <img src={ent.product.image_url} alt={ent.product.name} className="w-full h-full object-cover" />}
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
                    onClick={() => handleDownload(ent.download_token, ent.id)}
                    disabled={isExpired || downloadsLeft <= 0}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isExpired ? <><Lock size={14} /> Expired</> : <><Download size={14} /> Download</>}
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
