import { Copy, KeyRound, Loader2, ShieldCheck } from 'lucide-react';

interface VapidGeneratorProps {
  subject: string;
  publicKey: string;
  busy: boolean;
  onSubjectChange: (value: string) => void;
  onGenerate: () => void;
  onCopy: () => void;
}

export default function VapidGenerator({
  subject,
  publicKey,
  busy,
  onSubjectChange,
  onGenerate,
  onCopy,
}: VapidGeneratorProps) {
  return (
    <section className="space-y-4 rounded-sm border border-sky-200 bg-sky-50 p-4">
      <div>
        <div className="flex items-center gap-2 text-sky-900">
          <ShieldCheck size={18} aria-hidden="true" />
          <h2 id="vapid-generation-title" className="font-medium">Generate VAPID keypair</h2>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-sky-950">
          The server generates the pair: the private key goes straight into Vault and is never returned; only the public key is shown for copying.
        </p>
        <p className="mt-2 text-sm font-medium leading-6 text-sky-950">
          To turn push on: enter your VAPID values, then open /admin/settings on your phone and tap Register this device.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label htmlFor="vapid-subject" className="mb-1 block text-xs font-medium text-sky-950">Contact subject (mailto: or HTTPS)</label>
          <input
            id="vapid-subject"
            value={subject}
            onChange={event => onSubjectChange(event.target.value)}
            autoComplete="email"
            spellCheck={false}
            maxLength={320}
            className="min-h-11 w-full rounded-sm border border-gray-300 bg-white px-3 text-sm text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"
          />
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-charcoal px-4 text-sm font-medium text-white hover:bg-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
          Generate VAPID keypair
        </button>
      </div>
      {publicKey && (
        <div>
          <label htmlFor="generated-vapid-public-key" className="mb-1 block text-xs font-medium text-sky-950">Public key — copy this if needed</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="generated-vapid-public-key"
              value={publicKey}
              readOnly
              spellCheck={false}
              className="min-h-11 min-w-0 flex-1 rounded-sm border border-gray-300 bg-white px-3 font-mono text-xs text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"
            />
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-gray-300 bg-white px-4 text-sm text-charcoal hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze"
            >
              <Copy size={15} aria-hidden="true" />
              Copy public key
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
