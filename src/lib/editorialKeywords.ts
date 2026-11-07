/**
 * High-precision editorial keyword, keyphrase, and tag extraction engine.
 *
 * Designed specifically for beauty, skincare, dermatological science,
 * minimalist style, and wellness publications. Replaces naive word-frequency
 * counters with stop-word filtered n-gram collocations and domain-aware weighting.
 */

// ---------------------------------------------------------------- Comprehensive Stop Words
export const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'almost', 'also', 'although',
  'am', 'an', 'and', 'another', 'any', 'anybody', 'anyhow', 'anyone', 'anything', 'anyway',
  'are', 'aren\'t', 'around', 'as', 'at', 'be', 'became', 'because', 'become', 'becomes',
  'been', 'before', 'beforehand', 'behind', 'being', 'below', 'beside', 'besides', 'between',
  'beyond', 'both', 'but', 'by', 'can', 'can\'t', 'cannot', 'could', 'couldn\'t', 'did',
  'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'done', 'down', 'due', 'during',
  'each', 'either', 'else', 'elsewhere', 'enough', 'especially', 'etc', 'even', 'ever',
  'every', 'everybody', 'everyone', 'everything', 'everywhere', 'few', 'first', 'for',
  'from', 'further', 'furthermore', 'get', 'gets', 'getting', 'give', 'given', 'gives',
  'go', 'goes', 'going', 'gone', 'got', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have',
  'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'hence', 'her', 'here',
  'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'however', 'i', 'i\'d',
  'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its',
  'itself', 'just', 'keep', 'keeps', 'kept', 'know', 'known', 'knows', 'last', 'latter',
  'least', 'less', 'let', 'let\'s', 'like', 'likely', 'little', 'look', 'looked', 'looking',
  'looks', 'made', 'make', 'makes', 'making', 'many', 'may', 'maybe', 'me', 'meanwhile',
  'might', 'mine', 'more', 'moreover', 'most', 'mostly', 'much', 'must', 'mustn\'t', 'my',
  'myself', 'near', 'nearly', 'need', 'needs', 'neither', 'never', 'nevertheless', 'new',
  'next', 'no', 'nobody', 'none', 'noone', 'nor', 'not', 'nothing', 'now', 'nowhere',
  'of', 'off', 'often', 'on', 'once', 'one', 'only', 'onto', 'or', 'other', 'others',
  'otherwise', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'part', 'per',
  'perhaps', 'please', 'put', 'quite', 'rather', 'really', 'regarding', 'same', 'say',
  'saying', 'says', 'see', 'seeing', 'seem', 'seemed', 'seeming', 'seems', 'seen',
  'several', 'shall', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should',
  'shouldn\'t', 'since', 'so', 'some', 'somebody', 'somehow', 'someone', 'something',
  'sometime', 'sometimes', 'somewhere', 'still', 'such', 'take', 'taken', 'takes',
  'taking', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'thence', 'there', 'there\'s', 'thereafter', 'thereby', 'therefore', 'therein',
  'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'thing', 'things',
  'this', 'those', 'though', 'through', 'throughout', 'thru', 'thus', 'to', 'together',
  'too', 'took', 'top', 'toward', 'towards', 'under', 'unless', 'until', 'up', 'upon',
  'us', 'use', 'used', 'uses', 'using', 'various', 'very', 'via', 'was', 'wasn\'t',
  'way', 'ways', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'well', 'were', 'weren\'t',
  'what', 'what\'s', 'whatever', 'when', 'whence', 'whenever', 'where', 'where\'s',
  'whereafter', 'whereas', 'whereby', 'wherein', 'whereupon', 'wherever', 'whether',
  'which', 'while', 'whither', 'who', 'who\'s', 'whoever', 'whole', 'whom', 'whose',
  'why', 'will', 'with', 'within', 'without', 'won\'t', 'would', 'wouldn\'t', 'yes',
  'yet', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself',
  'yourselves',
]);

// ---------------------------------------------------------------- Editorial Domain Lexicon
export const EDITORIAL_LEXICON: string[] = [
  // Actives & Bio-molecules
  'niacinamide', 'hyaluronic acid', 'salicylic acid', 'glycolic acid', 'lactic acid',
  'azelaic acid', 'retinol', 'retinoid', 'tretinoin', 'ascorbic acid', 'vitamin c',
  'ceramides', 'peptides', 'copper peptides', 'squalane', 'bakuchiol', 'centella asiatica',
  'cica', 'snail mucin', 'zinc oxide', 'titanium dioxide', 'benzoyl peroxide', 'panthenol',
  'allantoin', 'kojic acid', 'alpha arbutin', 'tranexamic acid', 'ferulic acid',
  'resveratrol', 'green tea extract', 'tea tree oil', 'rosehip oil', 'jojoba oil',
  'glycerin', 'cholesterol', 'fatty acids', 'antioxidants', 'electrolytes', 'mandelic acid',

  // Physiology & Clinical Skin Concerns
  'skin barrier', 'barrier repair', 'lipid barrier', 'tewl', 'trans-epidermal water loss',
  'hydration', 'gentle cleanser', 'double cleansing', 'oil cleansing', 'sunscreen', 'spf',
  'sun protection', 'broad spectrum', 'chemical exfoliation', 'physical exfoliation',
  'skin cycling', 'slugging', 'acne', 'breakouts', 'clogged pores', 'enlarged pores',
  'blackheads', 'hyperpigmentation', 'melasma', 'dark spots', 'fine lines', 'wrinkles',
  'collagen', 'anti-aging', 'erythema', 'redness', 'rosacea', 'eczema', 'dermatitis',
  'sensitive skin', 'oily skin', 'dry skin', 'combination skin', 'sebum', 'microbiome',
  'dermatology', 'stratum corneum', 'skin texture', 'pore minimization',

  // Style & Minimalist Fashion
  'capsule wardrobe', 'minimalist style', 'slow fashion', 'sustainable fashion',
  'tailoring', 'cashmere', 'linen', 'silk', 'monochrome', 'elevated basics',
  'quiet luxury', 'wardrobe essentials', 'clean aesthetic', 'seasonal palette',

  // Wellness, Rituals & Longevity
  'circadian rhythm', 'morning routine', 'evening routine', 'sleep hygiene',
  'lymphatic drainage', 'gua sha', 'facial massage', 'cold therapy', 'ice rolling',
  'mindfulness', 'breathwork', 'stress management', 'gut-skin axis', 'skin longevity',
];

// Map of normalized terms for fast O(1) matching
const LEXICON_MAP = new Map<string, string>();
EDITORIAL_LEXICON.forEach(term => {
  LEXICON_MAP.set(term.toLowerCase().replace(/[^a-z0-9 ]/g, ''), term);
});

// ---------------------------------------------------------------- Text Utilities

/** Strip markdown and HTML down to clean plain English text. */
export function stripMarkdown(md: string): string {
  if (!md) return '';
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/^[ \t]*[#>*+-][ \t]*/gm, ' ')
    .replace(/[*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokenize text into words while keeping hyphenated terms intact. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^-+|-+$/g, ''))
    .filter(w => w.length > 2);
}

// ---------------------------------------------------------------- Core Extractor

export interface FocusCandidate {
  phrase: string;
  score: number;
  count: number;
  density: number;
  inTitle: boolean;
  inIntro: boolean;
  inHeadings: boolean;
}

export interface EditorialKeywordsResult {
  focusCandidates: FocusCandidate[];
  suggestedTags: string[];
  topKeyphrases: string[];
}

/**
 * Extracts high-intent focus keyword candidates and crisp editorial tags
 * by analyzing titles, headings, introductory text, and n-gram domain collocations.
 */
export function extractEditorialKeywords(
  content: string,
  title: string = '',
  existingTags: string[] = []
): EditorialKeywordsResult {
  const cleanTitle = (title || '').toLowerCase().trim();
  const rawContent = content || '';
  const plainText = stripMarkdown(rawContent).toLowerCase();
  const words = tokenize(plainText);
  const totalWords = Math.max(words.length, 1);

  // Extract headings
  const headings = Array.from(rawContent.matchAll(/^#{1,6}\s+(.+)$/gm))
    .map(m => m[1].toLowerCase().replace(/[*_`]/g, '').trim());
  const headingsText = headings.join(' ');

  // Extract first 150 words (introduction)
  const introWords = words.slice(0, 150);
  const introText = introWords.join(' ');

  // 1. Check known domain lexicon occurrences directly
  const phraseScores: Map<string, { count: number; score: number }> = new Map();

  for (const [normLex, canonical] of LEXICON_MAP.entries()) {
    // Regex word-boundary match in plain text
    const escaped = normLex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`\\b${escaped}\\b`, 'gi');
    const matches = plainText.match(rx);
    const count = matches ? matches.length : 0;

    if (count > 0 || cleanTitle.includes(normLex)) {
      let score = count * 2 + 5; // Base domain boost
      if (cleanTitle.includes(normLex)) score += 8;
      if (headingsText.includes(normLex)) score += 4;
      if (introText.includes(normLex)) score += 3;

      phraseScores.set(canonical, { count: Math.max(count, 1), score });
    }
  }

  // 2. Extract significant n-grams (1-grams, 2-grams, 3-grams) from clean text
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const slice = words.slice(i, i + n);
      const first = slice[0];
      const last = slice[slice.length - 1];

      // Exclude phrases starting or ending with stop words or single digits
      if (STOP_WORDS.has(first) || STOP_WORDS.has(last)) continue;
      if (first.length <= 2 || last.length <= 2) continue;

      const phrase = slice.join(' ');
      const normPhrase = phrase.replace(/[^a-z0-9 ]/g, '');

      // Avoid matching if already identified by domain lexicon
      if (LEXICON_MAP.has(normPhrase)) continue;

      const existing = phraseScores.get(phrase);
      if (existing) {
        existing.count += 1;
        existing.score += 2;
      } else {
        let score = 2;
        if (cleanTitle.includes(phrase)) score += 8;
        if (headingsText.includes(phrase)) score += 4;
        if (introText.includes(phrase)) score += 3;
        phraseScores.set(phrase, { count: 1, score });
      }
    }
  }

  // 3. Extract high-frequency non-stop single words (unigrams)
  const unigramCounts: Map<string, number> = new Map();
  words.forEach(w => {
    if (w.length > 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)) {
      unigramCounts.set(w, (unigramCounts.get(w) || 0) + 1);
    }
  });

  for (const [w, count] of unigramCounts.entries()) {
    if (count >= 2 || cleanTitle.includes(w)) {
      let score = count * 1.5;
      if (cleanTitle.includes(w)) score += 6;
      if (headingsText.includes(w)) score += 3;
      if (introText.includes(w)) score += 2;
      if (LEXICON_MAP.has(w)) score += 4;

      // Only add if not already captured
      if (!phraseScores.has(w)) {
        phraseScores.set(w, { count, score });
      }
    }
  }

  // 4. Calculate detailed diagnostics for focus keyword candidates
  const focusCandidates: FocusCandidate[] = [];

  for (const [phrase, data] of phraseScores.entries()) {
    // Only consider phrases with meaningful occurrence or title presence
    if (data.count < 1 && !cleanTitle.includes(phrase.toLowerCase())) continue;

    const lowerPhrase = phrase.toLowerCase();
    const inTitle = cleanTitle.includes(lowerPhrase);
    const inIntro = introText.includes(lowerPhrase);
    const inHeadings = headingsText.includes(lowerPhrase);
    const density = Math.round((data.count / totalWords) * 1000) / 10;

    // Prefer 2-to-3-word phrases over single words for focus keywords
    const wordCount = phrase.split(' ').length;
    let finalScore = data.score;
    if (wordCount >= 2 && wordCount <= 3) finalScore += 4;
    if (inTitle) finalScore += 5;

    focusCandidates.push({
      phrase,
      score: finalScore,
      count: data.count,
      density,
      inTitle,
      inIntro,
      inHeadings,
    });
  }

  // Sort by score descending
  focusCandidates.sort((a, b) => b.score - a.score || b.count - a.count);

  // Filter out redundant substrings from top focus candidates
  const uniqueFocus: FocusCandidate[] = [];
  for (const cand of focusCandidates) {
    if (uniqueFocus.length >= 6) break;
    // Don't add if already closely subsumed by a higher-scoring phrase
    const isSubsumed = uniqueFocus.some(
      u => u.phrase.toLowerCase().includes(cand.phrase.toLowerCase()) && u.score > cand.score + 5
    );
    if (!isSubsumed) {
      uniqueFocus.push(cand);
    }
  }

  // 5. Generate Sharp Editorial Tags
  const existingSet = new Set(existingTags.map(t => t.toLowerCase().trim()));
  const suggestedTags: string[] = [];

  for (const cand of focusCandidates) {
    if (suggestedTags.length >= 10) break;
    const tag = cand.phrase.toLowerCase().trim();
    if (!existingSet.has(tag) && !suggestedTags.includes(tag)) {
      // Must have decent frequency or title weight
      if (cand.count >= 2 || cand.inTitle) {
        suggestedTags.push(tag);
      }
    }
  }

  return {
    focusCandidates: uniqueFocus,
    suggestedTags,
    topKeyphrases: focusCandidates.slice(0, 15).map(c => c.phrase),
  };
}

/**
 * Drop-in replacement for the older `suggestTags` in `usePlatform.ts`.
 * Guaranteed to return crisp, intelligent editorial tags without nonsense filler words.
 */
export function suggestTags(content: string, existingTags: string[] = []): string[] {
  const result = extractEditorialKeywords(content, '', existingTags);
  return result.suggestedTags;
}

// ---------------------------------------------------------------- Reader Extras Auto-Extractors

/** Auto-extract bullet points under a "Key Takeaways" or "Summary" section in markdown. */
export function extractKeyTakeaways(content: string): string[] {
  if (!content) return [];
  const match = content.match(/##\s+(?:Key\s+Takeaways|Takeaways|Summary|Key\s+Points|Highlights)[\s\S]*?(?=\n##|\n---|$)/i);
  if (!match) return [];

  const section = match[0];
  const items = section
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- ') || line.startsWith('* ') || /^\d+\.\s+/.test(line))
    .map(line => line.replace(/^[-*]\s+|\d+\.\s+/, '').replace(/\*\*/g, '').trim())
    .filter(line => line.length > 5);

  return items.slice(0, 8);
}

/** Auto-extract Q&A pairs from a FAQ section in markdown. */
export function extractFaqItems(content: string): { q: string; a: string }[] {
  if (!content) return [];
  const match = content.match(/##\s+(?:Frequently\s+Asked\s+Questions|FAQ|Q&A)[\s\S]*?(?=\n##|\n---|$)/i);
  if (!match) return [];

  const section = match[0];
  const items: { q: string; a: string }[] = [];

  // Match bold questions: **Question?** \n Answer
  const boldMatches = Array.from(section.matchAll(/\*\*([^*?]+\?)\*\*\s*\n+([\s\S]*?)(?=\n\*\*|\n###|$)/g));
  if (boldMatches.length > 0) {
    for (const m of boldMatches) {
      const q = m[1].trim();
      const a = m[2].replace(/\s+/g, ' ').trim();
      if (q && a) items.push({ q, a });
    }
    return items.slice(0, 10);
  }

  // Fallback: match H3 questions: ### Question? \n Answer
  const h3Matches = Array.from(section.matchAll(/###\s+([^\n]+)\n+([\s\S]*?)(?=\n###|\n##|$)/g));
  for (const m of h3Matches) {
    const q = m[1].replace(/[*_]/g, '').trim();
    const a = m[2].replace(/\s+/g, ' ').trim();
    if (q && a) items.push({ q, a });
  }

  return items.slice(0, 10);
}

// ---------------------------------------------------------------- Excerpt Generator

/** Generate a clean, high-converting 110–160 character excerpt from article introduction. */
export function generateSmartExcerpt(content: string, minLen = 110, maxLen = 160): string {
  if (!content) return '';
  const plain = stripMarkdown(content);
  if (!plain) return '';

  // Split into sentences
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || [plain];
  let excerpt = '';

  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed.length < 20) continue; // skip tiny intros
    if ((excerpt + ' ' + trimmed).trim().length <= maxLen) {
      excerpt = (excerpt ? excerpt + ' ' : '') + trimmed;
      if (excerpt.length >= minLen) break;
    } else {
      if (!excerpt) {
        // Truncate at word boundary
        const slice = trimmed.slice(0, maxLen - 3);
        const lastSpace = slice.lastIndexOf(' ');
        excerpt = (lastSpace > 50 ? slice.slice(0, lastSpace) : slice) + '…';
      }
      break;
    }
  }

  return excerpt || plain.slice(0, maxLen);
}

// ---------------------------------------------------------------- Markdown Cleaner / Formatter

/**
 * Clean and polish raw pasted text from Google Docs, Word, or web pages:
 * - Strips useless HTML wrapper tags & non-breaking spaces
 * - Normalizes smart/curly quotes and em-dashes
 * - Collapses excessive blank lines
 * - Standardizes markdown heading syntax
 */
export function cleanMarkdownContent(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // 1. Strip junk HTML tags while preserving content
  text = text
    .replace(/<\/?(?:span|div|font|p|section|article)[^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');

  // 2. Normalize smart quotes and dashes
  text = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\r\n/g, '\n');

  // 3. Fix heading spacing: e.g. "##Title" -> "## Title"
  text = text.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');

  // 4. Clean trailing whitespace per line
  text = text
    .split('\n')
    .map(l => l.trimEnd())
    .join('\n');

  // 5. Collapse 3+ consecutive newlines into standard 2 (single blank line)
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
