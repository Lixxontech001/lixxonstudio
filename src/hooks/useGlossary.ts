import { useEffect, useState } from 'react';
import { supabase, rows } from '../lib/supabaseClient';

let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

async function load(): Promise<Record<string, string>> {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      const { data } = await supabase.from('glossary_terms').select('term, definition');
      cache = Object.fromEntries(rows<{ term: string; definition: string }>(data).map((g) => [g.term.toLowerCase(), g.definition]));
      return cache;
    })();
  }
  return inflight;
}

/** Glossary terms (cached for the session) used to add hover definitions inside articles. */
export function useGlossary() {
  const [glossary, setGlossary] = useState<Record<string, string>>(cache || {});
  useEffect(() => { let on = true; load().then((g) => { if (on) setGlossary(g); }); return () => { on = false; }; }, []);
  return { glossary };
}
