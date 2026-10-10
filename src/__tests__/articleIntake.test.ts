import { describe, expect, it } from 'vitest';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { DocxImportError, extractDocxText } from '../lib/articleDocx';
import {
  addLagosDays,
  countArticleWords,
  isoToLagosInput,
  lagosDateKey,
  lagosDateTimeLabel,
  lagosDayAtTimeToIso,
  lagosInputToIso,
  parseArticleTags,
  slugifyArticleTitle,
  startOfLagosWeek,
  validateIntakeMetadata,
  type IntakeMetadataDraft,
} from '../lib/articleIntake';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function zipEntry(name: string, data: Uint8Array, method: 0 | 8 = 0): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const compressed = method === 8 ? new Uint8Array(deflateRawSync(data)) : data;
  const local = new Uint8Array(30 + nameBytes.length + compressed.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, 0, true);
  lv.setUint16(8, method, true);
  lv.setUint32(18, compressed.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(compressed, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, 0, true);
  cv.setUint16(10, method, true);
  cv.setUint32(20, compressed.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  const zip = new Uint8Array(local.length + central.length + eocd.length);
  zip.set(local, 0);
  zip.set(central, local.length);
  zip.set(eocd, local.length + central.length);
  return zip;
}

const xml = (inner: string) => new TextEncoder().encode(
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WORD_NS}"><w:body>${inner}</w:body></w:document>`,
);

const validDraft = (): IntakeMetadataDraft => ({
  title: 'Owner supplied title',
  slug: 'owner-supplied-title',
  categoryId: 'category-1',
  tags: ['editorial'],
  coverImage: 'https://cdn.example.test/cover.jpg',
  coverImageAlt: 'A selected cover image',
  proposedAt: '2026-10-06T08:00',
});

describe('DOCX article import', () => {
  it('extracts visible prose without trimming spaces or paragraph boundaries', async () => {
    const document = xml(
      '<w:p><w:r><w:t xml:space="preserve">  Hello</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>world &amp;</w:t></w:r></w:p>' +
      '<w:p></w:p>' +
      '<w:p><w:r><w:t>Next</w:t><w:br/><w:t>line</w:t></w:r></w:p>',
    );
    const text = await extractDocxText(zipEntry('word/document.xml', document));
    expect(text).toBe('  Hello\tworld &\n\nNext\nline');
  });

  it('supports standard deflated DOCX entries', async () => {
    const document = xml('<w:p><w:r><w:t>Article text.</w:t></w:r></w:p>');
    const bytes = zipEntry('word/document.xml', document, 8);
    const text = await extractDocxText(bytes, async compressed => new Uint8Array(inflateRawSync(compressed)));
    expect(text).toBe('Article text.');
  });

  it('fails closed on tracked changes instead of silently picking a revision', async () => {
    const document = xml('<w:p><w:ins><w:r><w:t>Changed text</w:t></w:r></w:ins></w:p>');
    await expect(extractDocxText(zipEntry('word/document.xml', document))).rejects.toThrow(/tracked changes/i);
  });

  it('rejects non-DOCX, missing document XML and password-protected entries', async () => {
    await expect(extractDocxText(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(DocxImportError);
    await expect(extractDocxText(zipEntry('word/other.xml', xml('<w:p/>')))).rejects.toThrow(/missing its main article/i);
    const protectedZip = zipEntry('word/document.xml', xml('<w:p/>'));
    // General-purpose bit 0 is the ZIP encryption flag in the central record.
    const centralOffset = new DataView(protectedZip.buffer).getUint32(protectedZip.length - 22 + 16, true);
    new DataView(protectedZip.buffer).setUint16(centralOffset + 8, 1, true);
    await expect(extractDocxText(protectedZip)).rejects.toThrow(/password-protected/i);
  });
});

describe('article intake validation', () => {
  it('counts real Unicode words without rewriting text', () => {
    expect(countArticleWords('  L’été, nāme—48 words! ')).toBe(4);
    expect(countArticleWords('')).toBe(0);
  });

  it('normalizes slugs and parses comma-separated tags deterministically', () => {
    expect(slugifyArticleTitle('  Café & Well-being!  ')).toBe('cafe-well-being');
    expect(parseArticleTags(' Skin, WELLNESS, skin ,, ')).toEqual(['skin', 'wellness']);
  });

  it('converts Lagos local time to UTC explicitly, independent of device timezone', () => {
    expect(lagosInputToIso('2026-10-05T08:00')).toBe('2026-10-05T07:00:00.000Z');
    expect(isoToLagosInput('2026-10-05T07:00:00.000Z')).toBe('2026-10-05T08:00');
    expect(lagosDayAtTimeToIso('2026-10-06', '09:30')).toBe('2026-10-06T08:30:00.000Z');
    expect(lagosDateKey('2026-10-05T23:30:00.000Z')).toBe('2026-10-06');
    expect(lagosDateTimeLabel('2026-10-05T07:00:00.000Z')).toContain('studio clock');
    expect(lagosDateTimeLabel('2026-10-05T07:00:00.000Z')).not.toMatch(/WAT|Lagos|Nigeria/);
  });

  it('rejects impossible wall times and provides Monday-first calendar arithmetic', () => {
    expect(lagosInputToIso('2026-02-30T08:00')).toBeNull();
    expect(lagosInputToIso('2026-10-05T24:00')).toBeNull();
    expect(addLagosDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(startOfLagosWeek('2026-10-07')).toBe('2026-10-05');
  });

  it('blocks missing metadata, duplicate slugs, bad image and past dates; word-band is only a warning', () => {
    const draft = validDraft();
    const issues = validateIntakeMetadata(draft, 3200, ['owner-supplied-title'], new Date('2026-10-05T00:00:00Z'));
    expect(issues.filter(issue => issue.severity === 'error').map(issue => issue.field)).toContain('slug');
    expect(issues.some(issue => issue.field === 'wordCount' && issue.severity === 'warning')).toBe(true);
    expect(validateIntakeMetadata(draft, 3600, [], new Date('2026-10-05T00:00:00Z'))).toEqual([]);
    const broken = { ...draft, categoryId: '', tags: [], coverImage: 'http://example.test/x.png', coverImageAlt: '', proposedAt: '2026-10-04T08:00' };
    const blocking = validateIntakeMetadata(broken, 3600, [], new Date('2026-10-05T00:00:00Z'));
    expect(blocking.filter(issue => issue.severity === 'error').map(issue => issue.field)).toEqual(
      expect.arrayContaining(['categoryId', 'tags', 'coverImage', 'coverImageAlt', 'proposedAt']),
    );
  });
});
