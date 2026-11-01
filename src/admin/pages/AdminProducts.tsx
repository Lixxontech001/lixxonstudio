import { useState } from 'react';
import { Plus, Edit, Trash2, ShoppingBag, ExternalLink } from 'lucide-react';
import { useAdminProducts } from '../../hooks/useCommerce';
import { useNavigation } from '../../context/NavigationContext';
import { supabase } from '../../lib/supabaseClient';

export default function AdminProducts() {
  const { products, loading, setProducts } = useAdminProducts();
  const { navigate } = useNavigation();
  const [filter, setFilter] = useState('');

  const filtered = products.filter(p =>
    !filter || p.name?.toLowerCase().includes(filter.toLowerCase()) || p.brand?.toLowerCase().includes(filter.toLowerCase())
  );

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete product "${name}"? This cannot be undone.`)) return;
    await supabase.from('products').delete().eq('id', id);
    setProducts(prev => prev.filter(p => p.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-charcoal font-light">Products & Commerce</h1>
          <p className="text-sm text-charcoal-muted mt-1">{products.length} products in catalog</p>
        </div>
        <a
          href="/admin/products/new"
          onClick={e => {
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              navigate({ name: 'admin-product-new' });
            }
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all shadow-sm"
        >
          <Plus size={16} /> New Product
        </a>
      </div>

      <input
        type="text"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Filter by product name or brand…"
        className="w-full max-w-md bg-white border border-taupe/50 px-4 py-2 text-sm rounded-sm focus:outline-none focus:border-bronze"
      />

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="skeleton h-20 rounded-sm bg-taupe/15" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-sm border border-taupe/30 p-8">
          <ShoppingBag size={36} strokeWidth={1.5} className="text-bronze/70 mx-auto mb-4" />
          <h3 className="font-serif text-xl text-charcoal mb-2 font-normal">No Products Found</h3>
          <p className="text-sm text-charcoal-muted max-w-md mx-auto mb-6">
            Create products, digital downloads, affiliate recommendations, or beauty edits to feature in articles and your shop.
          </p>
          <a
            href="/admin/products/new"
            onClick={e => {
              if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                navigate({ name: 'admin-product-new' });
              }
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase rounded-sm hover:bg-bronze-dark transition-all"
          >
            <Plus size={15} /> Add First Product
          </a>
        </div>
      ) : (
        <div className="bg-white rounded-sm border border-taupe/30 overflow-hidden shadow-xs">
          <table className="w-full text-sm">
            <thead className="bg-taupe-light/40 border-b border-taupe/20">
              <tr className="text-left text-[10px] tracking-editorial uppercase text-charcoal-muted">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-t border-taupe/20 hover:bg-taupe-light/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {p.image_url ? (
                        <img src={p.image_url} alt="" className="w-10 h-10 rounded-sm object-cover border border-taupe/30" />
                      ) : (
                        <div className="w-10 h-10 rounded-sm bg-taupe/20 flex items-center justify-center text-charcoal-muted">
                          <ShoppingBag size={14} />
                        </div>
                      )}
                      <div>
                        <a
                          href={`/admin/products/${p.id}`}
                          onClick={e => {
                            if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                              e.preventDefault();
                              navigate({ name: 'admin-product-edit', id: p.id });
                            }
                          }}
                          className="text-charcoal font-medium hover:text-bronze transition-colors block"
                        >
                          {p.name}
                        </a>
                        {p.brand && <p className="text-xs text-charcoal-muted">{p.brand}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-charcoal-muted capitalize text-xs">{p.product_type || 'standard'}</td>
                  <td className="px-4 py-3 text-charcoal font-medium">${p.price || '0.00'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${p.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                    {p.is_featured && <span className="text-[11px] px-2 py-0.5 rounded-full bg-bronze/10 text-bronze ml-1.5 font-medium">Featured</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {p.slug && (
                        <a
                          href={`/product/${p.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 text-charcoal-muted hover:text-bronze transition-colors"
                          title="View on storefront"
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                      <a
                        href={`/admin/products/${p.id}`}
                        onClick={e => {
                          if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                            e.preventDefault();
                            navigate({ name: 'admin-product-edit', id: p.id });
                          }
                        }}
                        className="p-1.5 text-charcoal-muted hover:text-bronze transition-colors"
                        title="Edit product"
                      >
                        <Edit size={14} />
                      </a>
                      <button
                        onClick={() => handleDelete(p.id, p.name)}
                        className="p-1.5 text-charcoal-muted hover:text-red-600 transition-colors"
                        title="Delete product"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
