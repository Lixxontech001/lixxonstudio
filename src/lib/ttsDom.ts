/**
 * DOM helpers for sentence-level highlighting (Milestone 3).
 *
 * The article body is sanitised HTML (dangerouslySetInnerHTML). To highlight at
 * sentence granularity we walk the leaf blocks (p / headings / li / blockquote),
 * split their text into sentences and wrap each sentence's content — including any
 * inline <strong>/<a>/<abbr> children — in <span data-tts-sentence="i"> using the
 * Range API (extract + insert, processed last-to-first so offsets stay valid).
 */
import type { TtsSentence } from './tts';

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, li, blockquote';
const SENTENCE_ATTR = 'data-tts-sentence';

/** Remove sentence wrappers (keeps the inner markup) so re-runs are idempotent. */
export function unwrapSentences(container: HTMLElement): void {
  for (const span of Array.from(container.querySelectorAll(`span[${SENTENCE_ATTR}]`))) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  }
}

const SENTENCE_RE = /[^.!?…]+[.!?…]+["'”’)]*|[^.!?…]+$/g;

function textNodesIn(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    nodes.push(n as Text);
    n = walker.nextNode();
  }
  return nodes;
}

/**
 * Wrap every sentence in the article container. Returns the sentence list in
 * speaking order (headings flagged so they can be skipped).
 */
export function attachSentenceSpans(container: HTMLElement): TtsSentence[] {
  unwrapSentences(container);

  const blocks = Array.from(container.querySelectorAll(BLOCK_SELECTOR)).filter(
    (el) => el.closest(`[${SENTENCE_ATTR}]`) === null
  );

  const sentences: TtsSentence[] = [];
  let globalIndex = 0;

  blocks.forEach((block, paragraph) => {
    const kind: TtsSentence['kind'] = /^H[1-4]$/.test(block.tagName) ? 'heading' : 'text';
    const nodes = textNodesIn(block);
    if (nodes.length === 0) return;

    // concatenated text + offset map
    const fullText = nodes.map((n) => n.nodeValue ?? '').join('');
    const starts: number[] = [];
    let acc = 0;
    for (const n of nodes) {
      starts.push(acc);
      acc += (n.nodeValue ?? '').length;
    }
    const locate = (offset: number): [Text, number] => {
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        if (offset >= starts[i]) return [nodes[i], offset - starts[i]];
      }
      return [nodes[0], 0];
    };

    const ranges: [number, number, string][] = [];
    for (const m of fullText.matchAll(SENTENCE_RE)) {
      const start = m.index ?? 0;
      const text = m[0].trim();
      if (!text) continue;
      ranges.push([start, start + m[0].length, text]);
    }
    if (ranges.length === 0) return;

    // last → first so earlier offsets stay valid while we move nodes
    for (let r = ranges.length - 1; r >= 0; r -= 1) {
      const [start, end, text] = ranges[r];
      const index = globalIndex + r;
      const [startNode, startOffset] = locate(start);
      const [endNode, endOffset] = locate(end);
      try {
        const range = document.createRange();
        range.setStart(startNode, Math.min(startOffset, (startNode.nodeValue ?? '').length));
        range.setEnd(endNode, Math.min(endOffset, (endNode.nodeValue ?? '').length));
        const span = document.createElement('span');
        span.setAttribute(SENTENCE_ATTR, String(index));
        span.appendChild(range.extractContents());
        range.insertNode(span);
      } catch {
        // Range rejected (rare) — sentence still speaks; just without its own span.
      }
      sentences[index] = { index, text, kind, paragraph };
    }
    globalIndex += ranges.length;
  });

  return sentences.filter(Boolean);
}

/** Sentence index for a click anywhere in the article (nearest sentence/paragraph). */
export function sentenceIndexFromEvent(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const span = target.closest(`span[${SENTENCE_ATTR}]`);
  if (span) return Number(span.getAttribute(SENTENCE_ATTR));
  const block = target.closest(BLOCK_SELECTOR);
  if (block) {
    const first = block.querySelector(`span[${SENTENCE_ATTR}]`);
    return first ? Number(first.getAttribute(SENTENCE_ATTR)) : null;
  }
  return null;
}

/** Highlight one sentence (and scroll it into view). */
export function highlightSentence(container: HTMLElement | null, index: number): void {
  if (!container) return;
  for (const el of Array.from(container.querySelectorAll(`span[${SENTENCE_ATTR}].tts-active`))) {
    el.classList.remove('tts-active');
  }
  const span = container.querySelector(`span[${SENTENCE_ATTR}="${index}"]`);
  if (span) {
    span.classList.add('tts-active');
    span.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
