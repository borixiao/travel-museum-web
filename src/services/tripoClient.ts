import type { GenerateTaskStatus, PhotoSlot } from '../types';

export async function generate3DModel(photos: Partial<Record<PhotoSlot, File>>): Promise<string> {
  const formData = new FormData();
  (['front', 'left', 'back', 'right'] as PhotoSlot[]).forEach((slot) => {
    const file = photos[slot];
    if (file) formData.append(slot, file);
  });

  const res = await fetch('/api/generate', {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to start 3D generation');
  }
  return data.task_id as string;
}

export async function getTaskStatus(taskId: string): Promise<GenerateTaskStatus> {
  const res = await fetch(`/api/task/${taskId}`);
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
): Promise<GenerateTaskStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await getTaskStatus(taskId);
    onProgress?.(task.progress);
    if (task.status === 'success' || task.status === 'failed' || task.status === 'banned' || task.status === 'expired') {
      return task;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Tripo task timed out');
}

export function modelProxyUrl(modelUrl: string): string {
  return `/api/model?url=${encodeURIComponent(modelUrl)}`;
}
