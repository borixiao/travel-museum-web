import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { getItems } from '../services/items';
import {
  DEFAULT_MOODBOARD_BACKGROUND,
  clearMoodboardBackgroundImage,
  getOrCreateMoodboard,
  nextMoodboardCardPosition,
  saveMoodboardCards,
  setMoodboardBackgroundColor,
  setMoodboardBackgroundImage,
  setMoodboardPublished,
  setMoodboardTitle,
} from '../services/moodboard';
import MoodboardCanvas from '../components/MoodboardCanvas';
import MoodboardCardDetailModal from '../components/MoodboardCardDetailModal';
import Icon from '../components/Icon';
import type { Item, Moodboard, MoodboardCard } from '../types';
import { SURFACE, FG, MUTED, BORDER, pageBackground, actionButtonStyle, FONT_DISPLAY } from '../theme';

export default function MoodboardPage({
  user,
  collectionId,
  collectionName,
  onBack,
}: {
  user: User;
  /** Which Collection's canvas to show — `null` is the Uncategorized
   *  bucket's canvas. A canvas is a Collection's property now (see
   *  services/moodboard.ts), not a single board shared across everything. */
  collectionId: string | null;
  collectionName: string;
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [moodboard, setMoodboard] = useState<Moodboard | null>(null);
  const [cards, setCards] = useState<MoodboardCard[]>([]);
  const [title, setTitle] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [expandedCard, setExpandedCard] = useState<MoodboardCard | null>(null);
  const [savingBackgroundImage, setSavingBackgroundImage] = useState(false);
  const [backgroundImageError, setBackgroundImageError] = useState<string | null>(null);

  // Mirrors `cards` so drag-end / blur handlers can read the latest value
  // synchronously without waiting on the next render (setState is async).
  const cardsRef = useRef<MoodboardCard[]>([]);
  // Debounces the background-color Firestore write — see handleBackgroundColorChange.
  const bgColorSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getItems(user.uid), getOrCreateMoodboard(user.uid, collectionId)])
      .then(([itemsData, board]) => {
        if (cancelled) return;
        // Only this collection's own items make sense to add to its canvas
        // — matches how Home's collection rows already scope items.
        setItems(itemsData.filter((it) => (it.collectionId ?? null) === collectionId));
        setMoodboard(board);
        setCards(board.cards);
        cardsRef.current = board.cards;
        setTitle(board.title);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load moodboard');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user.uid, collectionId]);

  // Central place to change `cards`: updates local state + the ref together,
  // and (unless save:false) persists the whole array to Firestore. Dragging
  // calls this with save:false on every pointer-move and saves once on
  // pointer-up instead, so a drag doesn't spam writes.
  function updateCards(updater: (prev: MoodboardCard[]) => MoodboardCard[], opts?: { save?: boolean }) {
    setCards((prev) => {
      const next = updater(prev);
      cardsRef.current = next;
      if (opts?.save !== false && moodboard) {
        saveMoodboardCards(moodboard.id, next).catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to save layout');
        });
      }
      return next;
    });
  }

  function handleMove(id: string, x: number, y: number) {
    updateCards((prev) => prev.map((c) => (c.id === id ? { ...c, x, y } : c)), { save: false });
  }

  function handleRotate(id: string, rotation: number) {
    updateCards((prev) => prev.map((c) => (c.id === id ? { ...c, rotation } : c)), { save: false });
  }

  function handleResize(id: string, w: number) {
    updateCards((prev) => prev.map((c) => (c.id === id ? { ...c, w } : c)), { save: false });
  }

  // Discrete click (not a drag gesture), so this saves immediately like
  // addItemCard/removeCard rather than deferring to a drag-end handler.
  function handleToggleDisplayMode(id: string) {
    updateCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, displayMode: c.displayMode === 'model' ? 'sticker' : 'model' } : c)),
    );
  }

  // Fires once at the end of a move or rotate gesture that actually changed
  // something (MoodboardCanvas only calls this when a drag crossed the tap
  // threshold, or on any rotate release). Bringing the just-touched card to
  // the end of `cards` (= rendered on top, since cards are absolutely
  // positioned in array order) is what makes deliberate overlap possible —
  // "the thing I'm arranging right now should come out on top", the same
  // way picking something up off a real corkboard and re-pinning it does.
  function handleDragEnd(id?: string) {
    if (!moodboard) return;
    let next = cardsRef.current;
    if (id) {
      const idx = next.findIndex((c) => c.id === id);
      if (idx !== -1 && idx !== next.length - 1) {
        const reordered = [...next];
        const [card] = reordered.splice(idx, 1);
        reordered.push(card);
        next = reordered;
        cardsRef.current = next;
        setCards(next);
      }
    }
    saveMoodboardCards(moodboard.id, next).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to save layout');
    });
  }

  function addItemCard(item: Item) {
    const { x, y } = nextMoodboardCardPosition(cardsRef.current.length);
    const newCard: MoodboardCard = {
      id: crypto.randomUUID(),
      type: 'item',
      itemId: item.id,
      name: item.name || 'Untitled item',
      // Prefer the AI sticker for the curated exhibition look; fall back to
      // the real photo for items that don't have one (generation failed, or
      // saved before the feature existed).
      photoUrl: item.stickerUrl ?? item.photos?.[0],
      modelUrl: item.modelUrl,
      itemType: item.type,
      location: item.location,
      date: item.date,
      story: item.story,
      emotionTags: item.emotionTags,
      x,
      y,
      w: 18,
      rotation: 0,
    };
    updateCards((prev) => [...prev, newCard]);
  }

  function addTextCard() {
    const { x, y } = nextMoodboardCardPosition(cardsRef.current.length);
    const newCard: MoodboardCard = {
      id: crypto.randomUUID(),
      type: 'text',
      text: 'New note',
      x,
      y,
      w: 20,
      rotation: 0,
    };
    updateCards((prev) => [...prev, newCard]);
  }

  function removeCard(id: string) {
    updateCards((prev) => prev.filter((c) => c.id !== id));
  }

  function handleTextChange(id: string, text: string) {
    updateCards((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)), { save: false });
  }

  function handleTextBlur() {
    if (!moodboard) return;
    saveMoodboardCards(moodboard.id, cardsRef.current).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to save text');
    });
  }

  function handleTitleBlur() {
    if (!moodboard) return;
    const trimmed = title.trim() || 'My Exhibition';
    setTitle(trimmed);
    if (trimmed === moodboard.title) return;
    setMoodboardTitle(moodboard.id, trimmed)
      .then(() => setMoodboard((m) => (m ? { ...m, title: trimmed } : m)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to save title'));
  }

  async function handleTogglePublish() {
    if (!moodboard) return;
    setPublishing(true);
    try {
      const next = !moodboard.published;
      await setMoodboardPublished(moodboard.id, next);
      setMoodboard({ ...moodboard, published: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update publish status');
    } finally {
      setPublishing(false);
    }
  }

  function handleBackgroundColorChange(color: string) {
    if (!moodboard) return;
    // Optimistic + local first so the canvas preview updates instantly as
    // the user drags inside the native color picker.
    setMoodboard((m) => (m ? { ...m, backgroundColor: color } : m));
    // Same "don't spam writes during continuous interaction" concern as
    // card dragging (see updateCards's save:false) — a native color input
    // can fire many onChange events while the picker is being dragged, so
    // debounce the actual Firestore write instead of saving every one.
    if (bgColorSaveTimeout.current) clearTimeout(bgColorSaveTimeout.current);
    const moodboardId = moodboard.id;
    bgColorSaveTimeout.current = setTimeout(() => {
      setMoodboardBackgroundColor(moodboardId, color).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to save background color');
      });
    }, 400);
  }

  async function handleBackgroundImageChange(file: File | undefined) {
    if (!moodboard || !file) return;
    setSavingBackgroundImage(true);
    setBackgroundImageError(null);
    try {
      const backgroundImageUrl = await setMoodboardBackgroundImage(user.uid, moodboard.id, file);
      setMoodboard((m) => (m ? { ...m, backgroundImageUrl } : m));
    } catch (err) {
      setBackgroundImageError(err instanceof Error ? err.message : 'Failed to upload background image');
    } finally {
      setSavingBackgroundImage(false);
    }
  }

  async function handleRemoveBackgroundImage() {
    if (!moodboard) return;
    setSavingBackgroundImage(true);
    setBackgroundImageError(null);
    try {
      await clearMoodboardBackgroundImage(user.uid, moodboard.id);
      setMoodboard((m) => (m ? { ...m, backgroundImageUrl: undefined } : m));
    } catch (err) {
      setBackgroundImageError(err instanceof Error ? err.message : 'Failed to remove background image');
    } finally {
      setSavingBackgroundImage(false);
    }
  }

  function handleCopyLink() {
    if (!moodboard) return;
    const url = `${window.location.origin}/m/${moodboard.id}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopyMessage('Link copied: ' + url);
        setTimeout(() => setCopyMessage(null), 4000);
      })
      .catch(() => setCopyMessage(url));
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: 40 }}>Loading canvas…</p>;
  if (error) return <p style={{ textAlign: 'center', marginTop: 40, color: 'crimson' }}>{error}</p>;
  if (!moodboard) return null;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', minHeight: '100vh', boxSizing: 'border-box', ...pageBackground, padding: '24px 18px 40px', color: FG }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <button
          onClick={onBack}
          aria-label="Back"
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: 'none',
            background: SURFACE,
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon name="back" size={18} />
        </button>
        <h1 style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 600, margin: 0, marginRight: 36, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          {collectionName}'s Canvas
        </h1>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={handleTitleBlur}
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 26,
          fontWeight: 650,
          border: 'none',
          background: 'transparent',
          color: FG,
          width: '100%',
          padding: '4px 0',
        }}
      />
      <p style={{ color: MUTED, fontSize: 13, marginTop: 2 }}>
        Curate items into a shareable exhibition board — drag cards to arrange them, then publish a link visitors can view without logging in.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '14px 0' }}>
        <button onClick={addTextCard} style={actionButtonStyle('secondary')}>
          + Add text
        </button>
        <button onClick={handleTogglePublish} disabled={publishing} style={actionButtonStyle('primary', publishing)}>
          {publishing ? 'Saving…' : moodboard.published ? 'Unpublish' : 'Publish'}
        </button>
        {moodboard.published && (
          <button onClick={handleCopyLink} style={actionButtonStyle('secondary')}>
            Copy public link
          </button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED }}>
          Background
          <input
            type="color"
            value={moodboard.backgroundColor ?? DEFAULT_MOODBOARD_BACKGROUND}
            onChange={(e) => handleBackgroundColorChange(e.target.value)}
            style={{ width: 28, height: 28, padding: 0, border: '1px solid ' + BORDER, borderRadius: 6, background: 'none', cursor: 'pointer' }}
          />
        </label>
        <label style={{ fontSize: 12, color: MUTED, textDecoration: 'underline', cursor: savingBackgroundImage ? 'default' : 'pointer' }}>
          {savingBackgroundImage ? 'Saving…' : moodboard.backgroundImageUrl ? 'Change image' : 'Upload background image'}
          <input
            type="file"
            accept="image/*"
            disabled={savingBackgroundImage}
            style={{ display: 'none' }}
            onChange={(e) => {
              handleBackgroundImageChange(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {moodboard.backgroundImageUrl && (
          <button
            onClick={handleRemoveBackgroundImage}
            disabled={savingBackgroundImage}
            style={{ fontSize: 12, color: MUTED, textDecoration: 'underline', background: 'none', border: 'none', cursor: savingBackgroundImage ? 'default' : 'pointer', padding: 0 }}
          >
            Remove image
          </button>
        )}
      </div>
      {backgroundImageError && <p style={{ fontSize: 12, color: 'crimson' }}>{backgroundImageError}</p>}
      {copyMessage && <p style={{ fontSize: 12, color: FG, wordBreak: 'break-all' }}>{copyMessage}</p>}

      <MoodboardCanvas
        cards={cards}
        backgroundColor={moodboard.backgroundColor}
        backgroundImageUrl={moodboard.backgroundImageUrl}
        editable
        onMove={handleMove}
        onDragEnd={handleDragEnd}
        onRemove={removeCard}
        onTextChange={handleTextChange}
        onTextBlur={handleTextBlur}
        onExpand={setExpandedCard}
        onRotate={handleRotate}
        onResize={handleResize}
        onToggleDisplayMode={handleToggleDisplayMode}
      />
      {expandedCard && <MoodboardCardDetailModal card={expandedCard} onClose={() => setExpandedCard(null)} />}

      <h2 style={{ fontSize: 14, marginTop: 20, color: FG }}>Items in this memory — tap to add to the canvas</h2>
      {items.length === 0 ? (
        <p style={{ color: MUTED, fontSize: 12 }}>No items in this memory yet — scan one from Home first.</p>
      ) : (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => addItemCard(item)}
              style={{
                flexShrink: 0,
                width: 84,
                border: '1px solid ' + BORDER,
                borderRadius: 10,
                padding: 0,
                overflow: 'hidden',
                cursor: 'pointer',
                background: SURFACE,
                textAlign: 'left',
              }}
            >
              {item.stickerUrl ?? item.photos?.[0] ? (
                <img
                  src={item.stickerUrl ?? item.photos![0]}
                  alt=""
                  style={{ width: '100%', height: 64, objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', height: 64, background: BORDER }} />
              )}
              <div style={{ fontSize: 10, color: FG, padding: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.name || 'Untitled'}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
