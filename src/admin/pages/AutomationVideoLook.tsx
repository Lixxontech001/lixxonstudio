import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { parseVideoTemplates, type VideoTemplateDocument, type VideoTemplateList } from '../../lib/automationDistribution';
import {
  BUILT_IN_LOOK, LOOK_LIMITS, LOOK_NOT_USED_YET, applyLookEdits, lookSummary, type LookEdits,
} from '../../lib/videoLook';

// Phase E slice 4: the Video look. A small screen: three bounded values, saved through the existing template save call.
// It never shows an internal error text. A failed read or save says so in plain words and changes nothing.

function editsFrom(look: VideoTemplateDocument): LookEdits {
  return {
    durationSeconds: String(look.duration_seconds),
    captionFontSize: String(look.caption.font_size),
    captionColor: look.caption.color,
  };
}

export default function AutomationVideoLook() {
  const [list, setList] = useState<VideoTemplateList | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [edits, setEdits] = useState<LookEdits>(() => editsFrom(BUILT_IN_LOOK));
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const base: VideoTemplateDocument = list?.activeDocument ?? BUILT_IN_LOOK;
  const hasSavedLook = Boolean(list?.activeDocument);

  const load = useCallback(async () => {
    setLoading(true);
    setReadError(false);
    try {
      const { data, error } = await supabase.rpc('automation_video_templates');
      const parsed = error ? null : parseVideoTemplates(data);
      if (!parsed) {
        setReadError(true);
        setList(null);
      } else {
        setList(parsed);
        setEdits(editsFrom(parsed.activeDocument ?? BUILT_IN_LOOK));
      }
    } catch {
      setReadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaveMessage(null);
    setSaveFailed(false);
    const result = applyLookEdits(base, edits);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    setProblems([]);
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('automation_save_video_template', { p_document: result.document, p_activate: true });
      const parsed = error ? null : parseVideoTemplates(data);
      if (!parsed) {
        setSaveFailed(true);
        setSaveMessage('Could not save this look. Nothing changed.');
      } else {
        setList(parsed);
        setEdits(editsFrom(parsed.activeDocument ?? result.document));
        setSaveMessage(`Saved. "${result.document.name}" is the active look. ${LOOK_NOT_USED_YET}`);
      }
    } catch {
      setSaveFailed(true);
      setSaveMessage('Could not save this look. Nothing changed.');
    } finally {
      setSaving(false);
    }
  }

  const lengthRange = `${LOOK_LIMITS.durationSeconds.min} to ${LOOK_LIMITS.durationSeconds.max}`;
  const sizeRange = `${LOOK_LIMITS.captionFontSize.min} to ${LOOK_LIMITS.captionFontSize.max}`;

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-4 md:p-6" aria-labelledby="video-look-title">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="video-look-title" className="font-serif text-2xl text-gray-900">Video look</h1>
          <p className="mt-1 text-sm text-gray-600">A few values of the look of the daily vertical video. Everything else in the look stays as it is.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded border border-gray-300 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reload
        </button>
      </header>

      <p role="note" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{LOOK_NOT_USED_YET}</p>

      {loading && (
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading the saved look…
        </p>
      )}

      {!loading && readError && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          The saved look could not be read. Nothing was changed. Try Reload.
        </p>
      )}

      {!loading && !readError && (
        <>
          {!hasSavedLook && (
            <p role="status" className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              No look is saved yet. The built-in look is shown. Saving creates the first saved look.
            </p>
          )}

          <div className="rounded border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">Current look</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
              {lookSummary(base).map((item) => (
                <div key={item.label}>
                  <dt className="text-gray-500">{item.label}</dt>
                  <dd className="text-gray-900">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <form
            className="space-y-4 rounded border border-gray-200 bg-white p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <h2 className="text-sm font-semibold text-gray-900">Change the look</h2>

            <label className="block text-sm">
              <span className="text-gray-800">Length in seconds</span>
              <span className="block text-xs text-gray-500">A whole number from {lengthRange}.</span>
              <input
                type="text"
                inputMode="numeric"
                value={edits.durationSeconds}
                onChange={(event) => setEdits({ ...edits, durationSeconds: event.target.value })}
                className="mt-1 w-32 rounded border border-gray-300 px-2 py-1 text-gray-900"
              />
            </label>

            <label className="block text-sm">
              <span className="text-gray-800">Caption size</span>
              <span className="block text-xs text-gray-500">A whole number from {sizeRange}.</span>
              <input
                type="text"
                inputMode="numeric"
                value={edits.captionFontSize}
                onChange={(event) => setEdits({ ...edits, captionFontSize: event.target.value })}
                className="mt-1 w-32 rounded border border-gray-300 px-2 py-1 text-gray-900"
              />
            </label>

            <label className="block text-sm">
              <span className="text-gray-800">Caption colour</span>
              <span className="block text-xs text-gray-500">Six hex digits after 0x, for example 0xFFFFFF.</span>
              <input
                type="text"
                value={edits.captionColor}
                onChange={(event) => setEdits({ ...edits, captionColor: event.target.value })}
                className="mt-1 w-40 rounded border border-gray-300 px-2 py-1 font-mono text-gray-900"
              />
            </label>

            {problems.length > 0 && (
              <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-red-800">
                {problems.map((problem) => <li key={problem}>{problem}</li>)}
              </ul>
            )}

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Save this look
            </button>

            {saveMessage && (
              <p role={saveFailed ? 'alert' : 'status'} aria-live="polite" className={`text-sm ${saveFailed ? 'text-red-900' : 'text-gray-800'}`}>
                {saveMessage}
              </p>
            )}
          </form>
        </>
      )}
    </section>
  );
}
