import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import LoginPage from './pages/LoginPage';
import CreatePage from './pages/CreatePage';
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

const LOCAL_TEST_MODE_ENABLED = import.meta.env.DEV && import.meta.env.VITE_API_TEST_MODE === 'true';
const LOCAL_TEST_USER = {
  uid: 'local-test-user',
  email: 'local-test@travel-museum.test',
} as User;

function FirebaseDataNotice({ feature }: { feature: string }) {
  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 20 }}>{feature}</h1>
      <p style={{ color: '#888' }}>
        This area reads Firebase data, so it is paused in local test mode. Register or log in to test it with real data.
      </p>
    </div>
  );
}

// The logged-in tab shell — everything that requires an authenticated user.
function AuthenticatedApp({
  user,
  testMode = false,
  onExitTestMode,
}: {
  user: User;
  testMode?: boolean;
  onExitTestMode?: () => void;
}) {
  const [tab, setTab] = useState<Tab>(testMode ? 'upload' : 'home');

  return (
    <div>
      {/* Bottom-fixed tab bar means content needs bottom padding so the last
          bit of scrollable content isn't hidden behind it. */}
      <div style={{ paddingBottom: 64 }}>
        {tab === 'home' && (testMode ? <FirebaseDataNotice feature="Collection" /> : <HomePage user={user} />)}
        {tab === 'upload' && <CreatePage user={user} testMode={testMode} />}
        {tab === 'moodboard' && (testMode ? <FirebaseDataNotice feature="Moodboard" /> : <MoodboardPage user={user} />)}
        {tab === 'profile' && <ProfilePage user={user} onSignOut={testMode ? onExitTestMode : undefined} />}
      </div>

      <BottomTabBar tabs={TABS} active={tab} onChange={setTab} />
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [localTestMode, setLocalTestMode] = useState(false);

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
          element={
            loading ? null : localTestMode ? (
              <AuthenticatedApp
                user={LOCAL_TEST_USER}
                testMode
                onExitTestMode={() => setLocalTestMode(false)}
              />
            ) : user ? (
              <AuthenticatedApp user={user} />
            ) : (
              <LoginPage onEnterTestMode={LOCAL_TEST_MODE_ENABLED ? () => setLocalTestMode(true) : undefined} />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
