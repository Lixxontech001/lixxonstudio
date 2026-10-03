import { ArrowRight, Download, Package, Heart, ShoppingBag, User as UserIcon } from 'lucide-react';
import { Link, useNavigation } from '../../context/NavigationContext';
import { useCustomerOrders, useDownloadEntitlements } from '../../hooks/useCommerce';
import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';

export default function AccountPage() {
  const [email, setEmail] = useState(() => localStorage.getItem('lixxon_customer_email') || '');
  const [inputEmail, setInputEmail] = useState('');
  const [showForm, setShowForm] = useState(false);
  const { navigate } = useNavigation();
  const { orders } = useCustomerOrders(email || null);
  const { entitlements } = useDownloadEntitlements(email || null);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputEmail.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inputEmail.trim())) {
      localStorage.setItem('lixxon_customer_email', inputEmail.trim());
      setEmail(inputEmail.trim());
      setShowForm(false);
    }
  };

  if (!email) {
    return (
      <main>
        <Helmet><title>Account | Lixxon Studio</title><meta name="robots" content="noindex, nofollow" /></Helmet>
        <section className="container-narrow py-16 md:py-24 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-taupe-light mb-8">
            <UserIcon size={24} strokeWidth={1.5} className="text-bronze" />
          </div>
          <h1 className="font-serif text-4xl text-charcoal font-light">Your Account</h1>
          <p className="text-charcoal-muted text-base mt-4 max-w-md mx-auto leading-relaxed">
            Enter the email address used at checkout to view your orders and downloads.
          </p>
          <form onSubmit={handleEmailSubmit} className="mt-8 max-w-sm mx-auto">
            <input
              type="email"
              value={inputEmail}
              onChange={e => setInputEmail(e.target.value)}
              placeholder="your@email.com"
              aria-label="Email address"
              className="w-full bg-white border border-taupe/50 px-4 py-3.5 text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm text-center"
            />
            <button type="submit" className="w-full mt-3 inline-flex items-center justify-center gap-3 px-8 py-4 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium hover:bg-bronze transition-all duration-500 rounded-sm">
              View My Account
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main>
      <Helmet><title>Account | Lixxon Studio</title><meta name="robots" content="noindex, nofollow" /></Helmet>

      <section className="container-wide pt-12 pb-8">
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Account</p>
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal font-light">{email}</h1>
        <button onClick={() => { setShowForm(!showForm); }} className="text-xs text-charcoal-muted hover:text-bronze transition-colors mt-3 tracking-editorial uppercase">
          Use different email
        </button>
        {showForm && (
          <form onSubmit={handleEmailSubmit} className="mt-4 max-w-sm">
            <input type="email" value={inputEmail} onChange={e => setInputEmail(e.target.value)} placeholder="your@email.com" className="w-full bg-white border border-taupe/50 px-4 py-3 text-sm rounded-sm focus:outline-none focus:border-bronze" />
            <button type="submit" className="mt-2 px-6 py-2 bg-charcoal text-white text-xs rounded-sm">Update</button>
          </form>
        )}
      </section>

      <section className="container-wide pb-16">
        <div className="grid sm:grid-cols-3 gap-4 mb-12">
          <AccountCard label="Orders" count={orders.length} icon={Package} onClick={() => navigate({ name: 'account-orders' })} />
          <AccountCard label="Downloads" count={entitlements.length} icon={Download} onClick={() => navigate({ name: 'account-downloads' })} />
          <AccountCard label="Wishlist" icon={Heart} onClick={() => navigate({ name: 'wishlist' })} />
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          <div className="bg-taupe-light/40 rounded-sm p-6 border border-taupe/30">
            <h3 className="font-serif text-xl text-charcoal mb-4">Recent Orders</h3>
            {orders.length === 0 ? (
              <p className="text-charcoal-muted text-sm">No orders yet. <Link to={{ name: 'shop' }} className="text-bronze hover:underline">Browse the shop</Link></p>
            ) : (
              <div className="space-y-3">
                {orders.slice(0, 3).map(order => (
                  <div key={order.id} className="flex items-center justify-between pb-3 border-b border-taupe/30 last:border-0">
                    <div>
                      <p className="text-sm text-charcoal font-medium">{order.order_number}</p>
                      <p className="text-xs text-charcoal-muted">{new Date(order.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-charcoal">${order.amount.toFixed(2)}</p>
                      <span className={`text-xs ${order.payment_status === 'paid' ? 'text-green-600' : 'text-charcoal-muted'}`}>{order.payment_status}</span>
                    </div>
                  </div>
                ))}
                {orders.length > 3 && (
                  <Link to={{ name: 'account-orders' }} className="text-xs text-bronze hover:underline tracking-editorial uppercase">View all orders</Link>
                )}
              </div>
            )}
          </div>

          <div className="bg-taupe-light/40 rounded-sm p-6 border border-taupe/30">
            <h3 className="font-serif text-xl text-charcoal mb-4">Downloads</h3>
            {entitlements.length === 0 ? (
              <p className="text-charcoal-muted text-sm">No downloads available. Purchased digital products will appear here.</p>
            ) : (
              <div className="space-y-3">
                {entitlements.slice(0, 3).map(ent => (
                  <div key={ent.id} className="flex items-center justify-between pb-3 border-b border-taupe/30 last:border-0">
                    <p className="text-sm text-charcoal">{ent.product?.name || 'Digital product'}</p>
                    <Link to={{ name: 'account-downloads' }} className="text-xs text-bronze hover:underline">Download</Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function AccountCard({ label, count, icon: Icon, onClick }: { label: string; count?: number; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; onClick: () => void }) {
  return (
    <button onClick={onClick} className="bg-white rounded-sm p-6 luxury-shadow hover:luxury-shadow-lg transition-all duration-300 text-left">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-bronze/10 flex items-center justify-center">
          <Icon size={18} strokeWidth={1.5} className="text-bronze" />
        </div>
        <div>
          <p className="font-serif text-lg text-charcoal">{label}</p>
          {count !== undefined && <p className="text-xs text-charcoal-muted">{count} {count === 1 ? 'item' : 'items'}</p>}
        </div>
        <ArrowRight size={16} strokeWidth={1.5} className="text-charcoal-muted ml-auto" />
      </div>
    </button>
  );
}
