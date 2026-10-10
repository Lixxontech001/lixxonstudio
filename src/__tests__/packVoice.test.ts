// @vitest-environment node
// The pack voice: Gemini first on the owner's existing key, then a local espeak, else no voice. Every network call is a
// fake fetch, and every local speech program is a fake runner. The key is never expected in any output.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderPackVideo, ffmpegAvailable, probeMp4 } from '../../scripts/pack-video.mjs';
import {
  GEMINI_TTS,
  espeakArgs,
  findEspeak,
  geminiTtsBody,
  narrate,
  narrationText,
  synthesizeEspeak,
  synthesizeGemini,
  wavSeconds,
} from '../../scripts/pack-voice.mjs';
import { wavBytes } from './support/wav';

const KEY = 'test-key-not-real-0123456789';
const FFMPEG = process.env.LIXXON_FFMPEG || '';
const HAS_FFMPEG = Boolean(FFMPEG) && ffmpegAvailable(FFMPEG);

function geminiReply(bytes: Uint8Array, mimeType = 'audio/wav') {
  const data = Buffer.from(bytes).toString('base64');
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function workDirFor(name: string) {
  const dir = join(tmpdir(), `pack-voice-${name}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('pack voice: the text and the WAV length', () => {
  it('each caption line becomes one spoken sentence, in order, with plain words', () => {
    expect(narrationText(['Dry skin feels tight by midday', 'A calm routine keeps the steps in order.'])).toBe(
      'Dry skin feels tight by midday. A calm routine keeps the steps in order.',
    );
    expect(narrationText([])).toBe('');
    expect(narrationText(['Line one\nline two'])).toBe('Line one line two.');
  });

  it('the length of a WAV is read from its own header, and a non-WAV has none', () => {
    expect(wavSeconds(wavBytes(3))).toBe(3);
    expect(wavSeconds(new TextEncoder().encode('not audio at all, just some text here'))).toBeNull();
    expect(wavSeconds(new Uint8Array(0))).toBeNull();
  });
});

describe('pack voice: Gemini text-to-speech on the existing key', () => {
  it('asks for audio in one prebuilt voice, with the text verbatim, and sends the key only in the header', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return geminiReply(wavBytes(2));
    };
    const result = await synthesizeGemini({ apiKey: KEY, text: 'Start with one step tonight.', fetchImpl: fetchImpl as typeof fetch });
    expect(result).toMatchObject({ ok: true, voice: 'gemini' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GEMINI_TTS.endpoint}/gemini-3.8-flash-tts:generateContent`);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe(KEY);
    expect(calls[0].url).not.toContain(KEY);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual(geminiTtsBody('Start with one step tonight.'));
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(body.contents[0].parts[0].text).toBe('Start with one step tonight.');
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('a refused call is a plain reason and carries no key', async () => {
    const fetchImpl = async () => new Response('{"error":"quota"}', { status: 429 });
    const result = await synthesizeGemini({ apiKey: KEY, text: 'Calm.', fetchImpl: fetchImpl as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'gemini_refused', status: 429 });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('a network failure, an empty reply, or a non-WAV reply are each refused honestly', async () => {
    const down = await synthesizeGemini({ apiKey: KEY, text: 'Calm.', fetchImpl: (async () => { throw new Error('offline'); }) as typeof fetch });
    expect(down).toEqual({ ok: false, reason: 'gemini_unreachable' });
    const empty = await synthesizeGemini({ apiKey: KEY, text: 'Calm.', fetchImpl: (async () => new Response('{"candidates":[]}', { status: 200 })) as typeof fetch });
    expect(empty).toEqual({ ok: false, reason: 'gemini_no_audio' });
    const notWav = await synthesizeGemini({
      apiKey: KEY,
      text: 'Calm.',
      fetchImpl: (async () => geminiReply(new TextEncoder().encode('raw bytes, no header at all here'), 'audio/l16')) as typeof fetch,
    });
    expect(notWav).toEqual({ ok: false, reason: 'gemini_not_wav' });
  });

  it('with no key, Gemini is not called at all', async () => {
    let called = false;
    const result = await synthesizeGemini({ apiKey: '  ', text: 'Calm.', fetchImpl: (async () => { called = true; return geminiReply(wavBytes(1)); }) as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'no_key' });
    expect(called).toBe(false);
  });
});

describe('pack voice: the local program and the order of voices', () => {
  it('espeak gets the text as one argument, in English, written to a WAV file', () => {
    expect(espeakArgs({ text: 'Calm routine.', outPath: '/tmp/v.wav' })).toEqual(['-v', 'en-us', '-s', '165', '-w', '/tmp/v.wav', '--', 'Calm routine.']);
  });

  it('a local program is used only when it works, preferring the named one', () => {
    expect(findEspeak(undefined, (command) => command === 'espeak')).toBe('espeak');
    expect(findEspeak(undefined, (command) => command === 'espeak-ng')).toBe('espeak-ng');
    expect(findEspeak('/opt/voice/espeak-ng', (command) => command === '/opt/voice/espeak-ng')).toBe('/opt/voice/espeak-ng');
    expect(findEspeak(undefined, () => false)).toBeNull();
  });

  it('a local program writes a WAV that is read back', async () => {
    const dir = workDirFor('espeak');
    const out = join(dir, 'v.wav');
    const runCommand = async (_bin: string, args: string[]) => {
      writeFileSync(args[args.indexOf('-w') + 1], wavBytes(2));
      return { code: 0 };
    };
    const result = await synthesizeEspeak({ bin: 'espeak-ng', text: 'Calm.', outPath: out, runCommand });
    expect(result).toMatchObject({ ok: true, voice: 'espeak' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('a local program that fails or writes no WAV is refused', async () => {
    const dir = workDirFor('espeak-bad');
    const failed = await synthesizeEspeak({ bin: 'espeak', text: 'Calm.', outPath: join(dir, 'a.wav'), runCommand: async () => ({ code: 2 }) });
    expect(failed).toEqual({ ok: false, reason: 'espeak_failed' });
    const silent = await synthesizeEspeak({ bin: 'espeak', text: 'Calm.', outPath: join(dir, 'b.wav'), runCommand: async () => ({ code: 0 }) });
    expect(silent).toEqual({ ok: false, reason: 'espeak_not_wav' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('Gemini is tried first; when it is refused, the local program is used', async () => {
    const dir = workDirFor('order');
    const out = join(dir, 'voice.wav');
    const result = await narrate({
      chunks: ['Calm routine.'],
      outPath: out,
      geminiKey: KEY,
      fetchImpl: (async () => new Response('{}', { status: 503 })) as typeof fetch,
      espeak: 'espeak-ng',
      runCommand: async (_bin: string, args: string[]) => {
        writeFileSync(args[args.indexOf('-w') + 1], wavBytes(3));
        return { code: 0 };
      },
    });
    expect(result).toMatchObject({ ok: true, voice: 'espeak', seconds: 3, path: out });
    expect(existsSync(out)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('with a Gemini key, Gemini speaks and the file is written', async () => {
    const dir = workDirFor('gemini');
    const out = join(dir, 'voice.wav');
    const result = await narrate({ chunks: ['Calm routine.'], outPath: out, geminiKey: KEY, fetchImpl: (async () => geminiReply(wavBytes(2))) as typeof fetch, espeak: null });
    expect(result).toMatchObject({ ok: true, voice: 'gemini', seconds: 2 });
    expect(wavSeconds(new Uint8Array(readFileSync(out)))).toBe(2);
    expect(JSON.stringify(result)).not.toContain(KEY);
    rmSync(dir, { recursive: true, force: true });
  });

  it('with neither a key nor a local program, the answer is no_voice, and nothing is written', async () => {
    const dir = workDirFor('none');
    const out = join(dir, 'voice.wav');
    const result = await narrate({ chunks: ['Calm routine.'], outPath: out, geminiKey: null, espeak: null });
    expect(result).toEqual({ ok: false, reason: 'no_voice', tried: [] });
    expect(existsSync(out)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!HAS_FFMPEG)('pack voice: a Gemini voice reaches a real MP4 with sound (needs LIXXON_FFMPEG)', () => {
  it('the Gemini WAV is muxed into the video, and the probe reports an audio track', async () => {
    const dir = workDirFor('mux');
    const picture = join(dir, 'picture.png');
    const made = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=800x1000:rate=1', '-frames:v', '1', picture]);
    expect(made.status).toBe(0);
    const output = join(dir, 'voiced.mp4');
    const result = await renderPackVideo({
      imagePath: picture,
      chunks: ['Dry skin feels tight by midday.', 'A calm routine keeps the steps in order.'],
      outputPath: output,
      ffmpeg: FFMPEG,
      voiceOptions: { geminiKey: KEY, fetchImpl: (async () => geminiReply(wavBytes(9))) as typeof fetch, espeak: null },
    });
    expect(result).toMatchObject({ ok: true, voice: 'gemini' });
    const probe = await probeMp4(FFMPEG, output);
    expect(probe).toMatchObject({ width: 1080, height: 1920, hasAudio: true });
    rmSync(dir, { recursive: true, force: true });
  }, 90_000);
});
