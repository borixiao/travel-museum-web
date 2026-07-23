import { useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase';
import { createUserProfile } from '../services/users';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // PRD 4.1 "Forgot password" — separate from `busy`/`error` above since
  // this is a side action off the main login/register submit, not a form
  // mode of its own.
  const [resetSending, setResetSending] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // PRD 4.1 "Confirm password field on register" — checked client-side
    // before ever touching Firebase Auth, so a typo is caught instantly
    // rather than surfacing as a confusing post-request error.
    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const trimmedName = displayName.trim();
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        // Best-effort: the account is already created either way at this
        // point, so a failure here shouldn't block the user from getting
        // in — the §4.2 welcome banner falls back to a lazily-backfilled
        // profile (getOrCreateUserProfile) the next time HomePage loads.
        try {
          if (trimmedName) await updateProfile(cred.user, { displayName: trimmedName });
          await createUserProfile(cred.user.uid, cred.user.email ?? email, trimmedName);
        } catch (profileErr) {
          console.warn('Failed to create user profile', profileErr);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    setError(null);
    setResetMessage(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Enter your email above first, then click "Forgot password?"');
      return;
    }
    setResetSending(true);
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      // Firebase's default email-enumeration protection means this resolves
      // successfully even for an email with no account — so the message is
      // deliberately non-committal about whether an account exists, rather
      // than implying "check your inbox" always means one exists.
      setResetMessage('If an account exists for that email, a password reset link has been sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send password reset email');
    } finally {
      setResetSending(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', textAlign: 'left' }}>
      <h1>Travel Memory Museum</h1>
      <p style={{ color: '#888' }}>3D texture rendering test</p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {mode === 'register' && (
          <input
            type="text"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        )}
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
        {mode === 'register' && (
          <input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
          />
        )}
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        {resetMessage && <p style={{ color: '#6ea8ff' }}>{resetMessage}</p>}
        <button type="submit" disabled={busy}>
          {mode === 'login' ? 'Log In' : 'Register'}
        </button>
      </form>
      {mode === 'login' && (
        <button
          type="button"
          onClick={handleForgotPassword}
          disabled={resetSending}
          style={{ marginTop: 12, background: 'none', border: 'none', color: '#6ea8ff', cursor: 'pointer', padding: 0, display: 'block' }}
        >
          {resetSending ? 'Sending…' : 'Forgot password?'}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setConfirmPassword('');
          setError(null);
          setResetMessage(null);
        }}
        style={{ marginTop: 12, background: 'none', border: 'none', color: '#6ea8ff', cursor: 'pointer' }}
      >
        {mode === 'login' ? 'Need an account? Register' : 'Have an account? Log in'}
      </button>
    </div>
  );
}
