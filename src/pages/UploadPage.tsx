import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { generate3DModelWithRetry, isAbortError, MAX_GENERATE_ATTEMPTS, modelProxyUrl } from '../services/tripoClient';
import { generateStickerFromFile } from '../services/stickerClient';
import { classifyItemType } from '../services/itemClassifierClient';
import { saveItem } from '../services/items';
import { getCollections, createCollection } from '../services/collections';
import ModelViewer from '../components/ModelViewer';
import ProgressBar from '../components/ProgressBar';
import ItemMetadataForm, { emptyItemMetadata } from '../components/ItemMetadataForm';
import type { PhotoSlot, ItemMetadata, Collection } from '../types';
import { SURFACE, FG, MUTED, BORDER, ACCENT, dotsBackground, pageBackground, FONT_DISPLAY } from '../theme';

const SLOTS: PhotoSlot[] = ['front', 'left', 'back', 'right'];

// Per-step copy for the "Scan Item" capture wizard — front is the only
// required angle (matches Tripo's 2-photo floor being satisfiable with just
// one more), the rest are explicitly skippable.
const WIZARD_COPY: Record<PhotoSlot, { title: string; heading: string; subtitle: string }> = {
  front: {
    title: 'Scan Item',
    heading: 'Save an item with your camera',
    subtitle: "Capture the whole item — we'll generate a 2D sticker and continue building a 3D model.",
  },
  left: {
    title: 'Scan the Left Side',
    heading: 'Add another angle',
    subtitle: 'A second angle helps us build a more accurate 3D model. You can skip this step.',
  },
  back: {
    title: 'Scan the Back',
    heading: 'Add another angle',
    subtitle: 'A second angle helps us build a more accurate 3D model. You can skip this step.',
  },
  right: {
    title: 'Scan the Right Side',
    heading: 'Add another angle',
    subtitle: 'A second angle helps us build a more accurate 3D model. You can skip this step.',
  },
};

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

  // AI auto-classification of the Type field from the front photo (best-effort
  // pre-fill, never authoritative — see itemClassifierClient.ts). Fires
  // automatically as soon as a front photo is picked, distinct from the
  // Tripo generation flow's abortControllerRef since this request has its
  // own independent lifecycle (can be superseded by re-picking the front
  // photo at any time, long before "Generate" is ever clicked).
  const [classifyingType, setClassifyingType] = useState(false);
  const classifyAbortRef = useRef<AbortController | null>(null);

  // PRD 4.2 "My Collections" — lets a new item be filed straight into a
  // collection at creation time instead of only via the Home screen's
  // per-item picker afterward. '' means "Uncategorized" (mirrors
  // moveItemToCollection's null convention, just as a string sentinel since
  // <select> values are always strings).
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [savingCollection, setSavingCollection] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);

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

  // "Scan Item" capture wizard — walks through SLOTS one at a time instead
  // of showing all 4 as a static grid. `wizardIndex === SLOTS.length` means
  // every step has been passed through (captured or skipped) and the rest
  // of the page (item details, generate) is shown. Only `front` is
  // required to advance; left/back/right can be skipped — Tripo's 2-photo
  // floor is enforced downstream by the existing hasMinPhotos warning, not
  // re-implemented here.
  const [wizardIndex, setWizardIndex] = useState(0);
  const wizardCameraInputRef = useRef<HTMLInputElement>(null);
  const wizardLibraryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Revoke every still-live preview URL on unmount — object URLs otherwise
    // leak for the lifetime of the page/tab.
    return () => {
      Object.values(photoPreviewsRef.current).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
      classifyAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getCollections(user.uid)
      .then((data) => {
        if (!cancelled) setCollections(data);
      })
      .catch((err) => {
        if (!cancelled) setCollectionsError(err instanceof Error ? err.message : 'Failed to load collections');
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleCreateCollectionInline() {
    const name = newCollectionName.trim();
    if (!name) return;
    setSavingCollection(true);
    setCollectionsError(null);
    try {
      const created = await createCollection(user.uid, name);
      setCollections((prev) => [...prev, created]);
      setSelectedCollectionId(created.id);
      setNewCollectionName('');
      setCreatingCollection(false);
    } catch (err) {
      setCollectionsError(err instanceof Error ? err.message : 'Failed to create collection');
    } finally {
      setSavingCollection(false);
    }
  }

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

    if (slot === 'front') {
      // Superseding the front photo (re-picking or clearing it) invalidates
      // whatever classification request was already in flight for the old
      // photo — abort it so a slow, stale response can't land after a newer
      // one, and so a cleared photo doesn't leave a spinner running forever.
      classifyAbortRef.current?.abort();
      classifyAbortRef.current = null;
      setClassifyingType(false);

      if (file) {
        const controller = new AbortController();
        classifyAbortRef.current = controller;
        setClassifyingType(true);
        classifyItemType(file, controller.signal)
          .then((type) => {
            // Best-effort pre-fill only — never clobber a type the user has
            // already typed themselves (matches the PRD requirement that
            // this is a suggestion, always still manually editable/overridable
            // via this form or later via Item Detail's Edit flow).
            setMetadata((prev) => (prev.type.trim() ? prev : { ...prev, type }));
          })
          .catch((err) => {
            if (isAbortError(err)) return;
            console.warn('Item type auto-classification failed, leaving Type blank for manual entry:', err);
          })
          .finally(() => {
            if (classifyAbortRef.current === controller) {
              classifyAbortRef.current = null;
              setClassifyingType(false);
            }
          });
      }
    }
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

      await saveItem(user.uid, photoFiles, modelBlob, trimmedMetadata, setSaveStage, stickerBlob, selectedCollectionId || null);
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

  if (wizardIndex < SLOTS.length) {
    const slot = SLOTS[wizardIndex];
    const preview = photoPreviews[slot];
    const isRequired = slot === 'front';
    const copy = WIZARD_COPY[slot];

    return (
      <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', boxSizing: 'border-box', ...pageBackground, padding: '24px 16px 40px', color: FG }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          {wizardIndex > 0 ? (
            <button
              onClick={() => setWizardIndex((i) => i - 1)}
              aria-label="Back"
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: 'none',
                background: SURFACE,
                boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                cursor: 'pointer',
                fontSize: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              ‹
            </button>
          ) : (
            <div style={{ width: 36, flexShrink: 0 }} />
          )}
          <h1 style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: 700, margin: 0 }}>{copy.title}</h1>
          <div style={{ width: 36, flexShrink: 0 }} />
        </div>

        {/* Same tap-to-retake convention as the rest of the app — tapping
            the box (empty or already filled) reopens the camera-preferring
            input. The dotted background approximates the design mockup's
            scan-target grid via a small repeating radial-gradient. */}
        <button
          type="button"
          onClick={() => wizardCameraInputRef.current?.click()}
          style={{
            display: 'block',
            width: '100%',
            aspectRatio: '1',
            borderRadius: 20,
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            overflow: 'hidden',
            ...dotsBackground(),
          }}
        >
          {preview ? (
            <img src={preview} alt={`${slot} preview`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: MUTED }}>
              <span style={{ fontSize: 32 }}>📷</span>
              <span style={{ fontSize: 12 }}>Tap to scan</span>
            </div>
          )}
        </button>

        <input
          ref={wizardCameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => {
            handlePhotoChange(slot, e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={wizardLibraryInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            handlePhotoChange(slot, e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 650, margin: '24px 0 8px', lineHeight: 1.1 }}>{copy.heading}</h2>
        <p style={{ fontSize: 14, color: MUTED, margin: '0 0 24px' }}>{copy.subtitle}</p>

        <button
          onClick={() => {
            if (preview) setWizardIndex((i) => i + 1);
            else wizardCameraInputRef.current?.click();
          }}
          style={{ width: '100%', padding: '14px', borderRadius: 16, border: 'none', background: ACCENT, color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
        >
          {preview ? 'Continue' : 'Take Photo'}
        </button>
        <button
          onClick={() => wizardLibraryInputRef.current?.click()}
          style={{ width: '100%', padding: '14px', borderRadius: 16, border: '1px solid ' + BORDER, background: SURFACE, color: FG, fontWeight: 700, fontSize: 15, cursor: 'pointer', marginTop: 10 }}
        >
          Choose from Photo Library
        </button>

        {isRequired ? (
          <button
            onClick={() => wizardLibraryInputRef.current?.click()}
            style={{ display: 'block', margin: '16px auto 0', background: 'none', border: 'none', color: MUTED, fontSize: 13, textDecoration: 'underline', cursor: 'pointer' }}
          >
            Camera not working?
          </button>
        ) : (
          !preview && (
            <button
              onClick={() => setWizardIndex((i) => i + 1)}
              style={{ display: 'block', margin: '16px auto 0', background: 'none', border: 'none', color: MUTED, fontSize: 13, textDecoration: 'underline', cursor: 'pointer' }}
            >
              Skip this angle
            </button>
          )
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', minHeight: '100vh', boxSizing: 'border-box', ...pageBackground, padding: '24px 16px 40px', color: FG }}>
      <button
        onClick={() => setWizardIndex(0)}
        style={{ background: 'none', border: 'none', color: MUTED, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }}
      >
        ‹ Retake photos
      </button>

      {!hasFront && (
        <p style={{ color: '#c07a1e', fontSize: 12, marginBottom: 8 }}>Front photo is required to generate a model.</p>
      )}
      {hasFront && !hasMinPhotos && (
        <p style={{ color: '#c07a1e', fontSize: 12, marginBottom: 8 }}>
          At least 1 more angle (left/back/right) is required — Tripo needs 2+ photos to build a 3D model.
        </p>
      )}
      {hasFront && hasMinPhotos && photoCount < 4 && (
        <p style={{ color: MUTED, fontSize: 12, marginBottom: 8 }}>
          Tip: adding more angles improves model quality, though you have enough to generate now.
        </p>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>Item details</h2>
      {classifyingType && (
        <p style={{ color: MUTED, fontSize: 12, marginBottom: 4 }}>AI is identifying this item…</p>
      )}
      <ItemMetadataForm value={metadata} onChange={setMetadata} nameRequired />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 12, color: MUTED }}>
        <label htmlFor="new-item-collection-select">Collection:</label>
        <select
          id="new-item-collection-select"
          value={selectedCollectionId}
          onChange={(e) => setSelectedCollectionId(e.target.value)}
          disabled={isGenerating}
          style={{ fontSize: 12 }}
        >
          <option value="">Uncategorized</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {creatingCollection ? (
          <>
            <input
              autoFocus
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateCollectionInline();
                if (e.key === 'Escape') {
                  setCreatingCollection(false);
                  setNewCollectionName('');
                }
              }}
              placeholder="Collection name"
              style={{ fontSize: 12, padding: '4px 8px', width: 120 }}
              disabled={savingCollection}
            />
            <button onClick={handleCreateCollectionInline} disabled={savingCollection || !newCollectionName.trim()} style={{ fontSize: 12 }}>
              {savingCollection ? '…' : 'Add'}
            </button>
            <button
              onClick={() => {
                setCreatingCollection(false);
                setNewCollectionName('');
              }}
              disabled={savingCollection}
              style={{ fontSize: 12 }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button onClick={() => setCreatingCollection(true)} disabled={isGenerating} style={{ fontSize: 12 }}>
            + New Collection
          </button>
        )}
      </div>
      {collectionsError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 4 }}>{collectionsError}</p>}

      {!hasName && (
        <p style={{ color: '#c07a1e', fontSize: 12, marginTop: 8 }}>Item name is required to generate a model.</p>
      )}

      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        style={{
          width: '100%',
          marginTop: 16,
          padding: '14px',
          borderRadius: 16,
          border: 'none',
          background: canGenerate ? ACCENT : BORDER,
          color: canGenerate ? '#fff' : MUTED,
          fontWeight: 700,
          fontSize: 15,
          cursor: canGenerate ? 'pointer' : 'default',
        }}
      >
        Generate 3D Model
      </button>

      {(status === 'uploading' || status === 'generating') && (
        <div style={{ marginTop: 12 }}>
          <p style={{ marginBottom: 4 }}>
            {status === 'uploading' ? 'Uploading photos…' : `Generating… ${progress}%`}
            {attempt > 1 && (
              <span style={{ color: '#c07a1e' }}> (retry {attempt - 1}/{MAX_GENERATE_ATTEMPTS - 1})</span>
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
