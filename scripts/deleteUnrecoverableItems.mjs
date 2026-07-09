/**
 * Permanently deletes the specific legacy `items` docs confirmed to be
 * unrecoverable (expired Tripo modelUrl + local-device-only photo URI, per
 * migrateLegacyModelUrls.mjs and checkLegacyItemPhotos.mjs output on
 * 2026-07-08). This is a HARD delete — there is no undo.
 *
 * You are running this yourself, on purpose, after reviewing the id list
 * below. Nothing here runs automatically and nothing is deleted without you
 * executing this file directly.
 *
 * Usage:
 *   npm run delete:unrecoverable-items
 * Prompts for email/password locally, same as the other scripts.
 */
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, deleteDoc } from 'firebase/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Confirmed unrecoverable: expired Tripo modelUrl AND photos[] is a
// local device file:// URI (never uploaded anywhere). Review before running.
const ITEM_IDS_TO_DELETE = [
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

  await signInWithEmailAndPassword(auth, email, password);
  console.log(`\nSigned in. About to PERMANENTLY delete ${ITEM_IDS_TO_DELETE.length} item(s):`);
  for (const id of ITEM_IDS_TO_DELETE) console.log(`  - ${id}`);

  const answer = await rl.question('\nType "delete" to confirm, anything else to abort: ');
  rl.close();

  if (answer.trim().toLowerCase() !== 'delete') {
    console.log('Aborted. Nothing was deleted.');
    process.exit(0);
  }

  for (const id of ITEM_IDS_TO_DELETE) {
    const ref = doc(db, 'items', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      console.log(`[${id}] already gone, skipping`);
      continue;
    }
    await deleteDoc(ref);
    console.log(`[${id}] deleted`);
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Delete script crashed:', err);
  process.exit(1);
});
