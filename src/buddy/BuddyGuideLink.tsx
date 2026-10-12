import { GUIDE_LINK_LABEL, guideHref, guideShort } from '../admin/lib/guide';

/**
 * The guide line on Buddy's own screens. Same words as everywhere else: one plain sentence, then the link that
 * opens the guide at the matching section. Back on the guide returns to Buddy.
 */
export default function BuddyGuideLink({ section }: { section: string }) {
  return (
    <p className="buddy-empty">
      {guideShort(section)}{' '}
      <a href={guideHref(section, '/buddy')} className="underline">{GUIDE_LINK_LABEL}</a>
    </p>
  );
}
