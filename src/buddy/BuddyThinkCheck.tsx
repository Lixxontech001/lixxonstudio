import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { parseKeyStatus, parseThinkReply, type BuddyThinkReply } from './buddyThinkResult';

type KeyState = 'checking' | 'missing' | 'saved' | 'unreachable';

/**
 * One small proof that Buddy can think. The server makes one real Gemini call per press.
 * Nothing is saved to a chat and nothing is posted.
 */
export default function BuddyThinkCheck() {
  const [keyState, setKeyState] = useState<KeyState>('checking');
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<BuddyThinkReply | null>(null);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('buddy-think', { body: { action: 'status' } });
        if (cancelled) return;
        const configured = error ? null : parseKeyStatus(data);
        if (configured === null) setKeyState('unreachable');
        else setKeyState(configured ? 'saved' : 'missing');
      } catch {
        if (!cancelled) setKeyState('unreachable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const askTest = async () => {
    setAsking(true);
    setResult(null);
    setFailure('');
    try {
      const { data, error } = await supabase.functions.invoke('buddy-think', { body: { action: 'probe' } });
      const parsed = error ? null : parseThinkReply(data);
      if (!parsed) setFailure('Buddy could not be reached just now. Nothing was changed. Try again shortly.');
      else setResult(parsed);
    } catch {
      setFailure('Buddy could not be reached just now. Nothing was changed. Try again shortly.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <section aria-label="Buddy thinking check" className="mt-8 rounded-sm border border-[#2B2620]/20 bg-white/60 p-4 text-left">
      {keyState === 'checking' && <p className="text-sm text-[#4A4238]" role="status">Checking Buddy…</p>}
      {keyState === 'missing' && (
        <p className="text-sm leading-relaxed text-[#4A4238]">Buddy cannot think yet because no Google key is saved. Add it in Admin under Automation keys, in the box called Google key.</p>
      )}
      {keyState === 'unreachable' && (
        <p className="text-sm leading-relaxed text-[#4A4238]">Buddy could not check its key just now. Refresh the page to try again.</p>
      )}
      {keyState === 'saved' && (
        <>
          <p className="text-sm leading-relaxed text-[#4A4238]">A Google key is saved. Ask Buddy one test question to check that it can think.</p>
          <button
            type="button"
            onClick={askTest}
            disabled={asking}
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-sm border border-[#2B2620] px-4 py-2 text-sm text-[#2B2620] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2B2620] disabled:opacity-60"
          >
            {asking ? 'Asking Buddy…' : 'Ask Buddy a test question'}
          </button>
        </>
      )}
      {failure && <p className="mt-3 text-sm leading-relaxed text-[#7A2E22]" role="alert">{failure}</p>}
      {result && result.ok && (
        <div className="mt-3" aria-live="polite">
          <p className="text-xs uppercase tracking-[0.14em] text-[#6E6456]">Buddy says</p>
          <p className="mt-1 whitespace-pre-line text-base leading-relaxed text-[#2B2620]">{result.reply}</p>
          {result.canThink && <p className="mt-2 text-xs text-[#6E6456]">Buddy can think: yes.</p>}
        </div>
      )}
      {result && !result.ok && (
        <p className="mt-3 text-sm leading-relaxed text-[#7A2E22]" role="alert">
          {result.message} Buddy can think: no.
        </p>
      )}
    </section>
  );
}
