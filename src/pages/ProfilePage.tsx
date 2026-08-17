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
import { getCollections } from '../services/collections';
import { getMoodboardsForUser } from '../services/moodboard';
import type { UserProfile } from '../types';
import { SURFACE, FG, MUTED, BORDER, ACCENT, SOFT, actionButtonStyle, dotsBackground, pageBackground, eyebrowStyle, FONT_DISPLAY } from '../theme';

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
  const [collectionCount, setCollectionCount] = useState<number | null>(null);
  // Every Collection now has its own canvas (see services/moodboard.ts), so
  // there can be several published links, not just one — only `id`/
  // `published` are needed here for the Shared Links summary/copy action;
  // the full boards (cards, background, etc.) belong to MoodboardPage.
  const [publishedBoards, setPublishedBoards] = useState<{ id: string; published: boolean }[]>([]);
  const [linkCopied, setLinkCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    getCollections(user.uid)
      .then((cols) => {
        if (!cancelled) setCollectionCount(cols.length);
      })
      .catch(() => {
        if (!cancelled) setCollectionCount(null);
      });
    getMoodboardsForUser(user.uid)
      .then((boards) => {
        if (!cancelled) setPublishedBoards(boards.filter((b) => b.published));
      })
      .catch(() => {
        if (!cancelled) setPublishedBoards([]);
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

  // Copying only makes sense for a single unambiguous link — with several
  // collections each possibly published, tapping this row otherwise just
  // shows the count (managing/copying each link individually happens from
  // that collection's own canvas via Home's "Open Canvas").
  async function handleCopyMoodboardLink() {
    if (publishedBoards.length !== 1) return;
    const url = `${window.location.origin}/m/${publishedBoards[0].id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard API can fail (permissions, insecure context) — not worth
      // its own error state for a "nice to have" copy shortcut; the user can
      // still get the link from that collection's own canvas.
    }
  }

  const displayName = profile?.displayName ?? user.displayName ?? '';
  const memberSince = formatMemberSince(profile?.createdAt);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', boxSizing: 'border-box', ...pageBackground, padding: '24px 16px 40px', color: FG }}>
      <h1 style={{ textAlign: 'center', fontSize: 17, fontWeight: 700, margin: '0 0 20px' }}>Profile</h1>
      {profileError && <p style={{ color: 'crimson', fontSize: 13 }}>{profileError}</p>}

      {/* Account card — dotted background matches the collection-row/scan-
          wizard treatment elsewhere, so the avatar reads as "floating" on
          it the same way a scanned photo does. */}
      <div
        style={{
          borderRadius: 20,
          padding: 20,
          ...dotsBackground(),
        }}
      >
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
            border: '3px solid ' + SURFACE,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            padding: 0,
            overflow: 'hidden',
            cursor: avatarUploading ? 'default' : 'pointer',
            background: FG,
            flexShrink: 0,
          }}
        >
          {profile?.photoURL ? (
            <img src={profile.photoURL} alt="Your avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <span style={{ fontSize: 24, color: '#fff' }}>{initialsFor(displayName, user.email)}</span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => handleAvatarFileChange(e.target.files?.[0])}
        />

        {memberSince && <div style={{ ...eyebrowStyle, marginTop: 14 }}>Member since {memberSince}</div>}

        {editingName ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              autoFocus
              style={{ flex: 1, minWidth: 0, fontSize: 20, borderRadius: 8, border: '1px solid ' + BORDER, padding: '4px 8px' }}
            />
            <button onClick={handleSaveName} disabled={savingName} style={actionButtonStyle('primary', savingName)}>
              {savingName ? '…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditingName(false)} disabled={savingName} style={actionButtonStyle('secondary', savingName)}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 36, lineHeight: 1, fontWeight: 650 }}>{displayName || 'Add your name'}</span>
            <button
              type="button"
              onClick={startEditingName}
              style={{ fontSize: 12, background: 'none', border: 'none', color: MUTED, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
            >
              Edit
            </button>
          </div>
        )}
        <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>
          {collectionCount ?? '—'} memor{collectionCount === 1 ? 'y' : 'ies'} · {itemCount ?? '—'} item{itemCount === 1 ? '' : 's'}
        </div>
        {nameError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 4 }}>{nameError}</p>}
        {avatarError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 4 }}>{avatarError}</p>}
      </div>

      {/* Shared Links row — each Collection has its own canvas, so there can
          be several published links. Copying inline only makes sense when
          there's exactly one; otherwise this is just a count, and each link
          is managed from its own collection's canvas (Home > Open Canvas). */}
      <button
        type="button"
        onClick={handleCopyMoodboardLink}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          textAlign: 'left',
          marginTop: 12,
          padding: 14,
          borderRadius: 16,
          border: '1px solid ' + BORDER,
          background: SURFACE,
          cursor: publishedBoards.length === 1 ? 'pointer' : 'default',
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: 12,
            background: SOFT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}
        >
          🔗
        </span>
        <span>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: FG }}>Shared Links</span>
          <span style={{ display: 'block', fontSize: 12, color: MUTED, marginTop: 1 }}>
            {linkCopied
              ? 'Link copied!'
              : publishedBoards.length === 0
                ? 'No shared links yet'
                : publishedBoards.length === 1
                  ? 'Tap to copy your canvas link'
                  : `${publishedBoards.length} canvases shared`}
          </span>
        </span>
      </button>

      {/* Settings row — expands the account-management controls below
          (name editing already lives on the card above; this covers
          password + sign out) rather than navigating to a separate screen. */}
      <button
        type="button"
        onClick={() => setSettingsOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          textAlign: 'left',
          marginTop: 12,
          padding: 14,
          borderRadius: 16,
          border: '1px solid ' + BORDER,
          background: SURFACE,
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: 12,
            background: SOFT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}
        >
          ⚙️
        </span>
        <span>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: FG }}>Settings</span>
          <span style={{ display: 'block', fontSize: 12, color: MUTED, marginTop: 1 }}>Password & account</span>
        </span>
      </button>

      {settingsOpen && (
        <div style={{ marginTop: 8, padding: 14, borderRadius: 16, border: '1px solid ' + BORDER, background: SURFACE }}>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 10 }}>{user.email}</div>

          {!showPasswordForm ? (
            <button
              type="button"
              onClick={() => {
                setShowPasswordForm(true);
                setPasswordError(null);
                setPasswordSuccess(null);
              }}
              style={actionButtonStyle('secondary')}
            >
              Change password
            </button>
          ) : (
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 style={{ fontSize: 14, margin: 0, color: FG }}>Change password</h2>
              <input
                type="password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                style={{ borderRadius: 8, border: '1px solid ' + BORDER, padding: '6px 8px' }}
              />
              <input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                style={{ borderRadius: 8, border: '1px solid ' + BORDER, padding: '6px 8px' }}
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                required
                minLength={6}
                style={{ borderRadius: 8, border: '1px solid ' + BORDER, padding: '6px 8px' }}
              />
              {passwordError && <p style={{ color: 'crimson', fontSize: 12, margin: 0 }}>{passwordError}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" disabled={passwordBusy} style={actionButtonStyle('primary', passwordBusy)}>
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
                  style={actionButtonStyle('secondary', passwordBusy)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {passwordSuccess && !showPasswordForm && <p style={{ color: ACCENT, fontSize: 12, marginTop: 8 }}>{passwordSuccess}</p>}

          <button onClick={() => signOut(auth)} style={{ ...actionButtonStyle('danger'), marginTop: 12 }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
