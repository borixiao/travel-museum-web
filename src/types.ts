// Broad, non-exhaustive presets shown in the Type dropdown. Deliberately wider
// than a strict enum (souvenir/gift/daily item cover most travel keepsakes),
// plus a "Custom" escape hatch (see CUSTOM_ITEM_TYPE below) so users aren't
// stuck when their item doesn't fit any preset — the stored value is always
// free text, not a closed union.
export const ITEM_TYPE_PRESETS = [
  { value: 'Souvenir', label: 'Souvenir (紀念品)' },
  { value: 'Gift', label: 'Gift (禮物)' },
  { value: 'Daily Item', label: 'Daily Item (日常用品)' },
  { value: 'Ticket', label: 'Ticket (票券)' },
  { value: 'Magnet', label: 'Magnet (磁鐵)' },
  { value: 'Postcard', label: 'Postcard (明信片)' },
  { value: 'Bottle', label: 'Bottle (瓶罐)' },
  { value: 'Other', label: 'Other (其他)' },
] as const;

// Sentinel used only by the Type <select> to mean "let the user type their
// own category" — never itself stored as the item's `type` value.
export const CUSTOM_ITEM_TYPE = '__custom__';

export const EMOTION_TAGS = ['Happy', 'Nostalgic', 'Special', 'Funny', 'Meaningful'] as const;
export type EmotionTag = (typeof EMOTION_TAGS)[number];

export interface ItemMetadata {
  name: string;
  /** Free text — ITEM_TYPE_PRESETS are just suggestions offered in the UI, not a closed set. */
  type: string;
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
  /** Best-effort gpt-image-2 sticker render of the item; falls back to
   *  photos[0] wherever it's missing (generation failure, or item saved
   *  before this feature existed). */
  stickerUrl?: string;
  createdAt: unknown;
}

// Moodboard (PRD MoodboardScreen — "curate items into a shareable exhibition
// board"). A card is either a photo card snapshotted from one of the user's
// items, or a free-standing text card. x/y/w are stored as PERCENTAGES of the
// canvas (0-100) rather than pixels so the layout stays consistent across
// different screen sizes when viewed later (e.g. on the public link, which
// may be opened on a different device than the one used to arrange it).
export interface MoodboardCard {
  id: string;
  type: 'item' | 'text';
  x: number;
  y: number;
  w: number;
  rotation: number;
  /** Which representation an 'item' card shows while arranging — 'sticker'
   *  (or unset, for backward compatibility with cards saved before this
   *  field existed) shows the flat photoUrl thumbnail; 'model' shows a
   *  passive, non-interactive auto-rotating 3D preview instead. Only
   *  meaningful when modelUrl is present — the toggle button itself is
   *  hidden otherwise. */
  displayMode?: 'sticker' | 'model';
  // type: 'item' fields — a snapshot taken at the time the card was added,
  // not a live reference, so a later edit/delete of the source item doesn't
  // change (or break) an already-published board. This also has to be a full
  // enough snapshot to power the "tap to expand full detail + 3D viewer"
  // action (PRD 4.8), since the public unauthenticated viewer never reads the
  // live `items` collection — everything it can show has to already be here.
  itemId?: string;
  name?: string;
  /** Thumbnail shown on the card itself — prefers the item's AI sticker, falls back to its first photo. */
  photoUrl?: string;
  /** Snapshot of the item's 3D model, used by the expanded detail view. */
  modelUrl?: string;
  /** Renamed from the source item's `type` to avoid colliding with this card's own `type` ('item' | 'text'). */
  itemType?: string;
  location?: string;
  date?: string;
  story?: string;
  emotionTags?: EmotionTag[];
  // type: 'text' fields
  text?: string;
}

export interface Moodboard {
  id: string;
  userId: string;
  title: string;
  published: boolean;
  cards: MoodboardCard[];
  /** Canvas background color (CSS hex string). Optional so boards created
   *  before this field existed fall back to the canvas's own default. */
  backgroundColor?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

// PRD §6 data model / §4.2 "Welcome, {name}" banner. Created eagerly on
// registration (see LoginPage.tsx) and lazily backfilled for accounts that
// predate this feature (see getOrCreateUserProfile in services/users.ts) so
// every logged-in user always has a doc here by the time HomePage reads it.
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  /** Profile avatar — optional so accounts that never uploaded one (the
   *  vast majority, since this was added well after registration existed)
   *  fall back to an initials placeholder in the UI. */
  photoURL?: string;
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
