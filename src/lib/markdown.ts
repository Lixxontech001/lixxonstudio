import { sanitizeHtml, escapeHtml } from './sanitize';

// NUL is used as a stash delimiter because it can never appear in sanitised user content.
const PLACEHOLDER = String.fromCharCode(0);

export interface Heading { id: string; text: string; level: 2 | 3 }

export function slugifyHeading(text: string): string {
  return text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
}

/** Headings extracted from Markdown-lite source (for the sticky table of contents). */
export function extractHeadings(content: string | null | undefined): Heading[] {
  if (!content) return [];
  const out: Heading[] = [];
  const seen = new Map<string, number>();
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    const m = /^(##|###)\s+(.+)$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/[*_`]/g, '').trim();
    let id = slugifyHeading(text) || 'section';
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    out.push({ id, text, level: m[1].length === 2 ? 2 : 3 });
  }
  return out;
}

/** Reading time from word count (225 wpm). */
export function readingTime(content: string | null | undefined): number {
  const words = (content || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 225));
}

/**
 * Markdown-lite → sanitised HTML.
 * Text is HTML-escaped BEFORE inline formatting, then the whole thing runs through DOMPurify,
 * so neither authored content nor a compromised editor account can inject markup.
 */
export function renderMarkdown(content: string | null | undefined, opts: { glossary?: Record<string, string> } = {}): string {
  if (!content) return '';
  const lines = content.split('\n');
  const html: string[] = [];
  let inUl = false, inOl = false, inCode = false;
  const codeBuf: string[] = [];
  const seen = new Map<string, number>();

  const closeLists = () => {
    if (inUl) { html.push('</ul>'); inUl = false; }
    if (inOl) { html.push('</ol>'); inOl = false; }
  };

  const terms = opts.glossary ? Object.keys(opts.glossary).sort((a, b) => b.length - a.length) : [];
  const termRe = terms.length ? new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i') : null;

  const inline = (raw: string): string => {
    // placeholders so link/image URLs and code aren't double-processed
    const stash: string[] = [];
    const keep = (s: string) => { stash.push(s); return `${PLACEHOLDER}${stash.length - 1}${PLACEHOLDER}`; };
    let t = escapeHtml(raw);
    t = t.replace(/`([^`]+)`/g, (_m, c) => keep(`<code>${c}</code>`));
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => keep(`<img src="${src}" alt="${alt}" loading="lazy" />`));
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, href) => keep(`<a href="${href}">${text}</a>`));
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
         .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
         .replace(/~~(.+?)~~/g, '<s>$1</s>')
         .replace(/==(.+?)==/g, '<mark>$1</mark>');
    if (termRe) {
      // mark the first occurrence of each glossary term in this fragment
      const used = new Set<string>();
      t = t.replace(new RegExp(termRe.source, 'gi'), (m) => {
        const key = m.toLowerCase();
        if (used.has(key)) return m;
        used.add(key);
        return keep(`<abbr class="glossary-term" data-term="${escapeHtml(key)}" title="${escapeHtml(opts.glossary?.[key] || opts.glossary?.[Object.keys(opts.glossary || {}).find((k) => k.toLowerCase() === key) || ''] || '')}">${m}</abbr>`);
      });
    }
    return t.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_m, i) => stash[Number(i)]);
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('```')) {
      if (inCode) { html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`); codeBuf.length = 0; inCode = false; }
      else { closeLists(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(rawLine); continue; }
    if (!trimmed) { closeLists(); continue; }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) { closeLists(); html.push('<hr />'); continue; }

    const h = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (h) {
      closeLists();
      const level = h[1].length;
      const text = h[2];
      let id = slugifyHeading(text.replace(/[*_`]/g, '')) || 'section';
      const n = (seen.get(id) || 0) + 1; seen.set(id, n); if (n > 1) id = `${id}-${n}`;
      html.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      continue;
    }
    if (trimmed.startsWith('> ')) { closeLists(); html.push(`<blockquote>${inline(trimmed.slice(2))}</blockquote>`); continue; }
    if (/^\d+\.\s/.test(trimmed)) {
      if (inUl) { html.push('</ul>'); inUl = false; }
      if (!inOl) { html.push('<ol>'); inOl = true; }
      html.push(`<li>${inline(trimmed.replace(/^\d+\.\s/, ''))}</li>`);
      continue;
    }
    if (/^[-*]\s/.test(trimmed)) {
      if (inOl) { html.push('</ol>'); inOl = false; }
      if (!inUl) { html.push('<ul>'); inUl = true; }
      html.push(`<li>${inline(trimmed.slice(2))}</li>`);
      continue;
    }
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)) { closeLists(); html.push(`<figure>${inline(trimmed)}</figure>`); continue; }
    closeLists();
    html.push(`<p>${inline(trimmed)}</p>`);
  }
  if (inCode) html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  closeLists();
  return sanitizeHtml(html.join(''));
}

/** Plain-text version (for TTS, previews, search snippets). */
export function markdownToText(content: string | null | undefined): string {
  return (content || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~=]+/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
