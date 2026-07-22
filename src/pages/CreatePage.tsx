import { useState } from 'react';
import type { User } from 'firebase/auth';
import Image2DTestPage from './Image2DTestPage';
import UploadPage from './UploadPage';

type CreationMode = '2d' | '3d';

export default function CreatePage({ user, testMode = false }: { user: User; testMode?: boolean }) {
  const [mode, setMode] = useState<CreationMode>('2d');

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px', textAlign: 'left' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Add Item</h1>
        <p style={{ color: '#888' }}>Choose a 2D keepsake or build a rotatable 3D model.</p>
      </header>

      <div role="tablist" aria-label="Creation type" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === '2d'}
          onClick={() => setMode('2d')}
          style={{ padding: 14, borderColor: mode === '2d' ? '#6ea8ff' : undefined }}
        >
          2D · One photo
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === '3d'}
          onClick={() => setMode('3d')}
          style={{ padding: 14, borderColor: mode === '3d' ? '#6ea8ff' : undefined }}
        >
          3D · Two to four photos
        </button>
      </div>

      <section role="tabpanel">
        {mode === '2d' ? <Image2DTestPage /> : <UploadPage user={user} testMode={testMode} />}
      </section>
    </main>
  );
}
