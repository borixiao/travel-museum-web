import { collection, addDoc, doc, getDoc, updateDoc, getDocs, query, where, limit, serverTimestamp, deleteField } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
import type { Item, Moodboard, MoodboardCard } from '../types';

// Items are laid onto a loose 4-column grid when first added (before the
// user drags them anywhere) just so multiple adds don't all stack exactly on
// top of each other. Shared between MoodboardPage's own "tap thumbnail to
// add" strip and addItemToMoodboard below (PRD 4.5's "Add to Moodboard"
// action from Item Detail) so both entry points place new cards consistently
// instead of drifting apart with duplicated magic numbers.
const GRID_COLS = 4;
const GRID_STEP_X = 22;
const GRID_STEP_Y = 26;

// Shared between the doc created here and MoodboardCanvas's own fallback, so
// a board saved before `backgroundColor` existed (undefined field) renders
// identically to a freshly-created one instead of falling back to some other
// hardcoded color living only in the canvas component.
export const DEFAULT_MOODBOARD_BACKGROUND = '#f4f1ea';

export function nextMoodboardCardPosition(existingCardCount: number): { x: number; y: number } {
  const col = existingCardCount % GRID_COLS;
  const row = Math.floor(existingCardCount / GRID_COLS);
  return { x: 4 + col * GRID_STEP_X, y: 4 + row * GRID_STEP_Y };
}

/**
 * Each Collection (Memory) gets its own canvas, created lazily the first
 * time it's opened — `collectionId: null` is the Uncategorized bucket's
 * canvas. Replaces the single per-user board this app started with.
 */
export async function getOrCreateMoodboard(userId: string, collectionId: string | null): Promise<Moodboard> {
  const q = query(
    collection(db, 'moodboards'),
    where('userId', '==', userId),
    where('collectionId', '==', collectionId),
    limit(1),
  );
  const snapshot = await getDocs(q);
  if (!snapshot.empty) {
    const d = snapshot.docs[0];
    return { id: d.id, ...d.data() } as Moodboard;
  }

  const createdRef = await addDoc(collection(db, 'moodboards'), {
    userId,
    collectionId,
    title: 'My Exhibition',
    published: false,
    cards: [],
    backgroundColor: DEFAULT_MOODBOARD_BACKGROUND,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const created = await getDoc(createdRef);
  return { id: createdRef.id, ...created.data() } as Moodboard;
}

/**
 * All of a user's canvases across their collections — used by Profile's
 * Shared Links row to summarize how many are published, and by Home's
 * per-collection "Open Canvas" action to show a card count without opening
 * each board individually.
 */
export async function getMoodboardsForUser(userId: string): Promise<Moodboard[]> {
  const q = query(collection(db, 'moodboards'), where('userId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Moodboard));
}

export async function saveMoodboardCards(moodboardId: string, cards: MoodboardCard[]): Promise<void> {
  await updateDoc(doc(db, 'moodboards', moodboardId), { cards, updatedAt: serverTimestamp() });
}

/**
 * PRD 4.5 Item Detail Screen — "Add to Moodboard" action. Lives here (not in
 * HomePage.tsx) so it can share the exact same card-snapshot shape and grid
 * placement as MoodboardPage's own "tap thumbnail to add" strip, without
 * either entry point needing to know about the other's local component
 * state — this just reads/writes the moodboard doc directly. Adds to the
 * canvas belonging to the item's own Collection (or Uncategorized's canvas
 * if it has none) — a canvas is a Collection's property now, not a single
 * board shared across everything the user owns.
 */
export async function addItemToMoodboard(userId: string, item: Item): Promise<Moodboard> {
  const board = await getOrCreateMoodboard(userId, item.collectionId ?? null);
  const { x, y } = nextMoodboardCardPosition(board.cards.length);
  const newCard: MoodboardCard = {
    id: crypto.randomUUID(),
    type: 'item',
    itemId: item.id,
    name: item.name || 'Untitled item',
    // Prefer the AI sticker for the curated exhibition look; fall back to
    // the real photo for items that don't have one (generation failed, or
    // saved before the feature existed) — mirrors MoodboardPage.addItemCard.
    photoUrl: item.stickerUrl ?? item.photos?.[0],
    modelUrl: item.modelUrl,
    itemType: item.type,
    location: item.location,
    date: item.date,
    story: item.story,
    emotionTags: item.emotionTags,
    x,
    y,
    w: 18,
    rotation: 0,
  };
  const cards = [...board.cards, newCard];
  await saveMoodboardCards(board.id, cards);
  return { ...board, cards };
}

export async function setMoodboardTitle(moodboardId: string, title: string): Promise<void> {
  await updateDoc(doc(db, 'moodboards', moodboardId), { title, updatedAt: serverTimestamp() });
}

export async function setMoodboardPublished(moodboardId: string, published: boolean): Promise<void> {
  await updateDoc(doc(db, 'moodboards', moodboardId), { published, updatedAt: serverTimestamp() });
}

export async function setMoodboardBackgroundColor(moodboardId: string, backgroundColor: string): Promise<void> {
  await updateDoc(doc(db, 'moodboards', moodboardId), { backgroundColor, updatedAt: serverTimestamp() });
}

// Stored at `moodboards/{userId}/{moodboardId}/background` — now that a user
// can have several canvases (one per collection), the path has to include
// moodboardId too, or every canvas's background upload would overwrite the
// same file. Still falls under the existing owner-only
// `moodboards/{userId}/{allPaths=**}` Storage rule, so no rule change needed.
export async function setMoodboardBackgroundImage(userId: string, moodboardId: string, file: File): Promise<string> {
  const imageRef = ref(storage, `moodboards/${userId}/${moodboardId}/background`);
  await uploadBytes(imageRef, file);
  const backgroundImageUrl = await getDownloadURL(imageRef);
  await updateDoc(doc(db, 'moodboards', moodboardId), { backgroundImageUrl, updatedAt: serverTimestamp() });
  return backgroundImageUrl;
}

export async function clearMoodboardBackgroundImage(userId: string, moodboardId: string): Promise<void> {
  await deleteObject(ref(storage, `moodboards/${userId}/${moodboardId}/background`)).catch(() => {
    // Best-effort — nothing to clean up if it was never uploaded.
  });
  await updateDoc(doc(db, 'moodboards', moodboardId), { backgroundImageUrl: deleteField(), updatedAt: serverTimestamp() });
}

/**
 * Public read for the unauthenticated `/m/:id` viewer page. Returns null for
 * "nothing to show" whether that's because the doc doesn't exist or because
 * it exists but isn't published — the Firestore rule denies read access to
 * non-owners entirely for unpublished boards, so that read throws a
 * permission error rather than returning an empty snapshot; callers should
 * treat any failure here the same as "not found".
 */
export async function getPublishedMoodboard(moodboardId: string): Promise<Moodboard | null> {
  try {
    const snap = await getDoc(doc(db, 'moodboards', moodboardId));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data.published) return null;
    return { id: snap.id, ...data } as Moodboard;
  } catch {
    return null;
  }
}
