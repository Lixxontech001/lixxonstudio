import { describe, it, expect } from 'vitest';
import {
  extractEditorialKeywords,
  extractKeyTakeaways,
  extractFaqItems,
  cleanMarkdownContent,
  generateSmartExcerpt,
  suggestTags,
  STOP_WORDS,
} from '../lib/editorialKeywords';

const sampleArticle = `
# The Ultimate Guide to Skin Barrier Repair and Niacinamide

When your lipid barrier is compromised, your skin experiences accelerated trans-epidermal water loss (TEWL), persistent redness, and heightened sensitivity. Incorporating a formulated niacinamide serum alongside essential ceramides can restore the cutaneous architecture within two to four weeks.

## Why the Skin Barrier Fails

Over-exfoliation with harsh AHAs and physical scrubs strips the stratum corneum of vital intercellular lipids. Environmental pollution and dry arid climates further deplete naturally occurring fatty acids and cholesterol.

## The Role of Niacinamide and Ceramides

Niacinamide (Vitamin B3) stimulates ceramide synthesis within keratinocytes, enhancing barrier resilience while reducing erythema. Applying a hydrating hyaluronic acid layer prior to your barrier repair moisturizer seals in water without disrupting physiological pH.

## Key Takeaways

- A compromised lipid barrier leads to increased TEWL, dryness, and inflammation.
- Niacinamide accelerates natural ceramide production and soothes redness.
- Avoid active chemical peels until barrier integrity is fully restored.
- Maintain a minimalist routine focused on gentle cleansing and lipid replenishment.

## Frequently Asked Questions

**How long does skin barrier repair take?**
Typically between two to four weeks depending on the degree of TEWL and whether harsh exfoliants are paused.

**Can I use retinol while repairing my barrier?**
No, pause all retinoids and high-strength acids until flaking and stinging subside completely.
`;

describe('editorialKeywords engine', () => {
  it('does not contain nonsense grammatical words in stop words filter', () => {
    expect(STOP_WORDS.has('their')).toBe(true);
    expect(STOP_WORDS.has('which')).toBe(true);
    expect(STOP_WORDS.has('because')).toBe(true);
    expect(STOP_WORDS.has('could')).toBe(true);
    // Skincare terms should never be stop words
    expect(STOP_WORDS.has('serum')).toBe(false);
    expect(STOP_WORDS.has('retinol')).toBe(false);
    expect(STOP_WORDS.has('niacinamide')).toBe(false);
  });

  it('extracts sharp domain focus keyword candidates', () => {
    const result = extractEditorialKeywords(
      sampleArticle,
      'The Ultimate Guide to Skin Barrier Repair and Niacinamide'
    );

    expect(result.focusCandidates.length).toBeGreaterThan(0);
    const candidatePhrases = result.focusCandidates.map(c => c.phrase.toLowerCase());
    
    // Top candidates should contain relevant keyphrases like niacinamide, skin barrier, barrier repair
    expect(candidatePhrases.some(p => p.includes('niacinamide') || p.includes('skin barrier') || p.includes('barrier repair'))).toBe(true);
    
    // None should be nonsense stop words
    candidatePhrases.forEach(p => {
      expect(p).not.toBe('their');
      expect(p).not.toBe('which');
      expect(p).not.toBe('these');
      expect(p).not.toBe('because');
    });
  });

  it('suggests clean editorial tags without filler words', () => {
    const tags = suggestTags(sampleArticle, ['skincare']);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags).not.toContain('skincare'); // excluded because in existingTags
    expect(tags).not.toContain('their');
    expect(tags).not.toContain('which');
    expect(tags).not.toContain('about');
  });

  it('extracts key takeaways correctly', () => {
    const takeaways = extractKeyTakeaways(sampleArticle);
    expect(takeaways.length).toBe(4);
    expect(takeaways[0]).toContain('compromised lipid barrier');
    expect(takeaways[1]).toContain('Niacinamide accelerates');
  });

  it('extracts FAQ pairs correctly', () => {
    const faqs = extractFaqItems(sampleArticle);
    expect(faqs.length).toBe(2);
    expect(faqs[0].q).toBe('How long does skin barrier repair take?');
    expect(faqs[0].a).toContain('Typically between two to four weeks');
    expect(faqs[1].q).toBe('Can I use retinol while repairing my barrier?');
    expect(faqs[1].a).toContain('pause all retinoids');
  });

  it('cleans messy pasted markdown properly', () => {
    const messy = `<p><span>This is a paragraph with &nbsp; and &quot;quotes&quot;</span></p>
“Smart quotes” and ‘smart apostrophe’

###Title without space


A lot of blank lines



Next paragraph.`;

    const cleaned = cleanMarkdownContent(messy);
    expect(cleaned).not.toContain('<p>');
    expect(cleaned).not.toContain('&nbsp;');
    expect(cleaned).toContain('### Title without space');
    expect(cleaned).toContain('"Smart quotes"');
    expect(cleaned).not.toContain('\n\n\n');
  });

  it('generates a clean excerpt', () => {
    const excerpt = generateSmartExcerpt(sampleArticle, 110, 160);
    expect(excerpt.length).toBeGreaterThanOrEqual(50);
    expect(excerpt.length).toBeLessThanOrEqual(165);
    expect(excerpt).not.toContain('#');
  });
});
