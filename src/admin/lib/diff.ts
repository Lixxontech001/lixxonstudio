/**
 * Text diffing for the editor: line diff, word diff, and a change summary.
 *
 * The editors use this to compare a stored revision against what is on screen, and to answer
 * "was this revision worth keeping?" without opening it. Deliberately dependency-free.
 */

export interface DiffLine { type: 'same' | 'add' | 'del'; text: string; a?: number; b?: number }

/** Classic LCS line diff. `a` and `b` are the old and new text. */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = (a ?? '').split('\n');
  const B = (b ?? '').split('\n');
  const m = A.length;
  const n = B.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ type: 'same', text: A[i], a: i + 1, b: j + 1 }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: A[i], a: i + 1 }); i++; }
    else { out.push({ type: 'add', text: B[j], b: j + 1 }); j++; }
  }
  while (i < m) out.push({ type: 'del', text: A[i], a: ++i });
  while (j < n) out.push({ type: 'add', text: B[j], b: ++j });
  return out;
}

export interface DiffStats { added: number; removed: number; unchanged: number; changed: boolean }

export function diffStats(a: string, b: string): DiffStats {
  const lines = diffLines(a, b);
  const added = lines.filter(l => l.type === 'add').length;
  const removed = lines.filter(l => l.type === 'del').length;
  return { added, removed, unchanged: lines.length - added - removed, changed: added > 0 || removed > 0 };
}

/** First N changed lines — used for the "what changed" summary on a revision row. */
export function diffPreview(a: string, b: string, limit = 6): DiffLine[] {
  return diffLines(a, b).filter(l => l.type !== 'same').slice(0, limit);
}

/**
 * Word-level diff of a single changed line (so an edit inside a paragraph shows the words
 * that moved rather than the whole line). Falls back to a plain prefix/suffix trim when the
 * lines are long, which keeps it fast on huge paragraphs.
 */
export interface WordPart { type: 'same' | 'add' | 'del'; text: string }

export function diffWords(a: string, b: string): WordPart[] {
  const tokens = (s: string) => s.split(/(\s+)/).filter(t => t !== '');
  const A = tokens(a);
  const B = tokens(b);
  if (A.length * B.length > 40000) {
    // too big for the full table: trim the common edges and call the middle a change
    let start = 0;
    while (start < A.length && start < B.length && A[start] === B[start]) start++;
    let endA = A.length;
    let endB = B.length;
    while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) { endA--; endB--; }
    const parts: WordPart[] = [];
    if (start > 0) parts.push({ type: 'same', text: A.slice(0, start).join('') });
    if (endA > start) parts.push({ type: 'del', text: A.slice(start, endA).join('') });
    if (endB > start) parts.push({ type: 'add', text: B.slice(start, endB).join('') });
    if (endA < A.length) parts.push({ type: 'same', text: A.slice(endA).join('') });
    return parts;
  }
  const m = A.length;
  const n = B.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const out: WordPart[] = [];
  let i = 0;
  let j = 0;
  const push = (type: WordPart['type'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  while (i < m && j < n) {
    if (A[i] === B[j]) { push('same', A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i]); i++; }
    else { push('add', B[j]); j++; }
  }
  while (i < m) push('del', A[i++]);
  while (j < n) push('add', B[j++]);
  return out;
}
