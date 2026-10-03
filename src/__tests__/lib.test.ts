import { describe, it, expect } from 'vitest';
import { sanitizeHtml, escapeHtml } from '../lib/sanitize';
import { renderMarkdown, extractHeadings, readingTime, markdownToText, slugifyHeading } from '../lib/markdown';
import { formatMoney, parsePrice } from '../lib/money';
import { toCsv } from '../admin/lib/csv';

describe('sanitizeHtml', () => {
  it('strips scripts and event handlers', () => {
    const out = sanitizeHtml('<p onclick="x()">hi</p><script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(out).not.toMatch(/script|onerror|onclick/i);
    expect(out).toContain('hi');
  });
  it('blocks javascript: URLs', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toMatch(/javascript:/i);
  });
  it('escapes HTML entities', () => {
    expect(escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });
});

describe('markdown', () => {
  it('renders headings with ids and paragraphs', () => {
    const html = renderMarkdown('## Hello World\n\nSome **bold** text.');
    expect(html).toContain('id="hello-world"');
    expect(html).toContain('<strong>bold</strong>');
  });
  it('never emits raw script from content', () => {
    expect(renderMarkdown('<script>alert(1)</script> text')).not.toMatch(/<script/i);
  });
  it('extracts h2/h3 headings', () => {
    const hs = extractHeadings('## A\n### B\n#### C\n## D');
    expect(hs.map(h => h.text)).toEqual(['A', 'B', 'D']);
    expect(hs[1].level).toBe(3);
  });
  it('estimates reading time (min 1)', () => {
    expect(readingTime('')).toBe(1);
    expect(readingTime(Array(1000).fill('word').join(' '))).toBeGreaterThanOrEqual(4);
  });
  it('strips markdown to text', () => {
    expect(markdownToText('# T\n\n**x** _y_ [l](http://a)')).toMatch(/x y l/);
  });
  it('slugifies headings', () => {
    expect(slugifyHeading("Niacinamide & Retinol: What's Safe?")).toBe('niacinamide-retinol-what-s-safe');
  });
});

describe('money', () => {
  it('formats USD', () => expect(formatMoney(12.5, 'USD', 'en-US')).toBe('$12.50'));
  it('parses price strings', () => {
    expect(parsePrice('$1,299.99')).toBe(1299.99);
    expect(parsePrice(null)).toBe(0);
    expect(parsePrice(7)).toBe(7);
  });
});

describe('csv', () => {
  it('quotes and neutralises formula injection', () => {
    const csv = toCsv([{ a: '=SUM(1)', b: 'x,"y"', c: null }]);
    const [header, row] = csv.split('\r\n');
    expect(header).toBe('a,b,c');
    expect(row).toBe(`'=SUM(1),"x,""y""",`);
  });
  it('returns empty for no rows', () => expect(toCsv([])).toBe(''));
});
