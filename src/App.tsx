import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import LoginPage from './pages/LoginPage';
import UploadPage from './pages/UploadPage';
import HomePage from './pages/HomePage';
import ProfilePage from './pages/ProfilePage';
import MoodboardPage from './pages/MoodboardPage';
import MoodboardViewPage from './pages/MoodboardViewPage';
import BottomTabBar, { type TabDef } from './components/BottomTabBar';

// Mirrors the PRD's screen list (HomeScreen/CollectionScreen, AddItemScreen,
// MoodboardScreen, ProfileScreen) as top-level tabs.
type Tab = 'home' | 'upload' | 'moodboard' | 'profile';

const TABS: TabDef[] = [
  { key: 'home', label: 'Collection', icon: '🏛️' },
  { key: 'upload', label: 'Add Item', icon: '➕' },
  { key: 'moodboard', label: 'Moodboard', icon: '🎨' },
  { key: 'profile', label: 'Profile', icon: '👤' },
];

// The logged-in tab shell — everything that requires an authenticated user.
function AuthenticatedApp({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>('home');

  return (
    <div>
      {/* Bottom-fixed tab bar means content needs bottom padding so the last
          bit of scrollable content isn't hidden behind it. */}
      <div style={{ paddingBottom: 64 }}>
        {tab === 'home' && <HomePage user={user} />}
        {tab === 'upload' && <UploadPage user={user} />}
        {tab === 'moodboard' && <MoodboardPage user={user} />}
        {tab === 'profile' && <ProfilePage user={user} />}
      </div>

      <BottomTabBar tabs={TABS} active={tab} onChange={setTab} />
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public — reachable without logging in, so a moodboard link works
            for any visitor it's shared with (PRD: "publish a public link"). */}
        <Route path="/m/:moodboardId" element={<MoodboardViewPage />} />
        <Route
          path="*"
          element={loading ? null : user ? <AuthenticatedApp user={user} /> : <LoginPage />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
