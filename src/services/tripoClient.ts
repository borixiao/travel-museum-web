import type { GenerateTaskStatus, PhotoSlot } from '../types';

// PRD 4.4 "Cancel" — a deliberate `AbortController.abort()` call (see
// UploadPage.handleCancelGenerate) surfaces here as a fetch throwing a
// DOMException named 'AbortError'; this helper lets callers distinguish that
// from a genuine failure so a user-initiated cancel doesn't get treated as
// an error needing "Try again", and so it doesn't burn one of the automatic
// retry attempts (see generate3DModelWithRetry's catch below).
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

// A cancelable sleep — plain `setTimeout` has no way to interrupt an
// in-progress wait, which would otherwise make Cancel take up to
// `intervalMs` to actually take effect while polling.
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export async function generate3DModel(photos: Partial<Record<PhotoSlot, File>>, signal?: AbortSignal): Promise<string> {
  const formData = new FormData();
  (['front', 'left', 'back', 'right'] as PhotoSlot[]).forEach((slot) => {
    const file = photos[slot];
    if (file) formData.append(slot, file);
  });

  const res = await fetch('/api/generate', {
    method: 'POST',
    body: formData,
    signal,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to start 3D generation');
  }
  return data.task_id as string;
}

export async function getTaskStatus(taskId: string, signal?: AbortSignal): Promise<GenerateTaskStatus> {
  const res = await fetch(`/api/task/${taskId}`, { signal });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch task status');
  }
  return data as GenerateTaskStatus;
}

export async function pollTaskUntilDone(
  taskId: string,
  onProgress?: (progress: number) => void,
  intervalMs = 3000,
  timeoutMs = 300000,
  signal?: AbortSignal,
): Promise<GenerateTaskStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await getTaskStatus(taskId, signal);
    onProgress?.(task.progress);
    if (task.status === 'success' || task.status === 'failed' || task.status === 'banned' || task.status === 'expired') {
      return task;
    }
    await sleep(intervalMs, signal);
  }
  throw new Error('Tripo task timed out');
}

export function modelProxyUrl(modelUrl: string): string {
  return `/api/model?url=${encodeURIComponent(modelUrl)}`;
}

// PRD §7 "Automatic retry (up to 2x) on Tripo3D generation failure" — 1
// initial attempt + up to 2 automatic retries = 3 total.
export const MAX_GENERATE_ATTEMPTS = 3;

/**
 * Wraps generate3DModel + pollTaskUntilDone with automatic retry. A retry
 * re-submits the same photos as a brand-new Tripo task (there's no "retry
 * this task" API), so each attempt goes through the full upload→poll cycle
 * again — callers are notified via onAttemptStart so they can reset their
 * upload/progress UI between attempts.
 */
export async function generate3DModelWithRetry(
  photos: Partial<Record<PhotoSlot, File>>,
  callbacks?: {
    onAttemptStart?: (attempt: number, maxAttempts: number) => void;
    onProgress?: (progress: number) => void;
  },
  signal?: AbortSignal,
): Promise<GenerateTaskStatus> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_GENERATE_ATTEMPTS; attempt++) {
    callbacks?.onAttemptStart?.(attempt, MAX_GENERATE_ATTEMPTS);
    try {
      const taskId = await generate3DModel(photos, signal);
      const task = await pollTaskUntilDone(taskId, callbacks?.onProgress, undefined, undefined, signal);
      if (task.status === 'success') return task;
      // 'banned' means Tripo rejected the content itself (e.g. a content
      // policy flag) — resubmitting the identical photos will just get
      // banned again, so don't burn retries on it. 'failed'/'expired' are
      // treated as plausibly transient (server hiccup, queue timeout) and
      // are worth retrying.
      if (task.status === 'banned' || attempt === MAX_GENERATE_ATTEMPTS) return task;
      lastError = new Error(task.error_msg || `Generation ${task.status}`);
    } catch (err) {
      // A user-initiated Cancel shouldn't burn one of the automatic retry
      // attempts — surface it immediately regardless of which attempt we're on.
      if (isAbortError(err) || attempt === MAX_GENERATE_ATTEMPTS) throw err;
      lastError = err;
    }
  }
  // Unreachable (the loop always returns or throws on its final iteration),
  // but keeps TypeScript happy about every code path returning a value.
  throw lastError;
}
