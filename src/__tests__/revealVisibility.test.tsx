// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initReveal } from '../lib/reveal';

const originalIntersectionObserver = window.IntersectionObserver;

function addReveal(top = 0) {
  const element = document.createElement('article');
  element.className = 'reveal';
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100 }),
  });
  document.body.appendChild(element);
  return element;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.classList.remove('js-reveal');
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  Object.defineProperty(window, 'IntersectionObserver', {
    configurable: true,
    value: originalIntersectionObserver,
  });
});

describe('reveal visibility fail-open behaviour', () => {
  it('keeps observing content mounted after the old eight-second cutoff', async () => {
    initReveal();
    vi.advanceTimersByTime(9000);

    const lateCard = addReveal();
    await Promise.resolve();
    vi.advanceTimersByTime(50);

    expect(lateCard.classList.contains('revealed') || !document.documentElement.classList.contains('js-reveal')).toBe(true);
  });

  it('does not gate content without IntersectionObserver and scopes hidden CSS to js-reveal', () => {
    Reflect.deleteProperty(window, 'IntersectionObserver');
    initReveal();
    const card = addReveal();
    const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

    expect(document.documentElement.classList.contains('js-reveal')).toBe(false);
    expect(card.classList.contains('revealed')).toBe(false);
    const baseRevealRule = css.match(/(?:^|\n)\s*\.reveal\s*\{[^}]*\}/)?.[0] || '';
    expect(baseRevealRule).toMatch(/opacity:\s*1/);
    expect(baseRevealRule).not.toMatch(/opacity:\s*0/);
    expect(css).toMatch(/\.js-reveal\s+\.reveal\s*\{[^}]*opacity:\s*0/);
  });

  it('uses the three-second failsafe when the observer never fires', () => {
    class SilentIntersectionObserver {
      observe() { /* intentionally silent */ }
      unobserve() { /* intentionally silent */ }
    }
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: SilentIntersectionObserver,
    });

    initReveal();
    const firstCard = addReveal(1000);
    const secondCard = addReveal(1400);
    vi.advanceTimersByTime(3000);

    expect(firstCard.classList.contains('revealed')).toBe(true);
    expect(secondCard.classList.contains('revealed')).toBe(true);
  });
});
