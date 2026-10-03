import { ArrowRight, Download, Package, Heart, LogOut, Bookmark, History, Award, Settings, type LucideIcon } from 'lucide-react';
import { Link, useNavigation } from '../../context/NavigationContext';
import { useCustomerOrders, useDownloadEntitlements } from '../../hooks/useCommerce';
import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../../context/AuthContext';
import CustomerGate from './CustomerGate';
import { formatMoney } from '../../lib/money';

export default function AccountPage() {
  return <CustomerGate><AccountInner /></CustomerGate>;
}

function AccountInner() {
  const { email, signOut } = useAuth();
  const { navigate } = useNavigation();
  const { orders } = useCustomerOrders(email);
  const { entitlements } = useDownloadEntitlements(email);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <main>
      <Helmet><title>Account | Lixxon Studio</title><meta name="robots" content="noindex, nofollow" /></Helmet>

      <section className="container-wide pt-12 pb-8">
        <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-4">Account</p>
        <h1 className="font-serif text-3xl md:text-5xl text-charcoal font-light break-all">{email}</h1>
        <button onClick={() => signOut()} className="inline-flex items-center gap-2 text-xs text-charcoal-muted hover:text-bronze transition-colors mt-3 tracking-editorial uppercase">
          <LogOut size={12} /> Sign out
        </button>
      </section>

      <section className="container-wide pb-16">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          <AccountCard label="Orders" count={orders.length} icon={Package} onClick={() => navigate({ name: 'account-orders' })} />
          <AccountCard label="Downloads" count={entitlements.length} icon={Download} onClick={() => navigate({ name: 'account-downloads' })} />
          <AccountCard label="Wishlist" icon={Heart} onClick={() => navigate({ name: 'wishlist' })} />
          <AccountCard label="Bookmarks" icon={Bookmark} onClick={() => navigate({ name: 'bookmarks' })} />
          <AccountCard label="Reading history" icon={History} onClick={() => navigate({ name: 'reading-history' })} />
          <AccountCard label="Achievements" icon={Award} onClick={() => navigate({ name: 'reading-history' })} />
          <AccountCard label="Reading lists" icon={Settings} onClick={() => navigate({ name: 'reading-lists' })} />
          <AccountCard label="Newsletter" icon={ArrowRight} onClick={() => navigate({ name: 'newsletter-preferences' })} />
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
                      <p className="text-sm text-charcoal">{formatMoney(Number(order.amount), order.currency)}</p>
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

function AccountCard({ label, count, icon: Icon, onClick }: { label: string; count?: number; icon: LucideIcon; onClick: () => void }) {
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
