import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import LoginPage from './pages/LoginPage';
import UploadPage from './pages/UploadPage';
import HomePage from './pages/HomePage';
import ItemsPage from './pages/ItemsPage';
import ProfilePage from './pages/ProfilePage';
import MoodboardPage from './pages/MoodboardPage';
import MoodboardViewPage from './pages/MoodboardViewPage';
import BottomTabBar, { type TabDef } from './components/BottomTabBar';
import type { Item } from './types';

// Matches the design handoff's actual bottom nav: three regular tabs
// (记忆/物件/我的) plus a separate 拍照 scan FAB — Add Item and the canvas
// are no longer tabs of their own, they're reached from Home/Items (scan)
// and from a Collection row's "Open Canvas" action (canvas).
type Tab = 'home' | 'items' | 'profile';

const TABS: TabDef[] = [
  { key: 'home', label: 'Memories', icon: 'home' },
  { key: 'items', label: 'Items', icon: 'box' },
  { key: 'profile', label: 'Me', icon: 'person' },
];

// The logged-in tab shell — everything that requires an authenticated user.
function AuthenticatedApp({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>('home');
  // Scan and the per-collection canvas are full-screen overlays on top of
  // the tab shell rather than tabs themselves — both have their own back
  // navigation instead of living in the persistent bottom nav.
  const [scanning, setScanning] = useState(false);
  const [activeCanvas, setActiveCanvas] = useState<{ collectionId: string | null; collectionName: string } | null>(null);
  // Cross-tab hand-off: tapping an item in Items should open it in Home's
  // (the only screen with a full item detail view) detail view — see
  // HomePage's pendingItemId/onConsumePendingItem.
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  // The design handoff's item-detail screen replaces the whole screen (tab
  // bar included) with its own fixed action footer — mirrored here by
  // hiding BottomTabBar instead of stacking two fixed-bottom bars.
  const [itemDetailOpen, setItemDetailOpen] = useState(false);

  if (scanning) {
    return <UploadPage user={user} onExit={() => setScanning(false)} />;
  }

  if (activeCanvas) {
    return (
      <MoodboardPage
        user={user}
        collectionId={activeCanvas.collectionId}
        collectionName={activeCanvas.collectionName}
        onBack={() => setActiveCanvas(null)}
      />
    );
  }

  return (
    <div>
      {/* Bottom-fixed tab bar means content needs bottom padding so the last
          bit of scrollable content isn't hidden behind it — not needed while
          an item detail's own fixed action footer has taken its place. */}
      <div style={{ paddingBottom: itemDetailOpen ? 0 : 96 }}>
        {tab === 'home' && (
          <HomePage
            user={user}
            onAddItem={() => setScanning(true)}
            onOpenCanvas={(collectionId, collectionName) => setActiveCanvas({ collectionId, collectionName })}
            pendingItemId={pendingItemId}
            onConsumePendingItem={() => setPendingItemId(null)}
            onDetailOpenChange={setItemDetailOpen}
          />
        )}
        {tab === 'items' && (
          <ItemsPage
            user={user}
            onSelectItem={(item: Item) => {
              setPendingItemId(item.id);
              setTab('home');
            }}
          />
        )}
        {tab === 'profile' && <ProfilePage user={user} />}
      </div>

      {!itemDetailOpen && <BottomTabBar tabs={TABS} active={tab} onChange={setTab} onScan={() => setScanning(true)} />}
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
