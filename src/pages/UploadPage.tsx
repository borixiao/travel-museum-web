import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { generate3DModelWithRetry, isAbortError, MAX_GENERATE_ATTEMPTS, modelProxyUrl } from '../services/tripoClient';
import { generateStickerFromFile } from '../services/stickerClient';
import { saveItem } from '../services/items';
import ModelViewer from '../components/ModelViewer';
import ProgressBar from '../components/ProgressBar';
import ItemMetadataForm, { emptyItemMetadata } from '../components/ItemMetadataForm';
import type { PhotoSlot, ItemMetadata } from '../types';

const SLOTS: PhotoSlot[] = ['front', 'left', 'back', 'right'];

type Status = 'idle' | 'uploading' | 'generating' | 'preview' | 'error' | 'saving' | 'saved';

export default function UploadPage({ user }: { user: User }) {
  const [photos, setPhotos] = useState<Partial<Record<PhotoSlot, File>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modelBlobUrl, setModelBlobUrl] = useState<string | null>(null);
  const [modelBlob, setModelBlob] = useState<Blob | null>(null);
  const [saveStage, setSaveStage] = useState<string | null>(null);
  const [errorStage, setErrorStage] = useState<'generate' | 'save' | null>(null);
  // PRD 7 "Automatic retry (up to 2x) on Tripo3D generation failure" —
  // surfaced in the UI so a visitor sees "attempt 2 of 3" rather than the
  // upload/progress bar appearing to silently restart from 0.
  const [attempt, setAttempt] = useState(1);

  // Item metadata (PRD 4.3 Add Item Screen — item name/type/location/date/story/emotion tags)
  const [metadata, setMetadata] = useState<ItemMetadata>(emptyItemMetadata);

  // PRD 4.3 "Retake a single photo in place" — object URLs for the chosen
  // File so each slot can show a live thumbnail instead of just a filename.
  // Kept in a ref (mirroring state) purely so the unmount-cleanup effect
  // below can revoke whatever's current without needing to depend on state.
  const [photoPreviews, setPhotoPreviews] = useState<Partial<Record<PhotoSlot, string>>>({});
  const photoPreviewsRef = useRef<Partial<Record<PhotoSlot, string>>>({});

  // PRD 4.4 "Cancel" — the in-flight generation's AbortController, so a
  // Cancel click can actually interrupt the fetch/poll cycle rather than
  // just hiding the UI while the request keeps running in the background.
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Revoke every still-live preview URL on unmount — object URLs otherwise
    // leak for the lifetime of the page/tab.
    return () => {
      Object.values(photoPreviewsRef.current).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, []);

  function handlePhotoChange(slot: PhotoSlot, file: File | undefined) {
    setPhotos((prev) => ({ ...prev, [slot]: file }));
    setPhotoPreviews((prev) => {
      const next = { ...prev };
      const prevUrl = next[slot];
      if (prevUrl) URL.revokeObjectURL(prevUrl);
      if (file) {
        next[slot] = URL.createObjectURL(file);
      } else {
        delete next[slot];
      }
      photoPreviewsRef.current = next;
      return next;
    });
  }

  async function handleGenerate() {
    setError(null);
    setErrorStage(null);
    setStatus('uploading');
    setProgress(0);
    setAttempt(1);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const task = await generate3DModelWithRetry(
        photos,
        {
          onAttemptStart: (a) => {
            setAttempt(a);
            setStatus('uploading');
            setProgress(0);
          },
          onProgress: (p) => {
            setStatus('generating');
            setProgress(p);
          },
        },
        controller.signal,
      );
      if (task.status !== 'success' || !task.model_url) {
        throw new Error(task.error_msg || 'Generation failed');
      }

      const res = await fetch(modelProxyUrl(task.model_url), { signal: controller.signal });
      if (!res.ok) throw new Error('Failed to download generated model');
      const blob = await res.blob();
      setModelBlob(blob);
      // Regenerating from a successful Preview leaves the old model's blob
      // URL on screen until this new one is ready (see the Preview section
      // below, which stays mounted through a regenerate), so swap-and-revoke
      // here rather than revoking eagerly at the start of the attempt —
      // otherwise the still-visible <model-viewer> would lose its source
      // mid-regeneration.
      setModelBlobUrl((prevUrl) => {
        if (prevUrl) URL.revokeObjectURL(prevUrl);
        return URL.createObjectURL(blob);
      });
      setStatus('preview');
    } catch (err) {
      if (isAbortError(err)) {
        // A deliberate Cancel click — not an error, just back to idle so the
        // user can adjust photos/details and try again from scratch.
        setStatus('idle');
        setProgress(0);
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setErrorStage('generate');
        setStatus('error');
      }
    } finally {
      abortControllerRef.current = null;
    }
  }

  function handleCancelGenerate() {
    abortControllerRef.current?.abort();
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
  const isGenerating = status === 'uploading' || status === 'generating';
  const canGenerate = hasFront && hasMinPhotos && hasName && !isGenerating;

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 20 }}>3D Texture Test</h1>
      <p style={{ color: '#888' }}>Logged in as {user.email}</p>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>1. Upload photos (front + at least 1 more angle required)</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {SLOTS.map((slot) => {
          const inputId = `photo-slot-${slot}`;
          const preview = photoPreviews[slot];
          return (
            // Outer div is a plain positioning container, NOT a <label> —
            // the "×" clear button below is a sibling of the <label>, not a
            // descendant of it. Nesting the button inside the label would
            // risk the browser's native label→input click-forwarding still
            // opening the file picker even with stopPropagation() on the
            // button's own click handler.
            <div key={slot} style={{ position: 'relative', border: '1px dashed #666', borderRadius: 6, overflow: 'hidden' }}>
              <label
                htmlFor={inputId}
                style={{ display: 'block', padding: 8, textAlign: 'center', cursor: 'pointer' }}
              >
                <div style={{ fontSize: 12, marginBottom: 4 }}>{slot}{slot === 'front' ? ' (required)' : ''}</div>
                <input
                  id={inputId}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    handlePhotoChange(slot, e.target.files?.[0]);
                    // Reset the native input's own value after every pick.
                    // Browsers only fire `change` when the input's value
                    // actually differs from before, and a <input type="file">
                    // compares by filename/path — so re-selecting the exact
                    // same file as last time (e.g. re-picking the photo you
                    // just cleared with the "×" button) silently does nothing
                    // without this, since as far as the DOM is concerned
                    // nothing changed. Clearing the value here means the next
                    // pick always starts from "empty", so `change` reliably
                    // fires even for the same file twice in a row.
                    e.target.value = '';
                  }}
                />
                {preview ? (
                  <>
                    <img
                      src={preview}
                      alt={`${slot} preview`}
                      style={{ width: '100%', height: 64, objectFit: 'cover', borderRadius: 4, display: 'block' }}
                    />
                    <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Tap to retake</div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: '#888' }}>Choose file</div>
                )}
              </label>
              {preview && (
                <button
                  type="button"
                  onClick={() => handlePhotoChange(slot, undefined)}
                  aria-label={`Clear ${slot} photo`}
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 20,
                    height: 20,
                    lineHeight: '18px',
                    padding: 0,
                    borderRadius: '50%',
                    border: '1px solid #666',
                    background: '#222',
                    color: '#ddd',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
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
          <p style={{ marginBottom: 4 }}>
            {status === 'uploading' ? 'Uploading photos…' : `Generating… ${progress}%`}
            {attempt > 1 && (
              <span style={{ color: '#e0a030' }}> (retry {attempt - 1}/{MAX_GENERATE_ATTEMPTS - 1})</span>
            )}
          </p>
          <ProgressBar progress={status === 'generating' ? progress : undefined} />
          {/* PRD 4.4 "Cancel" — aborts the in-flight fetch/poll cycle via
              AbortController rather than merely hiding this UI, so a
              cancelled generation doesn't keep burning Tripo API calls in
              the background. */}
          <button onClick={handleCancelGenerate} style={{ marginTop: 8 }}>
            Cancel
          </button>
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
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={handleSave} disabled={status === 'saving' || status === 'saved' || isGenerating}>
              {status === 'saved' ? 'Saved ✓' : status === 'saving' ? (saveStage ?? 'Saving…') : 'Save to Firebase'}
            </button>
            {/* PRD 4.4 "Regenerate from Preview" — re-submits the same
                photos as a brand-new generation without starting the whole
                flow over, for when the model saved fine technically but
                isn't a satisfying result. Distinct from the "Try again"
                button below, which only appears after a failed generation;
                this one is available right on a *successful* preview.
                Disabled once saving/saved (nothing left worth regenerating
                for) or while a regenerate is already in flight (canGenerate
                already covers that via isGenerating). */}
            <button onClick={handleGenerate} disabled={!canGenerate || status === 'saving' || status === 'saved'}>
              {isGenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
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
