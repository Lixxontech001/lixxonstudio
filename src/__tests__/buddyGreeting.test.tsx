// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BuddyGreeting from '../buddy/BuddyGreeting';
import { CONTINUE_DELAY_MS } from '../buddy/buddyMotion';
import { greetingForHour, localDateString } from '../buddy/buddyDate';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function render(element: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(element);
  });
  return host;
}

function continueButton(): HTMLButtonElement | null {
  return host?.querySelector<HTMLButtonElement>('.buddy-greeting-continue') ?? null;
}

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('Buddy greeting timing', () => {
  it('waits about 9.5 seconds before Continue appears, which sits inside the 8 to 15 second window', () => {
    vi.useFakeTimers();
    expect(CONTINUE_DELAY_MS).toBeGreaterThanOrEqual(8000);
    expect(CONTINUE_DELAY_MS).toBeLessThanOrEqual(15000);
    const onContinue = vi.fn();
    render(<BuddyGreeting onContinue={onContinue} hour={9} reducedMotion={false} />);
    expect(continueButton()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(CONTINUE_DELAY_MS - 100);
    });
    expect(continueButton()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(continueButton()).not.toBeNull();
    act(() => continueButton()?.click());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('shows Continue at once when reduced motion is on', () => {
    const onContinue = vi.fn();
    render(<BuddyGreeting onContinue={onContinue} hour={9} reducedMotion />);
    expect(continueButton()).not.toBeNull();
  });

  it('says the time of day in plain words, with no country or city', () => {
    render(<BuddyGreeting onContinue={() => {}} hour={14} reducedMotion />);
    expect(host?.textContent).toContain('Good afternoon.');
    expect(host?.textContent).not.toMatch(/Nigeria|Naira|Lagos/i);
  });
});

describe('Buddy greeting time-of-day lines', () => {
  it('uses morning, afternoon, evening and night at the usual hours', () => {
    expect(greetingForHour(5)).toBe('Good morning.');
    expect(greetingForHour(11)).toBe('Good morning.');
    expect(greetingForHour(12)).toBe('Good afternoon.');
    expect(greetingForHour(17)).toBe('Good evening.');
    expect(greetingForHour(21)).toBe('Good evening.');
    expect(greetingForHour(22)).toBe('Good night.');
    expect(greetingForHour(3)).toBe('Good night.');
  });

  it('builds today’s date from the device clock, not UTC', () => {
    expect(localDateString(new Date(2026, 9, 9, 0, 30))).toBe('2026-10-09');
    expect(localDateString(new Date(2026, 0, 2, 23, 59))).toBe('2026-01-02');
  });
});
