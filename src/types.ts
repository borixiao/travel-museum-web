export const ITEM_TYPES = ['Ticket', 'Magnet', 'Postcard', 'Bottle', 'Other'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const EMOTION_TAGS = ['Happy', 'Nostalgic', 'Special', 'Funny', 'Meaningful'] as const;
export type EmotionTag = (typeof EMOTION_TAGS)[number];

export interface ItemMetadata {
  name: string;
  type: ItemType;
  location: string;
  /** ISO date string (yyyy-mm-dd) from the date input, or empty string if not set. */
  date: string;
  story: string;
  emotionTags: EmotionTag[];
}

// Firestore docs saved before metadata fields existed won't have them — make
// them optional on read so older items don't crash the UI, even though the
// save path (ItemMetadata) always provides them going forward.
export interface Item extends Partial<ItemMetadata> {
  id: string;
  userId: string;
  photos: string[];
  modelUrl: string;
  /** Present only on items migrated from a legacy third-party (Tripo) URL — kept for audit/debugging. */
  legacyModelUrl?: string;
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
