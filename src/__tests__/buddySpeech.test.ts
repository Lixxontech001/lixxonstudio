// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { speak, speechAvailable, stopSpeaking } from '../buddy/buddySpeech';

type Host = Window & { speechSynthesis?: unknown; SpeechSynthesisUtterance?: unknown };

const cancel = vi.fn();
const speakFn = vi.fn();

class FakeUtterance {
  text: string;
  lang = '';
  constructor(text: string) {
    this.text = text;
  }
}

beforeEach(() => {
  cancel.mockReset();
  speakFn.mockReset();
  delete (window as Host).speechSynthesis;
  delete (window as Host).SpeechSynthesisUtterance;
});

afterEach(() => {
  delete (window as Host).speechSynthesis;
  delete (window as Host).SpeechSynthesisUtterance;
});

function enableSpeech() {
  (window as Host).speechSynthesis = { cancel, speak: speakFn };
  (window as Host).SpeechSynthesisUtterance = FakeUtterance;
}

describe('Buddy read-aloud', () => {
  it('does nothing and says so when the browser has no voice', () => {
    expect(speechAvailable()).toBe(false);
    expect(speak('Good morning.')).toBe(false);
    expect(speakFn).not.toHaveBeenCalled();
    expect(() => stopSpeaking()).not.toThrow();
  });

  it('reads a reply with the browser voice, after stopping anything already playing', () => {
    enableSpeech();
    expect(speechAvailable()).toBe(true);
    expect(speak('  Hello. How can I help?  ')).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(speakFn).toHaveBeenCalledTimes(1);
    const utterance = speakFn.mock.calls[0][0] as FakeUtterance;
    expect(utterance.text).toBe('Hello. How can I help?');
    expect(utterance.lang).toBe('en');
  });

  it('never reads empty text, and caps very long text', () => {
    enableSpeech();
    expect(speak('   ')).toBe(false);
    expect(speakFn).not.toHaveBeenCalled();
    speak('x'.repeat(5000));
    expect((speakFn.mock.calls[0][0] as FakeUtterance).text.length).toBe(2000);
  });

  it('stops speaking on request', () => {
    enableSpeech();
    stopSpeaking();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
