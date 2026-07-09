import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import LoginPage from './pages/LoginPage';
import UploadPage from './pages/UploadPage';
import HomePage from './pages/HomePage';

type Tab = 'home' | 'upload';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('home');

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  if (loading) return null;
  if (!user) return <LoginPage />;

  return (
    <div>
      <nav style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: 16 }}>
        <button onClick={() => setTab('home')} disabled={tab === 'home'}>
          My Collection
        </button>
        <button onClick={() => setTab('upload')} disabled={tab === 'upload'}>
          Add Item
        </button>
      </nav>
      {tab === 'home' ? <HomePage user={user} /> : <UploadPage user={user} />}
    </div>
  );
}

export default App;
