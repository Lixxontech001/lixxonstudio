/** Tiny CSV exporter (RFC 4180 quoting, UTF-8 BOM so Excel opens it correctly). */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return '';
  const cols = columns || Array.from(rows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set<string>()));
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // neutralise spreadsheet formula injection
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns?: string[]) {
  const blob = new Blob(['\ufeff' + toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
