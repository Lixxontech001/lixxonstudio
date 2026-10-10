/**
 * Read-aloud uses the browser's own voice. Nothing is sent to a paid service and nothing is stored.
 * It only ever reads Buddy's replies, and only when the owner has switched it on.
 */
const MAX_SPEECH_CHARS = 2000;

type SpeechWindow = Window & {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
};

export function speechAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window as SpeechWindow;
  return typeof host.speechSynthesis !== 'undefined' && typeof host.SpeechSynthesisUtterance === 'function';
}

/** Reads the text aloud. Returns false when the browser cannot do it. */
export function speak(text: string): boolean {
  if (!speechAvailable()) return false;
  const host = window as SpeechWindow;
  const clean = text.trim().slice(0, MAX_SPEECH_CHARS);
  if (!clean) return false;
  host.speechSynthesis!.cancel();
  const utterance = new host.SpeechSynthesisUtterance!(clean);
  utterance.lang = 'en';
  host.speechSynthesis!.speak(utterance);
  return true;
}

export function stopSpeaking(): void {
  if (!speechAvailable()) return;
  (window as SpeechWindow).speechSynthesis!.cancel();
}
