import { Clock, ShoppingBag } from 'lucide-react';
import { Link } from '../../context/NavigationContext';
import SmartImage from '../SmartImage';
import { prettifySlug, type SearchResultRow } from '../../lib/searchQuery';

interface Props {
  row: SearchResultRow;
  /** Highlighted hit for keyboard navigation. */
  active?: boolean;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SearchResultCard({ row, active = false }: Props) {
  const isProduct = row.result_kind === 'product';
  const route = isProduct
    ? ({ name: 'shop-product', slug: row.slug } as const)
    : ({ name: 'article', slug: row.slug } as const);

  return (
    <Link
      to={route}
      data-search-result
      aria-current={active ? 'true' : undefined}
      className={`group flex flex-col text-left rounded-sm transition-shadow ${
        active ? 'ring-2 ring-bronze ring-offset-2 ring-offset-cream' : ''
      }`}
    >
      <div className="img-zoom rounded-sm overflow-hidden luxury-shadow relative aspect-[4/5] bg-taupe-light/40">
        {row.image_url ? (
          <SmartImage
            src={row.image_url}
            alt={row.title}
            className="w-full h-full object-cover"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 30vw"
            aspectRatio="4/5"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-taupe">
            <ShoppingBag size={28} strokeWidth={1} aria-hidden="true" />
          </div>
        )}
        <span className="absolute top-4 left-4 text-[9px] tracking-editorial uppercase text-white bg-charcoal/60 backdrop-blur-md px-3 py-1.5 rounded-full">
          {isProduct ? 'Product' : row.category_name || 'Article'}
        </span>
      </div>

      <div className="mt-5 flex flex-col flex-1">
        <h3 className="font-serif text-xl text-charcoal leading-snug group-hover:text-bronze transition-colors duration-300 line-clamp-3">
          {row.title}
        </h3>
        {row.excerpt && <p className="text-charcoal-muted text-sm mt-2.5 leading-relaxed line-clamp-2">{row.excerpt}</p>}

        <div className="flex flex-wrap items-center gap-3 mt-4 text-[11px] text-charcoal-muted">
          {isProduct ? (
            <>
              {row.price_label && (
                <span className="font-medium text-charcoal">
                  {row.currency && row.currency !== 'USD' ? `${row.price_label} ${row.currency}` : `$${row.price_label}`}
                </span>
              )}
              <span className="text-taupe-dark">·</span>
              <span>In the shop</span>
            </>
          ) : (
            <>
              <span>{formatDate(row.published_at)}</span>
              {row.reading_time_minutes ? (
                <>
                  <span className="text-taupe-dark">·</span>
                  <span className="flex items-center gap-1">
                    <Clock size={10} strokeWidth={1.5} aria-hidden="true" /> {row.reading_time_minutes} min
                  </span>
                </>
              ) : null}
              {row.author_name && (
                <>
                  <span className="text-taupe-dark">·</span>
                  <span>{row.author_name}</span>
                </>
              )}
            </>
          )}
        </div>

        {(row.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {(row.tags ?? []).slice(0, 3).map((tag) => (
              <span key={tag} className="text-[10px] text-charcoal-muted/80 bg-taupe-light/50 rounded-full px-2.5 py-1">
                #{prettifySlug(tag)}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
