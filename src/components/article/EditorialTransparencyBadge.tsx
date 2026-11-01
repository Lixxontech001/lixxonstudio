import { useState } from 'react';
import { ShieldCheck, Info, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { Link } from '../../context/NavigationContext';

export interface EditorialTransparencyBadgeProps {
  authorName?: string;
  categoryName?: string;
  publishedAt?: string;
}

export default function EditorialTransparencyBadge({
  authorName = 'Lixxon Studio Editorial Team',
  categoryName = 'Skincare & Style',
  publishedAt,
}: EditorialTransparencyBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      aria-label="Editorial Standards & Fact-Check Disclosure"
      className="my-8 bg-taupe-light/30 border border-taupe/40 rounded-sm p-4 text-xs text-charcoal transition-all"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-full bg-bronze/10 text-bronze flex items-center justify-center flex-shrink-0">
            <ShieldCheck size={14} strokeWidth={1.75} />
          </div>
          <div>
            <span className="font-medium text-charcoal flex items-center gap-1.5">
              Peer-Reviewed &amp; Fact-Checked Editorial Standard
            </span>
            <p className="text-[11px] text-charcoal-muted mt-0.5">
              Verified for scientific rigor, ingredient transparency, and unbiased formulation analysis.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-[11px] text-bronze hover:underline flex items-center gap-1 flex-shrink-0"
        >
          {expanded ? 'Less info' : 'View standards'}
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-taupe/30 space-y-2.5 text-[11px] text-charcoal-muted leading-relaxed animate-fade-in">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="bg-white/80 p-2.5 rounded border border-taupe/20">
              <span className="font-semibold text-charcoal flex items-center gap-1 mb-1">
                <CheckCircle2 size={12} className="text-bronze" /> Scientific Evidence
              </span>
              <p>Formulation claims cite clinical trial data, published biochemistry journals, and dermatological guidelines.</p>
            </div>
            <div className="bg-white/80 p-2.5 rounded border border-taupe/20">
              <span className="font-semibold text-charcoal flex items-center gap-1 mb-1">
                <CheckCircle2 size={12} className="text-bronze" /> Editorial Independence
              </span>
              <p>Our editors and contributors maintain strict independence. We never accept payment for positive ingredient reviews.</p>
            </div>
            <div className="bg-white/80 p-2.5 rounded border border-taupe/20">
              <span className="font-semibold text-charcoal flex items-center gap-1 mb-1">
                <CheckCircle2 size={12} className="text-bronze" /> Actives Glossary
              </span>
              <p>
                Scientific actives reference our transparent{' '}
                <Link to={{ name: 'glossary' }} className="text-bronze underline">
                  Formulation Glossary
                </Link>.
              </p>
            </div>
          </div>
          <p className="italic text-[10px] text-charcoal-muted/80 pt-1">
            Editorial Director: Lixxon Studio Medical &amp; Style Review Board · Last audited: {publishedAt ? new Date(publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Recent edit'}.
          </p>
        </div>
      )}
    </aside>
  );
}
