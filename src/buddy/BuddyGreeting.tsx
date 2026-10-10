import { useEffect, useState } from 'react';
import { greetingForHour } from './buddyDate';
import { CONTINUE_DELAY_MS, prefersReducedMotion } from './buddyMotion';

interface BuddyGreetingProps {
  onContinue: () => void;
  hour?: number;
  reducedMotion?: boolean;
}

/**
 * Buddy's greeting: a short animation with a time-of-day line, then a Continue button.
 * With reduced motion on, Continue shows straight away and the animation is switched off in CSS.
 */
export default function BuddyGreeting({ onContinue, hour = new Date().getHours(), reducedMotion = prefersReducedMotion() }: BuddyGreetingProps) {
  const [ready, setReady] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setTimeout(() => setReady(true), CONTINUE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [reducedMotion]);

  return (
    <section className="buddy-greeting" data-testid="buddy-greeting" aria-label="Greeting from Buddy">
      <svg className="buddy-greeting-mark" viewBox="0 0 120 24" aria-hidden="true" focusable="false">
        <line className="buddy-greeting-line" x1="4" y1="12" x2="116" y2="12" pathLength={1} />
      </svg>
      <p className="buddy-greeting-line-text">{greetingForHour(hour)}</p>
      <p className="buddy-greeting-sub">Buddy is getting your briefing ready.</p>
      {ready ? (
        <button type="button" className="buddy-button buddy-button--solid buddy-greeting-continue" onClick={onContinue}>
          Continue
        </button>
      ) : (
        <p className="buddy-greeting-wait" aria-hidden="true">&nbsp;</p>
      )}
    </section>
  );
}
