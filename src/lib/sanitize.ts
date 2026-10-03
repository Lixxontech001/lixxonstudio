import DOMPurify from 'dompurify';

/**
 * Sanitise HTML before it reaches `dangerouslySetInnerHTML`.
 * Article bodies are authored as Markdown-lite and converted to HTML at render time; an
 * editor pasting raw HTML (or a compromised admin account) must not be able to inject scripts.
 */
const config = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'sup', 'sub', 'mark', 'abbr',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'loading', 'rel', 'target', 'id', 'class', 'data-term', 'width', 'height', 'colspan', 'rowspan'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
} satisfies Parameters<typeof DOMPurify.sanitize>[1];

let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  // force safe link behaviour
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href) && !href.startsWith(window.location.origin)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer nofollow ugc');
      }
    }
    if (node.tagName === 'IMG') {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
      const src = node.getAttribute('src') || '';
      if (!/^https?:\/\//i.test(src) && !src.startsWith('/')) node.removeAttribute('src');
    }
  });
}

export function sanitizeHtml(dirty: string): string {
  ensureHooks();
  return DOMPurify.sanitize(dirty, config) as string;
}

/** Escape text that will be interpolated into an HTML string (e.g. by a Markdown-lite renderer). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
