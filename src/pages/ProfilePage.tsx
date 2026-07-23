import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  signOut,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase';
import { getOrCreateUserProfile, updateUserAvatar, updateUserDisplayName } from '../services/users';
import { getItems } from '../services/items';
import { getOrCreateMoodboard } from '../services/moodboard';
import type { UserProfile } from '../types';

/** "Jane Doe" -> "JD", falls back to the first letter of the email local-part
 *  ("jane@x.com" -> "J") for accounts with no display name at all. */
function initialsFor(displayName: string, email: string | null): string {
  const trimmed = displayName.trim();
  if (trimmed) {
    return trimmed
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }
  return (email?.trim()[0] ?? '?').toUpperCase();
}

function formatMemberSince(createdAt: unknown): string | null {
  // Firestore Timestamp has a toDate() method; guard defensively since older
  // docs or a not-yet-resolved serverTimestamp() could be missing/null.
  const maybeTimestamp = createdAt as { toDate?: () => Date } | null | undefined;
  const date = maybeTimestamp?.toDate?.();
  if (!date) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

// PRD 4.x file structure lists a ProfileScreen ("user profile and settings")
// — the PRD gives no further detail on what that should contain, so this
// covers a reasonable "profile and settings" set: avatar, editable display
// name, account stats, password change, and Sign out (which lives here now
// that navigation moved to a bottom tab bar with no shared top nav to put it in).
export default function ProfilePage({ user }: { user: User }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [itemCount, setItemCount] = useState<number | null>(null);
  const [cardCount, setCardCount] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOrCreateUserProfile(user)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((err) => {
        if (!cancelled) setProfileError(err instanceof Error ? err.message : 'Failed to load profile');
      });
    // Stats are purely informational — a failure here shouldn't block the
    // rest of the page (avatar/name/password all still need to work), so
    // each is fetched independently rather than in the same try/catch.
    getItems(user.uid)
      .then((items) => {
        if (!cancelled) setItemCount(items.length);
      })
      .catch(() => {
        if (!cancelled) setItemCount(null);
      });
    getOrCreateMoodboard(user.uid)
      .then((board) => {
        if (!cancelled) setCardCount(board.cards.length);
      })
      .catch(() => {
        if (!cancelled) setCardCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleAvatarFileChange(file: File | undefined) {
    if (!file) return;
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      const photoURL = await updateUserAvatar(user.uid, file);
      setProfile((p) => (p ? { ...p, photoURL } : p));
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Failed to upload avatar');
    } finally {
      setAvatarUploading(false);
      // Allow re-selecting the exact same file again later (e.g. after
      // fixing and re-uploading) — browsers don't fire onChange for an
      // unchanged file list otherwise.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function startEditingName() {
    setNameInput(profile?.displayName ?? '');
    setNameError(null);
    setEditingName(true);
  }

  async function handleSaveName() {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError('Name cannot be empty');
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      const displayName = await updateUserDisplayName(user.uid, trimmed);
      setProfile((p) => (p ? { ...p, displayName } : p));
      setEditingName(false);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Failed to save name');
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (!user.email) {
      setPasswordError('Password change is unavailable for this account');
      return;
    }
    setPasswordBusy(true);
    try {
      // Changing a password is a sensitive Auth operation — Firebase requires
      // a *recent* sign-in and throws 'auth/requires-recent-login' otherwise,
      // so re-authenticate with the current password first rather than
      // surfacing that cryptic error to the user.
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      setPasswordSuccess('Password updated.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setShowPasswordForm(false);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setPasswordBusy(false);
    }
  }

  const displayName = profile?.displayName ?? user.displayName ?? '';
  const memberSince = formatMemberSince(profile?.createdAt);

  return (
    <div style={{ maxWidth: 480, margin: '40px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 20 }}>Profile</h1>
      {profileError && <p style={{ color: 'crimson', fontSize: 13 }}>{profileError}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16 }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={avatarUploading}
          aria-label="Change profile photo"
          style={{
            position: 'relative',
            width: 72,
            height: 72,
            borderRadius: '50%',
            border: '1px solid #444',
            padding: 0,
            overflow: 'hidden',
            cursor: 'pointer',
            background: '#333',
            flexShrink: 0,
          }}
        >
          {profile?.photoURL ? (
            <img src={profile.photoURL} alt="Your avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <span style={{ fontSize: 24, color: '#ddd' }}>{initialsFor(displayName, user.email)}</span>
          )}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              fontSize: 10,
              padding: '2px 0',
            }}
          >
            {avatarUploading ? '…' : 'Change'}
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => handleAvatarFileChange(e.target.files?.[0])}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          {editingName ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                autoFocus
                style={{ flex: 1, minWidth: 0 }}
              />
              <button onClick={handleSaveName} disabled={savingName}>
                {savingName ? '…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditingName(false)} disabled={savingName}>
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>{displayName || 'Add your name'}</span>
              <button type="button" onClick={startEditingName} style={{ fontSize: 11, background: 'none', border: 'none', color: '#6ea8ff', cursor: 'pointer', padding: 0 }}>
                Edit
              </button>
            </div>
          )}
          <p style={{ color: '#888', fontSize: 13, marginTop: 4 }}>{user.email}</p>
        </div>
      </div>
      {nameError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 4 }}>{nameError}</p>}
      {avatarError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 4 }}>{avatarError}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
        <div style={{ flex: 1, border: '1px solid #333', borderRadius: 6, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 18 }}>{itemCount ?? '—'}</div>
          <div style={{ fontSize: 11, color: '#888' }}>Items</div>
        </div>
        <div style={{ flex: 1, border: '1px solid #333', borderRadius: 6, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 18 }}>{cardCount ?? '—'}</div>
          <div style={{ fontSize: 11, color: '#888' }}>Moodboard cards</div>
        </div>
        <div style={{ flex: 1, border: '1px solid #333', borderRadius: 6, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 13 }}>{memberSince ?? '—'}</div>
          <div style={{ fontSize: 11, color: '#888' }}>Member since</div>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        {!showPasswordForm ? (
          <button
            type="button"
            onClick={() => {
              setShowPasswordForm(true);
              setPasswordError(null);
              setPasswordSuccess(null);
            }}
          >
            Change password
          </button>
        ) : (
          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 280 }}>
            <h2 style={{ fontSize: 14, margin: 0 }}>Change password</h2>
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              required
              minLength={6}
            />
            {passwordError && <p style={{ color: 'crimson', fontSize: 12, margin: 0 }}>{passwordError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={passwordBusy}>
                {passwordBusy ? 'Saving…' : 'Save password'}
              </button>
              <button
                type="button"
                disabled={passwordBusy}
                onClick={() => {
                  setShowPasswordForm(false);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmNewPassword('');
                  setPasswordError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {passwordSuccess && !showPasswordForm && <p style={{ color: '#6ea8ff', fontSize: 12, marginTop: 8 }}>{passwordSuccess}</p>}
      </div>

      <button onClick={() => signOut(auth)} style={{ marginTop: 32 }}>
        Sign out
      </button>
    </div>
  );
}
