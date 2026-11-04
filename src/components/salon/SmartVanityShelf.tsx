import { useState } from 'react';
import { useSalon } from '../../hooks/useSalon';
import { calculatePaoStatus } from '../../lib/salonEngine';
import type { VanityCategory } from '../../types/salon';
import {
  Plus, Trash2, AlertTriangle, ShieldCheck,
  Clock, Package
} from 'lucide-react';

const CATEGORIES: { id: VanityCategory; label: string }[] = [
  { id: 'cleanser', label: 'Cleanser' },
  { id: 'toner', label: 'Toner / Mist' },
  { id: 'essence', label: 'Essence' },
  { id: 'serum', label: 'Serum / Ampoule' },
  { id: 'moisturizer', label: 'Moisturizer / Cream' },
  { id: 'sunscreen', label: 'Sunscreen (SPF)' },
  { id: 'treatment', label: 'Clinical Treatment / Retinoid' },
  { id: 'eye_cream', label: 'Eye Treatment' },
  { id: 'oil', label: 'Facial Oil' },
  { id: 'mask', label: 'Mask / Exfoliant' },
];

export default function SmartVanityShelf() {
  const { vanity, addVanityItem, removeVanityItem } = useSalon();
  const [showAddModal, setShowAddModal] = useState(false);

  // New bottle form state
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState<VanityCategory>('serum');
  const [openedOn, setOpenedOn] = useState(new Date().toISOString().slice(0, 10));
  const [paoMonths, setPaoMonths] = useState(6);
  const [price, setPrice] = useState('');
  const [actives, setActives] = useState('');

  const totalShelfValue = vanity.reduce((acc, item) => acc + (item.estimated_price || 0), 0);
  const totalItems = vanity.length;

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim()) return;

    addVanityItem({
      product_name: productName.trim(),
      brand: brand.trim() || 'Selected Brand',
      category,
      opened_on: openedOn,
      pao_months: Number(paoMonths) || 6,
      estimated_price: price ? parseFloat(price) : undefined,
      key_actives: actives ? actives.split(',').map(s => s.trim()).filter(Boolean) : [],
    });

    setProductName('');
    setBrand('');
    setPrice('');
    setActives('');
    setShowAddModal(false);
  };

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="bg-warm-ivory border border-taupe/30 p-6 md:p-8 rounded-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-bronze/10 text-bronze text-xs tracking-editorial uppercase font-medium rounded-full mb-3">
              <Package size={13} />
              <span>PAO Degradation & Stability Monitor · Silver+ Privileges</span>
            </div>
            <h2 className="font-serif text-2xl md:text-3xl text-charcoal mb-2">
              The Digital Vanity Shelf
            </h2>
            <p className="text-sm text-charcoal-light leading-relaxed">
              Track open bottles on your counter, monitor Period After Opening (PAO) oxidation windows, and receive proactive degradation warnings before volatile actives (like Vitamin C and Retinol) destabilize and compromise your lipid barrier.
            </p>
          </div>

          <div className="flex-shrink-0">
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-bronze text-white text-xs font-medium tracking-editorial uppercase rounded-sm hover:bg-bronze-dark transition-all"
            >
              <Plus size={14} /> Add Product Bottle (+40 Pts)
            </button>
          </div>
        </div>

        {/* Shelf Overview Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-taupe/20">
          <div className="p-3 bg-white/70 border border-taupe/20 rounded-sm">
            <span className="text-[10px] uppercase tracking-editorial text-charcoal-muted block">Active Bottles</span>
            <span className="font-serif text-2xl text-charcoal">{totalItems}</span>
          </div>
          <div className="p-3 bg-white/70 border border-taupe/20 rounded-sm">
            <span className="text-[10px] uppercase tracking-editorial text-charcoal-muted block">Total Shelf Investment</span>
            <span className="font-serif text-2xl text-bronze">${totalShelfValue.toFixed(2)}</span>
          </div>
          <div className="p-3 bg-white/70 border border-taupe/20 rounded-sm col-span-2 sm:col-span-1">
            <span className="text-[10px] uppercase tracking-editorial text-charcoal-muted block">Degradation Alerts</span>
            <span className="font-serif text-2xl text-charcoal">
              {vanity.filter(i => calculatePaoStatus(i.opened_on, i.pao_months).status !== 'fresh').length} Active
            </span>
          </div>
        </div>
      </div>

      {/* Vanity Bottle Grid */}
      {vanity.length === 0 ? (
        <div className="bg-white border border-taupe/30 p-12 text-center rounded-sm space-y-4">
          <div className="w-12 h-12 rounded-full bg-warm-ivory border border-taupe/30 flex items-center justify-center mx-auto text-bronze">
            <Package size={22} />
          </div>
          <h3 className="font-serif text-xl text-charcoal">Your Vanity Shelf is Empty</h3>
          <p className="text-sm text-charcoal-muted max-w-md mx-auto">
            Add the active products on your bathroom counter or clone a Studio Regimen to start tracking freshness and expiration safety.
          </p>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="px-5 py-2 bg-charcoal text-white text-xs uppercase tracking-editorial font-medium rounded-sm hover:bg-bronze transition-colors"
          >
            Add Your First Product
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {vanity.map(item => {
            const pao = calculatePaoStatus(item.opened_on, item.pao_months);
            const isWarning = pao.status === 'warning';
            const isExpired = pao.status === 'expired';

            return (
              <div
                key={item.id}
                className={`bg-white border rounded-sm p-5 space-y-4 flex flex-col justify-between transition-all ${
                  isExpired
                    ? 'border-red-300 bg-red-50/20'
                    : isWarning
                    ? 'border-amber-300 bg-amber-50/20'
                    : 'border-taupe/30 hover:border-bronze'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-[10px] tracking-editorial uppercase font-semibold text-charcoal-muted">
                      {item.category}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeVanityItem(item.id)}
                      className="text-charcoal-muted hover:text-red-600 transition-colors"
                      title="Empty or discard bottle"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <h4 className="font-serif text-base text-charcoal font-medium leading-snug">
                    {item.product_name}
                  </h4>
                  <div className="text-xs text-bronze font-medium mt-0.5">
                    {item.brand}
                  </div>

                  {item.key_actives && item.key_actives.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {item.key_actives.map(act => (
                        <span key={act} className="text-[10px] bg-warm-ivory text-charcoal-light px-2 py-0.5 rounded-xs border border-taupe/20">
                          {act}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* PAO Freshness Progress Bar */}
                <div className="pt-3 border-t border-taupe/20 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-charcoal-muted flex items-center gap-1">
                      <Clock size={11} /> PAO: {item.pao_months}M
                    </span>
                    <span className={`font-semibold ${
                      isExpired ? 'text-red-700' : isWarning ? 'text-amber-700' : 'text-green-700'
                    }`}>
                      {pao.percentRemaining}% Fresh
                    </span>
                  </div>

                  {/* Visual Bar */}
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        isExpired ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-green-600'
                      }`}
                      style={{ width: `${pao.percentRemaining}%` }}
                    />
                  </div>

                  <p className="text-[11px] text-charcoal-light flex items-center gap-1.5 mt-1">
                    {isExpired ? (
                      <AlertTriangle size={12} className="text-red-600 flex-shrink-0" />
                    ) : isWarning ? (
                      <AlertTriangle size={12} className="text-amber-600 flex-shrink-0" />
                    ) : (
                      <ShieldCheck size={12} className="text-green-600 flex-shrink-0" />
                    )}
                    <span className="truncate">{pao.label}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white max-w-lg w-full rounded-sm border border-taupe/40 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-taupe/20 pb-3">
              <h3 className="font-serif text-xl text-charcoal">Add Bottle to Vanity</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-charcoal-muted hover:text-charcoal p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  value={productName}
                  onChange={e => setProductName(e.target.value)}
                  placeholder="e.g. C E Ferulic 15% Vitamin C"
                  className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                    Brand
                  </label>
                  <input
                    type="text"
                    value={brand}
                    onChange={e => setBrand(e.target.value)}
                    placeholder="e.g. SkinCeuticals"
                    className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value as VanityCategory)}
                    className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                  >
                    {CATEGORIES.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                    Date Opened *
                  </label>
                  <input
                    type="date"
                    required
                    value={openedOn}
                    onChange={e => setOpenedOn(e.target.value)}
                    className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                    PAO (Months on Jar Symbol)
                  </label>
                  <select
                    value={paoMonths}
                    onChange={e => setPaoMonths(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                  >
                    <option value={3}>3 Months (L-Ascorbic Acid / Retinoids)</option>
                    <option value={6}>6 Months (Standard Serums / SPF)</option>
                    <option value={12}>12 Months (Creams & Cleansers)</option>
                    <option value={24}>24 Months (Powders & Balms)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                    Price ($ / €) (Optional)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={e => setPrice(e.target.value)}
                    placeholder="182.00"
                    className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold tracking-editorial uppercase text-charcoal mb-1">
                    Key Actives (Comma-separated)
                  </label>
                  <input
                    type="text"
                    value={actives}
                    onChange={e => setActives(e.target.value)}
                    placeholder="L-Ascorbic Acid, Ferulic"
                    className="w-full px-3 py-2 border border-taupe/40 rounded-sm text-sm focus:outline-hidden focus:border-bronze"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-taupe/40 text-xs font-medium rounded-sm hover:border-charcoal transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-bronze text-white text-xs uppercase tracking-editorial font-medium rounded-sm hover:bg-bronze-dark transition-colors"
                >
                  Add to Shelf
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

