#!/usr/bin/env node
// The daily pack's narration. It makes one WAV voice track for a pack video from the same caption lines the
// burned-in captions use. Voice order: Gemini text-to-speech on the owner's existing Gemini key (only when a key is
// given), then a local espeak-ng or espeak on this machine. Nothing else: no paid voice, no stock music, no URL is
// invented. When neither can speak, it returns no_voice, and the video is not saved (never a silent upload).
// It never prints the key. Usage (manual check): node scripts/pack-voice.mjs --text "Start with one step." --out voice.wav

import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const GEMINI_TTS = Object.freeze({
  model: 'gemini-3.8-flash-tts',
  voice: 'Kore',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
  timeoutMs: 60_000,
});
const ESPEAK_TIMEOUT_MS = 60_000;
const ESPEAK_NAMES = ['espeak-ng', 'espeak'];

/** The spoken text: each caption line as one sentence, in order. Plain words only. */
export function narrationText(chunks) {
  if (!Array.isArray(chunks)) return '';
  return chunks
    .map((chunk) => String(chunk).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((chunk) => `${chunk.replace(/[.!?]+$/, '')}.`)
    .join(' ');
}

/** The length of a WAV file in seconds, read from its own header. Null when the bytes are not a readable WAV. */
export function wavSeconds(bytes) {
  if (!bytes || bytes.byteLength < 44) return null;
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') return null;
  let position = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (position + 8 <= b.length) {
    const id = b.toString('latin1', position, position + 4);
    const size = b.readUInt32LE(position + 4);
    if (id === 'fmt ' && position + 24 <= b.length) byteRate = b.readUInt32LE(position + 16);
    if (id === 'data') {
      dataSize = Math.min(size, b.length - position - 8);
      break;
    }
    position += 8 + size + (size % 2);
  }
  if (!byteRate || !dataSize) return null;
  return Math.round((dataSize / byteRate) * 100) / 100;
}

/** The Gemini request body: the text verbatim, one prebuilt voice, audio out. */
export function geminiTtsBody(text) {
  return {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { voice: GEMINI_TTS.voice } },
    },
  };
}

/**
 * Asks Gemini to speak the text. Returns the WAV bytes on success, or a plain reason. The key is only sent in the
 * request header and never appears in the result.
 */
export async function synthesizeGemini({ apiKey, text, fetchImpl = fetch, timeoutMs = GEMINI_TTS.timeoutMs }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) return { ok: false, reason: 'no_key' };
  if (!text) return { ok: false, reason: 'no_text' };
  let response;
  try {
    response = await fetchImpl(`${GEMINI_TTS.endpoint}/${GEMINI_TTS.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      body: JSON.stringify(geminiTtsBody(text)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, reason: 'gemini_unreachable' };
  }
  if (!response || !response.ok) return { ok: false, reason: 'gemini_refused', status: response ? response.status : null };
  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: 'gemini_bad_reply' };
  }
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const encoded = parts.find((part) => typeof part?.inlineData?.data === 'string' && part.inlineData.data)?.inlineData?.data;
  if (!encoded) return { ok: false, reason: 'gemini_no_audio' };
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
  if (wavSeconds(bytes) === null) return { ok: false, reason: 'gemini_not_wav' };
  return { ok: true, voice: 'gemini', bytes };
}

/** The espeak command arguments: English, a calm pace, WAV out. The text is one argument, never a shell string. */
export function espeakArgs({ text, outPath, rate = 165 }) {
  return ['-v', 'en-us', '-s', String(rate), '-w', outPath, '--', text];
}

/** The first working local speech program: the one named in LIXXON_ESPEAK, else espeak-ng, else espeak. */
export function findEspeak(preferred, works = (command) => spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0) {
  const candidates = preferred ? [preferred] : ESPEAK_NAMES;
  return candidates.find((command) => works(command)) ?? null;
}

function runOnce(command, args, timeoutMs) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolveRun({ code: -1 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code });
    });
  });
}

/** Speaks the text with a local program and reads back the WAV it wrote. */
export async function synthesizeEspeak({ bin, text, outPath, runCommand = runOnce }) {
  if (!bin) return { ok: false, reason: 'no_espeak' };
  if (!text) return { ok: false, reason: 'no_text' };
  const result = await runCommand(bin, espeakArgs({ text, outPath }), ESPEAK_TIMEOUT_MS);
  if (result.code !== 0) return { ok: false, reason: 'espeak_failed' };
  const bytes = await readFile(outPath).then((data) => new Uint8Array(data), () => null);
  if (!bytes || wavSeconds(bytes) === null) return { ok: false, reason: 'espeak_not_wav' };
  return { ok: true, voice: 'espeak', bytes };
}

/**
 * The narration for one video. Gemini first when a key is given, then the local program. On success the WAV is
 * written to outPath. On failure: no_voice, with the reasons that were tried. Never throws.
 */
export async function narrate({ chunks, outPath, geminiKey, fetchImpl = fetch, espeak, runCommand }) {
  const text = narrationText(chunks);
  if (!text) return { ok: false, reason: 'no_voice', tried: [] };
  const tried = [];
  const attempts = [];
  if (geminiKey) attempts.push(['gemini', () => synthesizeGemini({ apiKey: geminiKey, text, fetchImpl })]);
  const bin = espeak === undefined ? findEspeak() : espeak;
  if (bin) attempts.push(['espeak', () => synthesizeEspeak({ bin, text, outPath, runCommand })]);
  for (const [name, attempt] of attempts) {
    const result = await attempt();
    if (result.ok) {
      if (name === 'gemini') await writeFile(outPath, result.bytes, { mode: 0o600 });
      return { ok: true, voice: result.voice, path: outPath, seconds: wavSeconds(result.bytes) };
    }
    tried.push(result.reason);
  }
  return { ok: false, reason: 'no_voice', tried };
}

// The manual check: one line in, one WAV out. It prints the voice used and the length, never the key.
async function main() {
  const args = process.argv.slice(2);
  const value = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const text = value('--text') ?? '';
  const out = value('--out');
  if (!text || !out) {
    process.stdout.write('Give --text and --out. Nothing was made.\n');
    process.exitCode = 1;
    return;
  }
  const result = await narrate({
    chunks: [text],
    outPath: resolve(out),
    geminiKey: process.env.LIXXON_GEMINI_KEY ?? null,
  });
  process.stdout.write(`${JSON.stringify(result.ok ? { ok: true, voice: result.voice, seconds: result.seconds } : result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
