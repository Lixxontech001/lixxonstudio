import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const maxBytes = 250_000;
const oversized = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (entry.isFile()) {
      const size = (await stat(fullPath)).size;
      if (size > maxBytes) oversized.push({ fullPath, size });
    }
  }
}

await walk(root);
if (oversized.length) {
  for (const file of oversized) {
    console.error(`[public-size-budget] FAIL ${(file.size / 1024).toFixed(1)} KiB: ${path.relative(path.dirname(root), file.fullPath)}`);
  }
  console.error(`[public-size-budget] Public assets must each be <= ${maxBytes.toLocaleString()} bytes.`);
  process.exitCode = 1;
} else {
  console.log(`[public-size-budget] PASS: every public file is <= ${maxBytes.toLocaleString()} bytes.`);
}
