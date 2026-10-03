import { Sparkles } from 'lucide-react';

/** "Key takeaways" box rendered from `posts.takeaways[]` (admin-managed, no AI). */
export default function KeyTakeaways({ items }: { items?: string[] | null }) {
  if (!items || items.length === 0) return null;
  return (
    <aside aria-label="Key takeaways" className="my-10 p-6 md:p-8 bg-taupe-light/50 border-l-2 border-bronze rounded-sm print:border print:bg-white">
      <h2 className="flex items-center gap-2 text-[11px] tracking-editorial uppercase text-bronze font-medium mb-4"><Sparkles size={14} strokeWidth={1.5} /> Key takeaways</h2>
      <ul className="space-y-3">
        {items.map((t, i) => (
          <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-charcoal">
            <span className="font-serif text-bronze text-lg leading-none mt-0.5">{String(i + 1).padStart(2, '0')}</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
