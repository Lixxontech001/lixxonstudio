import { useState, useEffect } from 'react';
import { Tag, Loader2, Check, X } from 'lucide-react';
import { usePromoCode } from '../../hooks/useFeatures';

interface PromoCodeInputProps {
  subtotal: number;
  onDiscountChange: (discount: number) => void;
}

export default function PromoCodeInput({ subtotal, onDiscountChange }: PromoCodeInputProps) {
  const [code, setCode] = useState('');
  const [showInput, setShowInput] = useState(false);
  const { appliedCode, discount, loading, error, applyCode, removeCode } = usePromoCode();

  useEffect(() => {
    onDiscountChange(discount);
  }, [discount, onDiscountChange]);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    await applyCode(code, subtotal);
  };

  const handleRemove = () => {
    removeCode();
    setCode('');
  };

  if (appliedCode) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-sm">
        <Check size={16} className="text-green-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-green-800 font-medium">{appliedCode.code}</p>
          <p className="text-xs text-green-600">
            {appliedCode.discount_type === 'percentage'
              ? `${appliedCode.discount_value}% off`
              : `$${appliedCode.discount_value} off`}
            {' '}— saved ${discount.toFixed(2)}
          </p>
        </div>
        <button onClick={handleRemove} className="text-green-600 hover:text-green-800 transition-colors" aria-label="Remove promo code">
          <X size={16} />
        </button>
      </div>
    );
  }

  if (!showInput) {
    return (
      <button
        onClick={() => setShowInput(true)}
        className="inline-flex items-center gap-2 text-xs text-charcoal-muted hover:text-bronze transition-colors"
      >
        <Tag size={12} strokeWidth={1.5} /> Have a promo code?
      </button>
    );
  }

  return (
    <form onSubmit={handleApply} className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="ENTER CODE"
          className="flex-1 border border-taupe/50 px-3 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/50 focus:outline-none focus:border-bronze transition-colors rounded-sm uppercase tracking-wide"
        />
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="px-4 py-2.5 bg-charcoal text-white text-xs tracking-editorial uppercase font-medium rounded-sm hover:bg-bronze transition-all disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : 'Apply'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
