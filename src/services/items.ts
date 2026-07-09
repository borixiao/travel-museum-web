import { collection, addDoc, doc, updateDoc, getDocs, query, where, orderBy, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import type { Item, ItemMetadata } from '../types';

export async function saveItem(
  userId: string,
  photos: File[],
  modelBlob: Blob,
  metadata: ItemMetadata,
  onProgress?: (stage: string) => void
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

  onProgress?.('Saving to database…');
  const doc = await addDoc(collection(db, 'items'), {
    userId,
    photos: photoUrls,
    modelUrl,
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

export async function getItems(userId: string): Promise<Item[]> {
  const q = query(
    collection(db, 'items'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Item));
}
