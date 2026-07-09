/**
 * Read-only check: for the 6 items whose modelUrl turned out to be an
 * expired Tripo signed URL (see migrateLegacyModelUrls.mjs output), inspect
 * their `photos` field to see whether the original angle photos are still
 * reachable. If they are, we can regenerate the 3D model from them and this
 * time save it properly. If not, those items just lose their 3D model —
 * no further action needed, per user decision.
 *
 * This script does NOT modify any data. It only reads and prints a report.
 *
 * Usage:
 *   npm run check:legacy-photos
 * You'll be prompted for email/password locally (same as the migration
 * script) — nothing is sent anywhere except Firebase Auth itself.
 */
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const LEGACY_ITEM_IDS = [
  '4kCGj2yuGqew9imdpaf5',
  'GZH59bDfrQMioDp6WPyh',
  'fgh2c3q5aXbD8ilfwvXu',
  'kseqQEZ8tdG9iQMzWZjO',
  'nLlU6aoQjYwO0CeuCnJd',
  'vTVtFfzfkwNp1WuXBzLI',
];

async function main() {
  const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = await rl.question('Firebase Auth email: ');
  const password = await rl.question('Password: ');
  rl.close();

  await signInWithEmailAndPassword(auth, email, password);
  console.log('Signed in.\n');

  for (const id of LEGACY_ITEM_IDS) {
    const snap = await getDoc(doc(db, 'items', id));
    if (!snap.exists()) {
      console.log(`[${id}] doc not found\n`);
      continue;
    }
    const data = snap.data();
    const photos = Array.isArray(data.photos) ? data.photos : [];
    console.log(`[${id}] ${photos.length} photo(s)`);
    for (const url of photos) {
      let host = '(unparseable)';
      try { host = new URL(url).hostname; } catch {}
      try {
        const res = await fetch(url, { method: 'GET' });
        console.log(`  - ${host} -> HTTP ${res.status}${res.ok ? ' OK' : ' NOT OK'}`);
      } catch (err) {
        console.log(`  - ${host} -> fetch error: ${err instanceof Error ? err.message : err}`);
      }
    }
    console.log('');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Check script crashed:', err);
  process.exit(1);
});
