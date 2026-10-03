import { useState, useMemo } from 'react';
import { Package, Search } from 'lucide-react';
import { useAdminOrders } from '../../hooks/useCommerce';
import type { Order } from '../../lib/types';

export default function AdminOrders() {
  const { orders, loading } = useAdminOrders();
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = useMemo(() => orders.filter(o => {
    if (statusFilter !== 'all' && o.payment_status !== statusFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return o.order_number?.toLowerCase().includes(q) || o.customer_email?.toLowerCase().includes(q) || o.customer_name?.toLowerCase().includes(q);
    }
    return true;
  }), [orders, filter, statusFilter]);

  const totalRevenue = orders.filter(o => o.payment_status === 'paid').reduce((sum, o) => sum + o.amount, 0);

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-charcoal font-light">Orders</h1>
        <div className="flex gap-6 mt-3 text-sm">
          <span className="text-charcoal-muted">{orders.length} total orders</span>
          <span className="text-charcoal-muted">Revenue: <strong className="text-charcoal">${totalRevenue.toFixed(2)}</strong></span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-muted" />
          <input type="text" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search orders..." className="w-full bg-white border border-taupe/50 pl-9 pr-4 py-2.5 text-sm rounded-sm focus:outline-none focus:border-bronze" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-white border border-taupe/50 px-4 py-2.5 text-sm rounded-sm focus:outline-none focus:border-bronze">
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-20 rounded-sm" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-sm border border-taupe/30">
          <Package size={32} strokeWidth={1.5} className="text-charcoal-muted mx-auto mb-4" />
          <p className="text-charcoal-muted">No orders found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-sm border border-taupe/30 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-taupe-light/40">
              <tr className="text-left text-[10px] tracking-editorial uppercase text-charcoal-muted">
                <th className="px-4 py-3">Order #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => (
                <OrderRow key={o.id} order={o} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OrderRow({ order }: { order: Order }) {
  const [expanded, setExpanded] = useState(false);
  const items = order.items || [];

  return (
    <>
      <tr className="border-t border-taupe/30 hover:bg-taupe-light/20 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <td className="px-4 py-3 text-charcoal font-medium">
          <span className={`inline-block transition-transform duration-200 text-charcoal-muted mr-2 ${expanded ? 'rotate-90' : ''}`}>&rsaquo;</span>
          {order.order_number}
        </td>
        <td className="px-4 py-3">
          <p className="text-charcoal">{order.customer_name || '—'}</p>
          <p className="text-xs text-charcoal-muted">{order.customer_email}</p>
        </td>
        <td className="px-4 py-3 text-charcoal">${order.amount.toFixed(2)}</td>
        <td className="px-4 py-3">
          <span className={`text-xs px-2 py-1 rounded-full ${
            order.payment_status === 'paid' ? 'bg-green-50 text-green-700' :
            order.payment_status === 'failed' ? 'bg-red-50 text-red-700' :
            order.payment_status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
            'bg-yellow-50 text-yellow-700'
          }`}>{order.payment_status}</span>
        </td>
        <td className="px-4 py-3 text-charcoal-muted text-xs">{new Date(order.created_at).toLocaleDateString()}</td>
      </tr>
      {expanded && items.length > 0 && (
        <tr className="bg-taupe-light/20">
          <td colSpan={5} className="px-8 py-4">
            <div className="space-y-2">
              <p className="text-[10px] tracking-editorial uppercase text-charcoal-muted mb-2">Order Items</p>
              {items.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-charcoal">{item.product_name}</span>
                    <span className="text-charcoal-muted ml-2">&times;{item.quantity}</span>
                  </div>
                  <span className="text-charcoal-muted">${(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
