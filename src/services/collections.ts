import { collection, addDoc, doc, getDocs, query, where, orderBy, serverTimestamp, writeBatch, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import type { Collection } from '../types';

/**
 * PRD 4.2 "My Collections" — named groupings a user creates to organize
 * their items, distinct from the single flat `items` list. Same
 * one-doc-per-collection / one-flat-list-per-user shape as `items.ts`'s
 * getItems, so this mirrors that file's conventions rather than introducing
 * a new pattern.
 */
export async function getCollections(userId: string): Promise<Collection[]> {
  const q = query(collection(db, 'collections'), where('userId', '==', userId), orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Collection));
}

export async function createCollection(userId: string, name: string): Promise<Collection> {
  const docRef = await addDoc(collection(db, 'collections'), {
    userId,
    name,
    createdAt: serverTimestamp(),
  });
  // Firestore's serverTimestamp() resolves server-side, so the value isn't
  // known yet on the client — callers only need a value here so the new
  // collection can be added to local state immediately without a re-fetch;
  // the real timestamp shows up on the next getCollections() call, and
  // getCollections orders by createdAt so this doesn't affect displayed order
  // (a newly-created collection is always the newest anyway).
  return { id: docRef.id, userId, name, createdAt: null };
}

/**
 * Deletes a collection. A collection is just a label, not a container that
 * owns its items — so member items are reassigned back to "Uncategorized"
 * (their `collectionId` field cleared) rather than being deleted themselves,
 * and rather than being left pointing at a now-nonexistent collection doc.
 */
export async function deleteCollection(userId: string, collectionId: string): Promise<void> {
  const q = query(
    collection(db, 'items'),
    where('userId', '==', userId),
    where('collectionId', '==', collectionId)
  );
  const snapshot = await getDocs(q);

  const batch = writeBatch(db);
  snapshot.docs.forEach((itemDoc) => {
    batch.update(itemDoc.ref, { collectionId: deleteField() });
  });
  batch.delete(doc(db, 'collections', collectionId));
  await batch.commit();
}
