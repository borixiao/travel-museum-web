export interface Item {
  id: string;
  userId: string;
  photos: string[];
  modelUrl: string;
  createdAt: unknown;
}

export type PhotoSlot = 'front' | 'left' | 'back' | 'right';

export interface GenerateTaskStatus {
  status: 'queued' | 'running' | 'success' | 'failed' | 'banned' | 'expired';
  progress: number;
  task_id: string;
  model_url: string | null;
  rendered_image: string | null;
  error_msg: string | null;
}
