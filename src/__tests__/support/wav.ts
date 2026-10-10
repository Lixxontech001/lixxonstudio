// Test helpers for the voice track. A WAV made here is a real, playable file: 16-bit mono PCM with a quiet 440 Hz tone.
// Nothing here calls a voice service. The narration fake only writes a local file.
import { writeFileSync } from 'node:fs';

export function wavBytes(seconds: number, sampleRate = 8000): Uint8Array {
  const samples = Math.round(seconds * sampleRate);
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'latin1');
  buf.write('fmt ', 12, 'latin1');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    buf.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), 44 + i * 2);
  }
  return new Uint8Array(buf);
}

/** A narration the way pack-voice.mjs returns one: the WAV is written to path, and the result names it. */
export function fakeNarration(path: string, seconds = 2) {
  writeFileSync(path, wavBytes(seconds));
  return { ok: true as const, voice: 'espeak' as const, path, seconds };
}
