import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from '../context/NavigationContext';
import type { Route } from '../context/NavigationContext';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  buildRoute: (page: number) => Route;
}

export default function Pagination({ currentPage, totalPages, buildRoute }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);

  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push(-1);
  }
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push(-2);
    pages.push(totalPages);
  }

  return (
    <nav className="flex items-center justify-center gap-2 mt-14" aria-label="Pagination">
      {currentPage > 1 && (
        <Link
          to={buildRoute(currentPage - 1)}
          className="w-10 h-10 flex items-center justify-center text-charcoal hover:text-bronze transition-colors"
          ariaLabel="Previous page"
        >
          <ChevronLeft size={18} strokeWidth={1.5} />
        </Link>
      )}

      {pages.map((p, i) =>
        p < 0 ? (
          <span key={`gap-${i}`} className="px-2 text-charcoal-muted">…</span>
        ) : (
          <Link
            key={p}
            to={buildRoute(p)}
            className={`w-10 h-10 flex items-center justify-center text-sm font-medium transition-all duration-300 rounded-sm ${
              p === currentPage
                ? 'bg-charcoal text-white'
                : 'text-charcoal hover:bg-taupe-light'
            }`}
          >
            {p}
          </Link>
        )
      )}

      {currentPage < totalPages && (
        <Link
          to={buildRoute(currentPage + 1)}
          className="w-10 h-10 flex items-center justify-center text-charcoal hover:text-bronze transition-colors"
          ariaLabel="Next page"
        >
          <ChevronRight size={18} strokeWidth={1.5} />
        </Link>
      )}
    </nav>
  );
}
