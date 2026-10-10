import { displayImageUrl } from '../../lib/images';
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Scale, X, ShoppingBag } from 'lucide-react';
import { Link } from '../../context/NavigationContext';
import { useComparableProducts } from '../../hooks/useV3';
import { getCompareIds, setCompareIds } from '../shop/ProductExtras';
import { useCart } from '../../context/CartContext';
import { parsePrice, formatMoney } from '../../lib/money';
import EmptyState from '../EmptyState';

/** Side-by-side comparison of up to 3 products (attributes from `products.compare_attributes`). */
export default function ProductComparisonPage() {
  const [ids, setIds] = useState<string[]>(getCompareIds);
  const { products } = useComparableProducts(ids);
  const { addItem, openCart } = useCart();
  useEffect(() => { window.scrollTo(0, 0); const h = () => setIds(getCompareIds()); window.addEventListener('lixxon:compare', h); return () => window.removeEventListener('lixxon:compare', h); }, []);

  const remove = (id: string) => setCompareIds(ids.filter(i => i !== id));
  const attrKeys = Array.from(new Set(products.flatMap(p => Object.keys(p.compare_attributes || {}))));
  const rows: { label: string; get: (p: typeof products[number]) => string }[] = [
    { label: 'Brand', get: p => p.brand || '—' },
    { label: 'Type', get: p => p.product_type === 'digital' || p.is_digital ? 'Digital guide' : 'Recommended product' },
    { label: 'Price', get: p => parsePrice(p.price) > 0 ? formatMoney(parsePrice(p.price), p.currency || 'USD') : (p.price || '—') },
    { label: 'Key ingredients', get: p => p.key_ingredients || '—' },
    { label: 'Used for', get: p => p.what_its_used_for || '—' },
    { label: 'Why we recommend', get: p => p.why_we_recommend || '—' },
    ...attrKeys.map(k => ({ label: k.replace(/_/g, ' '), get: (p: typeof products[number]) => String(p.compare_attributes?.[k] ?? '—') })),
  ];

  return (
    <main className="container-wide py-16 md:py-24">
      <Helmet><title>Compare products | Lixxon Studio</title></Helmet>
      <header className="mb-10">
        <p className="flex items-center gap-2 text-[11px] tracking-editorial uppercase text-bronze mb-3"><Scale size={14} /> Compare</p>
        <h1 className="font-serif text-4xl text-charcoal">Side by side</h1>
        <p className="text-charcoal-light mt-2">Add up to three products from the shop to compare them here.</p>
      </header>
      {products.length === 0 ? (
        <EmptyState message="Nothing to compare yet. Use “Compare” on any product page." />
      ) : (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="text-left align-bottom p-3 text-[10px] tracking-editorial uppercase text-charcoal-muted font-normal w-40">Product</th>
                {products.map(p => (
                  <th key={p.id} className="p-3 align-top text-left font-normal border-l border-taupe/40">
                    <div className="relative">
                      <button onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`} className="absolute -top-1 right-0 p-1 text-charcoal-muted hover:text-red-600"><X size={14} /></button>
                      <div className="aspect-square w-full max-w-[180px] bg-taupe-light rounded-sm overflow-hidden mb-3">{p.image_url && <img src={displayImageUrl(p.image_url)} alt={p.name} className="w-full h-full object-cover" />}</div>
                      <Link to={{ name: 'shop-product', slug: p.slug || p.id }} className="font-serif text-lg text-charcoal hover:text-bronze leading-tight">{p.name}</Link>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} className="border-t border-taupe/40">
                  <th scope="row" className="p-3 text-left text-[11px] tracking-editorial uppercase text-charcoal-muted font-normal align-top capitalize">{r.label}</th>
                  {products.map(p => <td key={p.id} className="p-3 align-top border-l border-taupe/40 text-charcoal-light leading-relaxed">{r.get(p)}</td>)}
                </tr>
              ))}
              <tr className="border-t border-taupe/40">
                <th scope="row" className="p-3" />
                {products.map(p => (
                  <td key={p.id} className="p-3 border-l border-taupe/40">
                    {(p.product_type === 'digital' || p.is_digital) && parsePrice(p.price) > 0 ? (
                      <button onClick={() => { addItem({ id: p.id, name: p.name, slug: p.slug || p.id, price: parsePrice(p.price), image_url: p.image_url, is_digital: true }); openCart(); }} className="inline-flex items-center gap-2 px-4 py-2.5 bg-bronze text-white text-[11px] tracking-editorial uppercase rounded-sm hover:bg-bronze-dark"><ShoppingBag size={14} /> Add to cart</button>
                    ) : p.affiliate_url && p.affiliate_url !== '#' ? (
                      <a href={p.affiliate_url} target="_blank" rel="noopener noreferrer sponsored" className="inline-flex px-4 py-2.5 border border-charcoal text-charcoal text-[11px] tracking-editorial uppercase rounded-sm hover:bg-charcoal hover:text-white">Shop now</a>
                    ) : null}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
