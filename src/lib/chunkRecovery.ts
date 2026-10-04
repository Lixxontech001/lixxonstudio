/**
 * Stale-chunk recovery.
 *
 * After a deploy, a returning visitor's HTML still points at chunk files that no longer
 * exist, so a lazy `import()` rejects with a "Loading chunk … failed" / "Failed to fetch
 * dynamically imported module" error. Recover with ONE hard reload (which fetches the new
 * HTML + chunks), guarded against loops: at most one automatic reload per cooldown window.
 */
import { lazy } from 'react';

const RELOAD_FLAG = 'lixxon_chunk_reload_at';
const RELOAD_COOLDOWN_MS = 60_000;

export function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|dynamically imported module/i.test(msg);
}

function trySingleReload(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) return false; // loop guard
    window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false; // storage disabled — don't reload-loop
  }
}

/** Wrap a dynamic `import()`; a stale-chunk failure triggers at most one hard reload. */
export function recoverStaleChunk<T>(loader: () => Promise<T>): Promise<T> {
  return loader().catch((err: unknown) => {
    if (isStaleChunkError(err)) trySingleReload();
    throw err;
  });
}

/** `React.lazy` that self-heals from stale chunks after deploys. Same generics as `lazy` itself. */
export const lazyWithRetry: typeof lazy = (factory) => lazy(() => recoverStaleChunk(factory));

/** Safety net for chunk failures outside the lazy() wrappers (preloads, pre-rendered imports). */
export function installChunkRecovery(): void {
  window.addEventListener('unhandledrejection', (e) => {
    if (isStaleChunkError(e.reason)) trySingleReload();
  });
}
