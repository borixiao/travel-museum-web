import { signOut, type User } from 'firebase/auth';
import { auth } from '../firebase';

// PRD 4.x file structure lists a ProfileScreen ("user profile and settings") —
// this is a minimal version of it, and also the natural home for Sign out
// now that navigation moved to a bottom tab bar (no shared top nav to put it in).
export default function ProfilePage({ user }: { user: User }) {
  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 20 }}>Profile</h1>
      <p style={{ color: '#888', marginTop: 8 }}>Logged in as {user.email}</p>
      <button onClick={() => signOut(auth)} style={{ marginTop: 24 }}>
        Sign out
      </button>
    </div>
  );
}
