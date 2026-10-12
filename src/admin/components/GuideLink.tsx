import { GUIDE_LINK_LABEL, guideHref, guideShort } from '../lib/guide';

interface GuideLinkProps {
  /** The anchor of the guide section for this action. */
  section: string;
  /** The page and field to come back to, for example /admin/automation/keys#vapid-subject. */
  back: string;
  /** In a row of buttons: the link alone, since the sentence is already on the row. */
  compact?: boolean;
  className?: string;
}

/**
 * The one in-place help pattern: one or two plain sentences next to the action, then a link into the guide at the
 * matching section. The link carries the page and field it came from, so the guide's Back returns to it.
 */
export default function GuideLink({ section, back, compact = false, className = '' }: GuideLinkProps) {
  return (
    <p className={`text-xs leading-5 text-charcoal-muted ${className}`.trim()}>
      {!compact && <>{guideShort(section)}{' '}</>}
      <a href={guideHref(section, back)} className="underline hover:text-bronze">
        {GUIDE_LINK_LABEL}
      </a>
    </p>
  );
}
