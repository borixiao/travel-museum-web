import { useState } from 'react';
import { signOut, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { generate3DModel, pollTaskUntilDone, modelProxyUrl } from '../services/tripoClient';
import { saveItem } from '../services/items';
import ModelViewer from '../components/ModelViewer';
import type { PhotoSlot } from '../types';

const SLOTS: PhotoSlot[] = ['front', 'left', 'back', 'right'];

type Status = 'idle' | 'uploading' | 'generating' | 'preview' | 'error' | 'saving' | 'saved';

export default function UploadPage({ user }: { user: User }) {
  const [photos, setPhotos] = useState<Partial<Record<PhotoSlot, File>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modelBlobUrl, setModelBlobUrl] = useState<string | null>(null);
  const [modelBlob, setModelBlob] = useState<Blob | null>(null);

  function handlePhotoChange(slot: PhotoSlot, file: File | undefined) {
    setPhotos((prev) => ({ ...prev, [slot]: file }));
  }

  async function handleGenerate() {
    setError(null);
    setStatus('uploading');
    setProgress(0);
    try {
      const taskId = await generate3DModel(photos);
      setStatus('generating');
      const task = await pollTaskUntilDone(taskId, setProgress);
      if (task.status !== 'success' || !task.model_url) {
        throw new Error(task.error_msg || 'Generation failed');
      }

      const res = await fetch(modelProxyUrl(task.model_url));
      if (!res.ok) throw new Error('Failed to download generated model');
      const blob = await res.blob();
      setModelBlob(blob);
      setModelBlobUrl(URL.createObjectURL(blob));
      setStatus('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    }
  }

  async function handleSave() {
    if (!modelBlob) return;
    setStatus('saving');
    setError(null);
    try {
      const photoFiles = SLOTS.map((slot) => photos[slot]).filter((f): f is File => !!f);
      await saveItem(user.uid, photoFiles, modelBlob);
      setStatus('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
      setStatus('error');
    }
  }

  const canGenerate = Object.values(photos).some(Boolean) && status !== 'uploading' && status !== 'generating';

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20 }}>3D Texture Test</h1>
        <button onClick={() => signOut(auth)}>Sign out</button>
      </div>
      <p style={{ color: '#888' }}>Logged in as {user.email}</p>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>1. Upload 3–4 angle photos</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {SLOTS.map((slot) => (
          <label key={slot} style={{ border: '1px dashed #666', padding: 8, borderRadius: 6, textAlign: 'center', cursor: 'pointer' }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>{slot}{slot === 'front' ? ' (required)' : ''}</div>
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => handlePhotoChange(slot, e.target.files?.[0])}
            />
            <div style={{ fontSize: 11, color: photos[slot] ? '#6ea8ff' : '#888' }}>
              {photos[slot] ? photos[slot]!.name : 'Choose file'}
            </div>
          </label>
        ))}
      </div>

      <button onClick={handleGenerate} disabled={!canGenerate} style={{ marginTop: 16 }}>
        Generate 3D Model
      </button>

      {(status === 'uploading' || status === 'generating') && (
        <p>{status === 'uploading' ? 'Uploading photos…' : `Generating… ${progress}%`}</p>
      )}
      {status === 'error' && error && <p style={{ color: 'crimson' }}>{error}</p>}

      {modelBlobUrl && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16 }}>2. Preview (rotate with mouse)</h2>
          <ModelViewer url={modelBlobUrl} />
          <button onClick={handleSave} disabled={status === 'saving' || status === 'saved'} style={{ marginTop: 12 }}>
            {status === 'saved' ? 'Saved ✓' : status === 'saving' ? 'Saving…' : 'Save to Firebase'}
          </button>
        </div>
      )}
    </div>
  );
}
