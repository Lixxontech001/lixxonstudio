import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { downloadCsv } from '../lib/csv';

export default function ExportButton({ filename, load, columns, label = 'Export CSV' }: { filename: string; load: () => Promise<Record<string, unknown>[]>; columns?: string[]; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button onClick={async () => { setBusy(true); try { downloadCsv(`${filename}-${new Date().toISOString().slice(0, 10)}`, await load(), columns); } finally { setBusy(false); } }} disabled={busy}
      className="inline-flex items-center gap-2 px-3 py-2 border border-taupe/50 bg-white text-xs text-charcoal rounded-sm hover:border-bronze disabled:opacity-60">
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {label}
    </button>
  );
}
