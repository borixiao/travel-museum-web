import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { getItems } from '../services/items';
import { getOrCreateMoodboard, saveMoodboardCards, setMoodboardPublished, setMoodboardTitle } from '../services/moodboard';
import MoodboardCanvas from '../components/MoodboardCanvas';
import MoodboardCardDetailModal from '../components/MoodboardCardDetailModal';
import type { Item, Moodboard, MoodboardCard } from '../types';

// Items are laid onto a loose 4-column grid when first added (before the
// user drags them anywhere) just so multiple adds don't all stack exactly
// on top of each other.
const GRID_COLS = 4;
const GRID_STEP_X = 22;
const GRID_STEP_Y = 26;

export default function MoodboardPage({ user }: { user: User }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [moodboard, setMoodboard] = useState<Moodboard | null>(null);
  const [cards, setCards] = useState<MoodboardCard[]>([]);
  const [title, setTitle] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [expandedCard, setExpandedCard] = useState<MoodboardCard | null>(null);

  // Mirrors `cards` so drag-end / blur handlers can read the latest value
  // synchronously without waiting on the next render (setState is async).
  const cardsRef = useRef<MoodboardCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getItems(user.uid), getOrCreateMoodboard(user.uid)])
      .then(([itemsData, board]) => {
        if (cancelled) return;
        setItems(itemsData);
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
  }, [user.uid]);

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

  function handleDragEnd() {
    if (!moodboard) return;
    saveMoodboardCards(moodboard.id, cardsRef.current).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to save layout');
    });
  }

  function nextGridSpot() {
    const count = cardsRef.current.length;
    const col = count % GRID_COLS;
    const row = Math.floor(count / GRID_COLS);
    return { x: 4 + col * GRID_STEP_X, y: 4 + row * GRID_STEP_Y };
  }

  function addItemCard(item: Item) {
    const { x, y } = nextGridSpot();
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
    const { x, y } = nextGridSpot();
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

  if (loading) return <p style={{ textAlign: 'center', marginTop: 40 }}>Loading moodboard…</p>;
  if (error) return <p style={{ textAlign: 'center', marginTop: 40, color: 'crimson' }}>{error}</p>;
  if (!moodboard) return null;

  return (
    <div style={{ maxWidth: 720, margin: '24px auto', padding: '0 16px' }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={handleTitleBlur}
        style={{
          fontSize: 20,
          fontWeight: 600,
          border: 'none',
          borderBottom: '1px solid #444',
          background: 'transparent',
          color: 'inherit',
          width: '100%',
          padding: '4px 0',
        }}
      />
      <p style={{ color: '#888', fontSize: 12, marginTop: 6 }}>
        Curate items into a shareable exhibition board — drag cards to arrange them, then publish a link visitors can view without logging in.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <button onClick={addTextCard}>+ Add text</button>
        <button onClick={handleTogglePublish} disabled={publishing}>
          {publishing ? 'Saving…' : moodboard.published ? 'Unpublish' : 'Publish'}
        </button>
        {moodboard.published && <button onClick={handleCopyLink}>Copy public link</button>}
      </div>
      {copyMessage && <p style={{ fontSize: 12, color: '#6ea8ff', wordBreak: 'break-all' }}>{copyMessage}</p>}

      <MoodboardCanvas
        cards={cards}
        editable
        onMove={handleMove}
        onDragEnd={handleDragEnd}
        onRemove={removeCard}
        onTextChange={handleTextChange}
        onTextBlur={handleTextBlur}
        onExpand={setExpandedCard}
      />
      {expandedCard && <MoodboardCardDetailModal card={expandedCard} onClose={() => setExpandedCard(null)} />}

      <h2 style={{ fontSize: 14, marginTop: 20 }}>Your items — tap to add to the board</h2>
      {items.length === 0 ? (
        <p style={{ color: '#888', fontSize: 12 }}>No saved items yet — add some from the "Add Item" tab first.</p>
      ) : (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => addItemCard(item)}
              style={{
                flexShrink: 0,
                width: 84,
                border: '1px solid #444',
                borderRadius: 6,
                padding: 0,
                overflow: 'hidden',
                cursor: 'pointer',
                background: 'none',
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
                <div style={{ width: '100%', height: 64, background: '#333' }} />
              )}
              <div style={{ fontSize: 10, color: '#ddd', padding: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.name || 'Untitled'}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
