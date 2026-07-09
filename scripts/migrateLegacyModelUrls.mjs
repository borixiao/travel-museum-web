/**
 * One-off migration: find `items` docs whose `modelUrl` points directly at a
 * third-party host (e.g. Tripo's signed CDN URL, stored by the RN app as a
 * fallback when its own Storage upload failed) instead of our own Firebase
 * Storage, and re-persist the GLB into Firebase Storage so the URL we keep
 * forever is one we actually own and control.
 *
 * Why this matters: Tripo's model URLs are signed (Key-Pair-Id/Policy/Signature)
 * with a baked-in expiry. Once expired, the file becomes permanently
 * unfetchable (403) regardless of how it's requested — that's what caused the
 * blank-screen bug. This script is a best-effort rescue: any legacy URL that
 * still works right now gets copied into our own Storage; any that already
 * expired gets reported as unrecoverable (nothing more we can do for those
 * without the original photos and a fresh Tripo re-generation).
 *
 * Usage:
 *   npm run migrate:legacy-urls
 * You'll be prompted for the email/password of the Firebase Auth user whose
 * items should be migrated (this only touches items where userId == that
 * user's uid, matching normal Firestore security rules — no admin/service
 * account needed).
 */
import { createInterface } from 'node:readline/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function isOwnedStorageUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host.includes('firebasestorage.googleapis.com') || host.endsWith('.firebasestorage.app');
  } catch {
    return false;
  }
}

async function main() {
  const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };
  if (!firebaseConfig.apiKey) {
    console.error('Missing VITE_FIREBASE_* env vars — run this from the project root with .env present.');
    process.exit(1);
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = await rl.question('Firebase Auth email: ');
  const password = await rl.question('Password: ');
  rl.close();

  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  console.log(`Signed in as ${email} (uid: ${uid})`);

  const q = query(collection(db, 'items'), where('userId', '==', uid));
  const snapshot = await getDocs(q);
  console.log(`Found ${snapshot.size} item(s) owned by this user.`);

  const migrated = [];
  const skipped = [];
  const failed = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const modelUrl = data.modelUrl;

    if (!modelUrl) {
      skipped.push({ id: docSnap.id, reason: 'no modelUrl field' });
      continue;
    }
    if (isOwnedStorageUrl(modelUrl)) {
      skipped.push({ id: docSnap.id, reason: 'already Firebase Storage' });
      continue;
    }

    console.log(`Migrating ${docSnap.id} (${modelUrl.slice(0, 90)}...)`);
    try {
      const res = await fetch(modelUrl);
      if (!res.ok) {
        throw new Error(`upstream responded ${res.status} (URL likely expired — unrecoverable without re-generating from source photos)`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());

      const storageRef = ref(storage, `items/${uid}/${docSnap.id}/model.glb`);
      await uploadBytes(storageRef, bytes, { contentType: 'model/gltf-binary' });
      const newUrl = await getDownloadURL(storageRef);

      await updateDoc(doc(db, 'items', docSnap.id), {
        modelUrl: newUrl,
        legacyModelUrl: modelUrl,
      });

      migrated.push(docSnap.id);
      console.log(`  ✓ migrated -> ${newUrl}`);
    } catch (err) {
      failed.push({ id: docSnap.id, url: modelUrl, error: err instanceof Error ? err.message : String(err) });
      console.log(`  ✗ failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Migrated: ${migrated.length}`, migrated);
  console.log(`Skipped (already fine): ${skipped.length}`, skipped);
  console.log(`Failed (unrecoverable, needs manual re-generation): ${failed.length}`, failed);

  process.exit(0);
}

main().catch((err) => {
  console.error('Migration script crashed:', err);
  process.exit(1);
});
