import type { BriefingSection } from './buddyChatStore';

interface BuddyBriefingCardProps {
  /** The plain-text briefing, shown when there are no sections (the quiet case). */
  content: string;
  sections: BriefingSection[] | null;
}

/** One briefing, shown as titled sections. Every line here was written from real counts on the server. */
export default function BuddyBriefingCard({ content, sections }: BuddyBriefingCardProps) {
  if (!sections) {
    return (
      <div className="buddy-msg buddy-msg--briefing" data-testid="buddy-briefing-quiet">
        <p className="buddy-briefing-quiet">{content}</p>
      </div>
    );
  }
  return (
    <article className="buddy-msg buddy-msg--briefing" aria-label="Morning briefing" data-testid="buddy-briefing">
      {sections.map((section) => (
        <section key={section.id} className="buddy-briefing-section">
          <h3 className="buddy-briefing-title">{section.title}</h3>
          <ul className="buddy-briefing-lines">
            {section.lines.map((line, index) => (
              <li key={`${section.id}-${index}`}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
