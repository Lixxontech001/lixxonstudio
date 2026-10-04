const RETRY_DELAY_MS = 800;

export class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Run one fetch attempt with a hard timeout, including fetch mocks that ignore AbortSignal. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  ms = 12_000,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) {
    controller.abort(callerSignal.reason);
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new TimeoutError(ms);
  const timeout = new Promise<Response>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutError);
      reject(timeoutError);
    }, ms);
  });

  try {
    const request = fetch(input, { ...init, signal: controller.signal }).catch((error: unknown) => {
      if (timedOut) throw timeoutError;
      throw error;
    });
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Retry one transient network failure or timeout after a short pause, then surface errors. */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  ms = 12_000,
): Promise<Response> {
  try {
    return await fetchWithTimeout(input, init, ms);
  } catch (error) {
    const isNetworkFailure = error instanceof TypeError && error.name !== 'AbortError';
    if (!(error instanceof TimeoutError) && !isNetworkFailure) throw error;
    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return fetchWithTimeout(input, init, ms);
  }
}
