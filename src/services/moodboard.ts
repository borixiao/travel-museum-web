import { collection, addDoc, doc, getDoc, updateDoc, getDocs, query, where, limit, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { Moodboard, MoodboardCard } from '../types';

/**
 * Every user gets exactly one moodboard, created lazily the first time they
 * open the Moodboard tab, rather than a list of boards to manage — keeps the
 * "arrange cards, publish one shareable link" flow simple for this pass.
 */
export async function getOrCreateMoodboard(userId: string): Promise<Moodboard> {
  const q = query(collection(db, 'moodboards'), where('userId', '==', userId), limit(1));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) {
    const d = snapshot.docs[0];
    return { id: d.id, ...d.data() } as Moodboard;
  }

  const createdRef = await addDoc(collection(db, 'moodboards'), {
    userId,
    title: 'My Exhibition',
    published: false,
    cards: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const created = await getDoc(createdRef);
  return { id: createdRef.id, ...created.data() } as Moodboard;
}

export async function saveMoodboardCards(moodboardId: string, cards: MoodboardCard[]): Promise<void> {
  await updateDoc(doc(db, 'moodboards', moodboardId), { cards, updatedAt: serverTimestamp() });
}

export async function setMoodboardTitle(moodboardId: string, title: string): Promise<void> {
  await updateDoc(doc(db, 'moodboards', moodboardId), { title, updatedAt: serverTimestamp() });
}

export async function setMoodboardPublished(moodboardId: string, published: boolean): Promise<void> {
  await updateDoc(doc(db, 'moodboards', moodboardId), { published, updatedAt: serverTimestamp() });
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
