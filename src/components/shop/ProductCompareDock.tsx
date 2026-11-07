import { useState, useEffect } from 'react';
import { Scale, X, ArrowRight } from 'lucide-react';
import { getCompareIds, setCompareIds } from './ProductExtras';
import { useComparableProducts } from '../../hooks/useV3';
import { useNavigation } from '../../context/NavigationContext';
import { displayImageUrl } from '../../lib/images';

export default function ProductCompareDock() {
  const [ids, setIds] = useState<string[]>(getCompareIds);
  const { products } = useComparableProducts(ids);
  const { navigate, route } = useNavigation();

  useEffect(() => {
    const handler = () => setIds(getCompareIds());
    window.addEventListener('lixxon:compare', handler);
    return () => window.removeEventListener('lixxon:compare', handler);
  }, []);

  // Do not show on the actual comparison page itself to avoid duplication
  if (ids.length === 0 || route.name === 'product-comparison') {
    return null;
  }

  const handleClear = () => {
    setCompareIds([]);
  };

  const handleGoToCompare = () => {
    navigate({ name: 'product-comparison' });
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-lg w-[92vw] sm:w-auto bg-[#1F1F1F]/95 backdrop-blur-md text-white border border-white/10 rounded-full luxury-shadow-lg px-4 py-2.5 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-[#E8E2D9] font-medium tracking-editorial uppercase">
          <Scale size={14} className="text-bronze-light" />
          <span>Compare ({ids.length}/3)</span>
        </div>

        {/* Product Thumbnails */}
        <div className="flex items-center -space-x-2 overflow-hidden">
          {products.map(p => (
            <div
              key={p.id}
              className="w-7 h-7 rounded-full border-2 border-[#1F1F1F] bg-white overflow-hidden flex-shrink-0"
              title={p.name}
            >
              {p.image_url ? (
                <img
                  src={displayImageUrl(p.image_url)}
                  alt={p.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-[#333333]" />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleGoToCompare}
          className="px-3.5 py-1.5 bg-bronze text-white text-[11px] tracking-editorial uppercase font-medium rounded-full hover:bg-bronze-dark transition-colors flex items-center gap-1 shadow-sm"
        >
          <span className="hidden sm:inline">View Comparison</span><span className="sm:hidden">View</span>
          <ArrowRight size={12} />
        </button>

        <button
          onClick={handleClear}
          className="p-1 text-white/50 hover:text-white transition-colors"
          title="Clear comparison list"
          aria-label="Clear comparison list"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

