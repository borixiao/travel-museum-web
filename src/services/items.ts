import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';

export async function saveItem(userId: string, photos: File[], modelBlob: Blob): Promise<string> {
  const itemId = crypto.randomUUID();
  const basePath = `items/${userId}/${itemId}`;

  const photoUrls = await Promise.all(
    photos.map(async (photo, i) => {
      const photoRef = ref(storage, `${basePath}/photo-${i}-${photo.name}`);
      await uploadBytes(photoRef, photo);
      return getDownloadURL(photoRef);
    })
  );

  const modelRef = ref(storage, `${basePath}/model.glb`);
  await uploadBytes(modelRef, modelBlob);
  const modelUrl = await getDownloadURL(modelRef);

  const doc = await addDoc(collection(db, 'items'), {
    userId,
    photos: photoUrls,
    modelUrl,
    createdAt: serverTimestamp(),
  });

  return doc.id;
}
