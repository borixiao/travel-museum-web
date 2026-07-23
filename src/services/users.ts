import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { updateProfile, type User } from 'firebase/auth';
import { auth, db, storage } from '../firebase';
import type { UserProfile } from '../types';

// Client-side guard only (Storage rules should also cap this server-side) —
// avatars are small display images, no reason to let someone upload a
// multi-hundred-MB file and eat into Storage quota.
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Falls back to the email's local-part (e.g. "jane" from "jane@x.com") for
 *  accounts that don't have a display name to show. */
function fallbackDisplayName(email: string | null): string {
  if (!email) return 'there';
  return email.split('@')[0];
}

/**
 * Called right after registration, when we already know the display name the
 * user just typed in. Uses the uid as the doc ID (not addDoc) since every
 * user has exactly one profile doc, keyed by their auth uid.
 */
export async function createUserProfile(uid: string, email: string, displayName: string): Promise<UserProfile> {
  const ref = doc(db, 'users', uid);
  await setDoc(ref, {
    uid,
    email,
    displayName: displayName.trim() || fallbackDisplayName(email),
    createdAt: serverTimestamp(),
  });
  const snap = await getDoc(ref);
  return snap.data() as UserProfile;
}

/**
 * Lazy get-or-create (mirrors getOrCreateMoodboard in services/moodboard.ts)
 * — backfills a `users` doc for accounts created before this feature existed,
 * so the §4.2 welcome banner always has a name to show without a migration
 * script.
 */
export async function getOrCreateUserProfile(user: User): Promise<UserProfile> {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data() as UserProfile;

  return createUserProfile(user.uid, user.email ?? '', user.displayName ?? fallbackDisplayName(user.email));
}

/**
 * Profile Screen "edit display name" — updates the `users/{uid}` Firestore
 * doc (the source of truth this app actually reads from, e.g. HomePage's
 * welcome banner) and best-effort mirrors it onto the Firebase Auth user
 * object too. The Auth mirror is wrapped separately and never allowed to
 * fail the whole operation: nothing in this app currently reads
 * `user.displayName` live off the Auth object (it would need a page reload
 * to reflect anyway, since updateProfile mutates in place without firing
 * onAuthStateChanged), so it's a nice-to-have sync, not the real update.
 */
export async function updateUserDisplayName(uid: string, displayName: string): Promise<string> {
  const trimmed = displayName.trim();
  await updateDoc(doc(db, 'users', uid), { displayName: trimmed });
  try {
    if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: trimmed });
  } catch (err) {
    console.warn('Failed to sync displayName to Firebase Auth profile', err);
  }
  return trimmed;
}

/**
 * Profile Screen "avatar upload" — uploads to a fixed path (so re-uploading
 * overwrites the old avatar rather than accumulating orphaned files), then
 * writes the download URL to the `users/{uid}` doc and best-effort mirrors
 * it to the Auth profile (same rationale as updateUserDisplayName above).
 */
export async function updateUserAvatar(uid: string, file: File): Promise<string> {
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('Image is too large (max 5 MB) — please choose a smaller photo.');
  }
  const avatarRef = ref(storage, `users/${uid}/avatar`);
  await uploadBytes(avatarRef, file);
  const photoURL = await getDownloadURL(avatarRef);
  await updateDoc(doc(db, 'users', uid), { photoURL });
  try {
    if (auth.currentUser) await updateProfile(auth.currentUser, { photoURL });
  } catch (err) {
    console.warn('Failed to sync photoURL to Firebase Auth profile', err);
  }
  return photoURL;
}
