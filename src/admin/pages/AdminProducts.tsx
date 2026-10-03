import {useState} from 'react';
import { Plus, Edit, Trash2, ShoppingBag } from 'lucide-react';
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

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this product? This cannot be undone.')) return;
    await supabase.from('products').delete().eq('id', id);
    setProducts(prev => prev.filter(p => p.id !== id));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-charcoal font-light">Products</h1>
          <p className="text-sm text-charcoal-muted mt-1">{products.length} total</p>
        </div>
        <button onClick={() => navigate({ name: 'admin-product-new' })} className="inline-flex items-center gap-2 px-4 py-2.5 bg-bronze text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze-dark transition-all">
          <Plus size={16} /> New Product
        </button>
      </div>

      <input
        type="text"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Search products..."
        className="w-full max-w-md bg-white border border-taupe/50 px-4 py-2.5 text-sm rounded-sm focus:outline-none focus:border-bronze mb-6"
      />

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-20 rounded-sm" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-sm border border-taupe/30">
          <ShoppingBag size={32} strokeWidth={1.5} className="text-charcoal-muted mx-auto mb-4" />
          <p className="text-charcoal-muted">No products found. Create your first product to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-sm border border-taupe/30 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-taupe-light/40">
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
                <tr key={p.id} className="border-t border-taupe/30 hover:bg-taupe-light/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {p.image_url && <img src={p.image_url} alt="" className="w-10 h-10 rounded-sm object-cover" />}
                      <div>
                        <p className="text-charcoal font-medium">{p.name}</p>
                        {p.brand && <p className="text-xs text-charcoal-muted">{p.brand}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-charcoal-muted">{p.product_type}</td>
                  <td className="px-4 py-3 text-charcoal">{p.price || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${p.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                    {p.is_featured && <span className="text-xs px-2 py-1 rounded-full bg-bronze/10 text-bronze ml-1">Featured</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => navigate({ name: 'admin-product-edit', id: p.id })} className="text-charcoal-muted hover:text-bronze transition-colors mr-3" aria-label="Edit">
                      <Edit size={16} />
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="text-charcoal-muted hover:text-red-600 transition-colors" aria-label="Delete">
                      <Trash2 size={16} />
                    </button>
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
