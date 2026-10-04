/**
 * Sentence-span DOM helpers (Milestone 3) — highlighting scaffolding for the
 * listen-to-articles player. jsdom supports the Range API used here.
 */
import { describe, it, expect } from 'vitest';
import { attachSentenceSpans, sentenceIndexFromEvent, unwrapSentences } from '../lib/ttsDom';

function article(): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h2 id="h">Barrier first. Moisture second.</h2>
    <p>The barrier keeps <strong>water</strong> in. It also keeps irritants out.</p>
    <p>A simple <a href="/x">routine</a> wins.</p>
  `;
  document.body.appendChild(el);
  return el;
}

describe('attachSentenceSpans', () => {
  it('wraps every sentence in a data-tts-sentence span and keeps inline markup', () => {
    const el = article();
    const sentences = attachSentenceSpans(el);
    expect(sentences.map((s) => s.text)).toEqual([
      'Barrier first.', 'Moisture second.',
      'The barrier keeps water in.', 'It also keeps irritants out.',
      'A simple routine wins.',
    ]);
    expect(sentences[0].kind).toBe('heading');
    expect(sentences[2].kind).toBe('text');
    expect(el.querySelector('strong')?.textContent).toBe('water');
    expect(el.querySelector('a')?.textContent).toBe('routine');
    expect(el.querySelectorAll('span[data-tts-sentence]')).toHaveLength(5);
  });

  it('is idempotent across re-runs (content changes)', () => {
    const el = article();
    attachSentenceSpans(el);
    const again = attachSentenceSpans(el);
    expect(again).toHaveLength(5);
    expect(el.querySelectorAll('span[data-tts-sentence]')).toHaveLength(5);
  });

  it('maps clicks to the nearest sentence index and unwraps cleanly', () => {
    const el = article();
    const sentences = attachSentenceSpans(el);
    const span = el.querySelector('span[data-tts-sentence="3"]')!;
    expect(sentenceIndexFromEvent(span)).toBe(3);
    // a nested inline element still maps to its sentence
    expect(sentenceIndexFromEvent(el.querySelector('strong'))).toBe(2);
    expect(sentenceIndexFromEvent(null)).toBeNull();
    unwrapSentences(el);
    expect(el.querySelectorAll('span[data-tts-sentence]')).toHaveLength(0);
    expect(el.querySelector('strong')?.textContent).toBe('water');
    expect(sentences[3].paragraph).toBe(1);
  });
});
