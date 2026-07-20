import { collection, addDoc, doc, updateDoc, deleteDoc, getDocs, query, where, orderBy, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
import type { Item, ItemMetadata } from '../types';

export async function saveItem(
  userId: string,
  photos: File[],
  modelBlob: Blob,
  metadata: ItemMetadata,
  onProgress?: (stage: string) => void,
  stickerBlob?: Blob | null
): Promise<string> {
  const itemId = crypto.randomUUID();
  const basePath = `items/${userId}/${itemId}`;

  onProgress?.(`Uploading photos… (0/${photos.length})`);
  let uploadedPhotoCount = 0;
  const photoUrls = await Promise.all(
    photos.map(async (photo, i) => {
      const photoRef = ref(storage, `${basePath}/photo-${i}-${photo.name}`);
      await uploadBytes(photoRef, photo);
      uploadedPhotoCount += 1;
      onProgress?.(`Uploading photos… (${uploadedPhotoCount}/${photos.length})`);
      return getDownloadURL(photoRef);
    })
  );

  onProgress?.(`Uploading 3D model… (${(modelBlob.size / 1024 / 1024).toFixed(1)} MB)`);
  const modelRef = ref(storage, `${basePath}/model.glb`);
  await uploadBytes(modelRef, modelBlob);
  const modelUrl = await getDownloadURL(modelRef);

  let stickerUrl: string | undefined;
  if (stickerBlob) {
    onProgress?.('Uploading AI sticker…');
    const stickerRef = ref(storage, `${basePath}/sticker.png`);
    await uploadBytes(stickerRef, stickerBlob);
    stickerUrl = await getDownloadURL(stickerRef);
  }

  onProgress?.('Saving to database…');
  const doc = await addDoc(collection(db, 'items'), {
    userId,
    photos: photoUrls,
    modelUrl,
    ...(stickerUrl ? { stickerUrl } : {}),
    ...metadata,
    createdAt: serverTimestamp(),
  });

  return doc.id;
}

/**
 * Updates just the metadata fields (name/type/location/date/story/emotionTags)
 * on an existing item — used by the Item Detail "Edit" action (PRD 4.5), and
 * also lets items saved before these fields existed ("Untitled item") get
 * filled in retroactively.
 */
export async function updateItemMetadata(itemId: string, metadata: ItemMetadata): Promise<void> {
  await updateDoc(doc(db, 'items', itemId), { ...metadata });
}

/**
 * Uploads a (re)generated AI sticker for an existing item, overwriting any
 * previous one at the same path, and updates the Firestore doc's
 * `stickerUrl`. Used by the Item Detail "Generate/Regenerate AI Sticker"
 * action for items saved before this feature existed, or to retry after a
 * failed auto-generation. Returns the new URL so the caller can update local
 * state immediately without a re-fetch.
 */
export async function updateItemSticker(item: Item, stickerBlob: Blob): Promise<string> {
  const stickerRef = ref(storage, `items/${item.userId}/${item.id}/sticker.png`);
  await uploadBytes(stickerRef, stickerBlob);
  const stickerUrl = await getDownloadURL(stickerRef);
  await updateDoc(doc(db, 'items', item.id), { stickerUrl });
  return stickerUrl;
}

/**
 * Deletes an item (PRD 4.5 Item Detail Screen "Delete: remove item, with
 * confirmation" — the confirmation itself is handled by the caller/UI).
 * Removes the Firestore doc and best-effort cleans up its Storage files
 * (photos + model.glb) so deleted items don't leave orphaned files behind.
 * Storage deletes are done individually and failures (e.g. a file that was
 * already missing, or an old item saved before some field existed) are
 * swallowed — the Firestore doc removal is what actually makes the item
 * disappear from the app, so a partial Storage cleanup failure shouldn't
 * block that or surface as an error to the user.
 */
export async function deleteItem(item: Item): Promise<void> {
  // legacyModelUrl is a third-party (Tripo) URL, not a file in our Storage
  // bucket — nothing to delete there, so it's excluded.
  const fileUrls = [...(item.photos ?? []), item.modelUrl, item.stickerUrl].filter((url): url is string => !!url);

  await Promise.all(
    fileUrls.map(async (url) => {
      try {
        await deleteObject(ref(storage, url));
      } catch {
        // Ignore — see doc comment above.
      }
    })
  );

  await deleteDoc(doc(db, 'items', item.id));
}

export async function getItems(userId: string): Promise<Item[]> {
  const q = query(
    collection(db, 'items'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Item));
}
