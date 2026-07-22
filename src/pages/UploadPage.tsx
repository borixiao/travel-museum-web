import { useState } from 'react';
import type { User } from 'firebase/auth';
import { generate3DModel, pollTaskUntilDone, modelProxyUrl } from '../services/tripoClient';
import { generateStickerFromFile } from '../services/stickerClient';
import { saveItem } from '../services/items';
import ModelViewer from '../components/ModelViewer';
import ProgressBar from '../components/ProgressBar';
import ItemMetadataForm, { emptyItemMetadata } from '../components/ItemMetadataForm';
import type { PhotoSlot, ItemMetadata } from '../types';

const SLOTS: PhotoSlot[] = ['front', 'left', 'back', 'right'];

type Status = 'idle' | 'uploading' | 'generating' | 'preview' | 'error' | 'saving' | 'saved';

export default function UploadPage({ user, testMode = false }: { user: User; testMode?: boolean }) {
  const [photos, setPhotos] = useState<Partial<Record<PhotoSlot, File>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modelBlobUrl, setModelBlobUrl] = useState<string | null>(null);
  const [modelBlob, setModelBlob] = useState<Blob | null>(null);
  const [saveStage, setSaveStage] = useState<string | null>(null);
  const [errorStage, setErrorStage] = useState<'generate' | 'save' | null>(null);

  // Item metadata (PRD 4.3 Add Item Screen — item name/type/location/date/story/emotion tags)
  const [metadata, setMetadata] = useState<ItemMetadata>(emptyItemMetadata);

  function handlePhotoChange(slot: PhotoSlot, file: File | undefined) {
    setPhotos((prev) => ({ ...prev, [slot]: file }));
  }

  async function handleGenerate() {
    setError(null);
    setErrorStage(null);
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
      setErrorStage('generate');
      setStatus('error');
    }
  }

  async function handleSave() {
    if (!modelBlob) return;
    setStatus('saving');
    setError(null);
    setErrorStage(null);
    setSaveStage('Preparing…');
    try {
      const photoFiles = SLOTS.map((slot) => photos[slot]).filter((f): f is File => !!f);
      const trimmedMetadata: ItemMetadata = {
        ...metadata,
        name: metadata.name.trim(),
        // Custom type left blank (e.g. user picked "Custom…" then didn't type
        // anything) falls back to "Other" rather than saving an empty type.
        type: metadata.type.trim() || 'Other',
        location: metadata.location.trim(),
        story: metadata.story.trim(),
      };

      // AI sticker generation (gpt-image-2) is a best-effort enhancement —
      // if it fails for any reason (bad key, rate limit, OpenAI outage), we
      // log it and continue saving with no sticker rather than blocking the
      // save. The Collection grid falls back to the real photo in that case.
      let stickerBlob: Blob | null = null;
      setSaveStage('Generating AI sticker…');
      try {
        stickerBlob = await generateStickerFromFile(photoFiles[0], trimmedMetadata.name, trimmedMetadata.type);
      } catch (stickerErr) {
        console.warn('AI sticker generation failed, falling back to photo thumbnail:', stickerErr);
      }

      await saveItem(user.uid, photoFiles, modelBlob, trimmedMetadata, setSaveStage, stickerBlob);
      setStatus('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
      setErrorStage('save');
      setStatus('error');
    } finally {
      setSaveStage(null);
    }
  }

  const hasFront = !!photos.front;
  const photoCount = Object.values(photos).filter(Boolean).length;
  // Tripo's multiview_to_model rejects tasks with fewer than 2 real photos
  // (confirmed via direct API testing) — not a quality nicety, a hard floor.
  const hasMinPhotos = photoCount >= 2;
  const hasName = metadata.name.trim().length > 0;
  const canGenerate = hasFront && hasMinPhotos && hasName && status !== 'uploading' && status !== 'generating';

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 20 }}>3D Texture Test</h1>
      <p style={{ color: '#888' }}>Logged in as {user.email}</p>
      {testMode && (
        <p style={{ color: '#8a5200', background: '#fff4d6', padding: 10, borderRadius: 6 }}>
          Local test mode: model generation can be previewed, but Firebase saving is disabled.
        </p>
      )}

      <h2 style={{ fontSize: 16, marginTop: 24 }}>1. Upload photos (front + at least 1 more angle required)</h2>
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

      {!hasFront && (
        <p style={{ color: '#e0a030', fontSize: 12, marginTop: 8 }}>Front photo is required to generate a model.</p>
      )}
      {hasFront && !hasMinPhotos && (
        <p style={{ color: '#e0a030', fontSize: 12, marginTop: 8 }}>
          At least 1 more angle (left/back/right) is required — Tripo needs 2+ photos to build a 3D model.
        </p>
      )}
      {hasFront && hasMinPhotos && photoCount < 4 && (
        <p style={{ color: '#888', fontSize: 12, marginTop: 8 }}>
          Tip: adding more angles improves model quality, though you have enough to generate now.
        </p>
      )}

      <h2 style={{ fontSize: 16, marginTop: 24 }}>2. Item details</h2>
      <ItemMetadataForm value={metadata} onChange={setMetadata} nameRequired />

      {!hasName && (
        <p style={{ color: '#e0a030', fontSize: 12, marginTop: 8 }}>Item name is required to generate a model.</p>
      )}

      <button onClick={handleGenerate} disabled={!canGenerate} style={{ marginTop: 16 }}>
        Generate 3D Model
      </button>

      {(status === 'uploading' || status === 'generating') && (
        <div style={{ marginTop: 12 }}>
          <p style={{ marginBottom: 4 }}>{status === 'uploading' ? 'Uploading photos…' : `Generating… ${progress}%`}</p>
          <ProgressBar progress={status === 'generating' ? progress : undefined} />
        </div>
      )}
      {status === 'error' && error && errorStage === 'generate' && (
        <div style={{ marginTop: 8 }}>
          <p style={{ color: 'crimson' }}>{error}</p>
          <button onClick={handleGenerate} disabled={!canGenerate}>
            Try again
          </button>
        </div>
      )}

      {modelBlobUrl && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16 }}>3. Preview (rotate with mouse)</h2>
          <ModelViewer url={modelBlobUrl} />
          <button onClick={handleSave} disabled={testMode || status === 'saving' || status === 'saved'} style={{ marginTop: 12 }}>
            {testMode ? 'Firebase save disabled in test mode' : status === 'saved' ? 'Saved ✓' : status === 'saving' ? (saveStage ?? 'Saving…') : 'Save to Firebase'}
          </button>
          {status === 'error' && error && errorStage === 'save' && (
            <div style={{ marginTop: 8 }}>
              <p style={{ color: 'crimson' }}>{error}</p>
              <button onClick={handleSave}>Try again</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
