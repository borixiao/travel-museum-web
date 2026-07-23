import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { getItems, updateItemMetadata, updateItemSticker, deleteItem } from '../services/items';
import { getOrCreateUserProfile } from '../services/users';
import { modelProxyUrl } from '../services/tripoClient';
import { generateStickerFromUrl } from '../services/stickerClient';
import { addItemToMoodboard } from '../services/moodboard';
import ModelViewer from '../components/ModelViewer';
import PhotoGallery from '../components/PhotoGallery';
import ItemMetadataForm, { emptyItemMetadata } from '../components/ItemMetadataForm';
import type { Item, ItemMetadata } from '../types';

function metadataOf(item: Item): ItemMetadata {
  return {
    name: item.name ?? emptyItemMetadata.name,
    type: item.type ?? emptyItemMetadata.type,
    location: item.location ?? emptyItemMetadata.location,
    date: item.date ?? emptyItemMetadata.date,
    story: item.story ?? emptyItemMetadata.story,
    emotionTags: item.emotionTags ?? emptyItemMetadata.emotionTags,
  };
}

export default function HomePage({ user }: { user: User }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState<ItemMetadata>(emptyItemMetadata);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [generatingSticker, setGeneratingSticker] = useState(false);
  const [stickerError, setStickerError] = useState<string | null>(null);
  // PRD 4.5 "Add to Moodboard" action from Item Detail — `addedToMoodboard`
  // is a transient confirmation flag, cleared on the next selectItem() so it
  // never leaks onto a different item.
  const [addingToMoodboard, setAddingToMoodboard] = useState(false);
  const [moodboardError, setMoodboardError] = useState<string | null>(null);
  const [addedToMoodboard, setAddedToMoodboard] = useState(false);
  // PRD 4.2 "Welcome message with user name" — undefined while loading (so we
  // don't flash a placeholder), null if the profile fetch itself failed
  // (non-fatal: the rest of the page still works without it).
  const [displayName, setDisplayName] = useState<string | null | undefined>(undefined);
  // Same best-effort profile fetch as displayName above — shown next to the
  // welcome banner so the avatar set on the Profile page shows up here too.
  const [photoURL, setPhotoURL] = useState<string | null>(null);

  // PRD 4.6 Collection Screen — search / filter / sort. All client-side: the
  // whole collection is already fetched in one shot (getItems has no
  // pagination), so there's no reason to round-trip to Firestore again just
  // to re-slice data already sitting in `items`.
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'location' | 'type'>('newest');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getItems(user.uid)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load items');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    getOrCreateUserProfile(user)
      .then((profile) => {
        if (!cancelled) {
          setDisplayName(profile.displayName);
          setPhotoURL(profile.photoURL ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setDisplayName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Filter tabs derived from whatever `type` values actually exist in this
  // user's collection, rather than PRD's hardcoded Tickets/Magnets/Postcards/
  // Other — the app's Type field is free text (ITEM_TYPE_PRESETS are just
  // suggestions, see types.ts), so a fixed 4-tab set would either miss most
  // real values or bucket everything into "Other".
  const typeOptions = useMemo(() => {
    const seen = new Set<string>();
    items.forEach((item) => {
      if (item.type) seen.add(item.type);
    });
    return ['All', ...Array.from(seen).sort((a, b) => a.localeCompare(b))];
  }, [items]);

  // PRD 4.2 "Recent items rail (latest 4, horizontal scroll)" — deliberately
  // independent of the search/filter/sort controls below (those apply to the
  // full Collection grid); this always shows the true most-recently-added 4,
  // sourced straight from `items`, which Firestore already returns newest
  // first (see displayedItems' 'oldest' comment below).
  const recentItems = useMemo(() => items.slice(0, 4), [items]);

  const displayedItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = items.filter((item) => {
      if (filterType !== 'All' && item.type !== filterType) return false;
      if (!q) return true;
      return (
        (item.name ?? '').toLowerCase().includes(q) ||
        (item.location ?? '').toLowerCase().includes(q) ||
        (item.type ?? '').toLowerCase().includes(q)
      );
    });

    if (sortBy === 'oldest') {
      // `items` already arrives newest-first (Firestore query orders by
      // createdAt desc) — reversing the already-filtered array is enough,
      // no need to parse the Firestore Timestamp in `createdAt` at all.
      result = [...result].reverse();
    } else if (sortBy === 'location') {
      result = [...result].sort((a, b) => (a.location ?? '').localeCompare(b.location ?? ''));
    } else if (sortBy === 'type') {
      result = [...result].sort((a, b) => (a.type ?? '').localeCompare(b.type ?? ''));
    }
    // 'newest' needs no resort — that's the order `items` is already in.
    return result;
  }, [items, searchQuery, filterType, sortBy]);

  function selectItem(item: Item | null) {
    setSelected(item);
    setEditing(false);
    setEditError(null);
    setDeleteError(null);
    setStickerError(null);
    setMoodboardError(null);
    setAddedToMoodboard(false);
  }

  async function handleGenerateSticker() {
    if (!selected || !selected.photos?.[0]) return;
    setGeneratingSticker(true);
    setStickerError(null);
    try {
      const blob = await generateStickerFromUrl(selected.photos[0], selected.name ?? '', selected.type ?? '');
      const stickerUrl = await updateItemSticker(selected, blob);
      const updated = { ...selected, stickerUrl };
      setSelected(updated);
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    } catch (err) {
      setStickerError(err instanceof Error ? err.message : 'Failed to generate AI sticker');
    } finally {
      setGeneratingSticker(false);
    }
  }

  async function handleAddToMoodboard() {
    if (!selected) return;
    setAddingToMoodboard(true);
    setMoodboardError(null);
    try {
      await addItemToMoodboard(user.uid, selected);
      setAddedToMoodboard(true);
    } catch (err) {
      setMoodboardError(err instanceof Error ? err.message : 'Failed to add to moodboard');
    } finally {
      setAddingToMoodboard(false);
    }
  }

  function startEdit() {
    if (!selected) return;
    setEditValue(metadataOf(selected));
    setEditError(null);
    setEditing(true);
  }

  async function handleSaveEdit() {
    if (!selected) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const trimmed: ItemMetadata = {
        ...editValue,
        name: editValue.name.trim(),
        // Custom type left blank (e.g. user picked "Custom…" then didn't type
        // anything) falls back to "Other" rather than saving an empty type.
        type: editValue.type.trim() || 'Other',
        location: editValue.location.trim(),
        story: editValue.story.trim(),
      };
      await updateItemMetadata(selected.id, trimmed);
      const updated = { ...selected, ...trimmed };
      setSelected(updated);
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    // PRD 4.5: "Delete: remove item (with confirmation)".
    const ok = window.confirm(
      `Delete "${selected.name || 'Untitled item'}"? This removes its photos and 3D model permanently and can't be undone.`
    );
    if (!ok) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteItem(selected);
      setItems((prev) => prev.filter((it) => it.id !== selected.id));
      selectItem(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete item');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: 40 }}>Loading your collection…</p>;
  if (error) return <p style={{ textAlign: 'center', marginTop: 40, color: 'crimson' }}>{error}</p>;

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px' }}>
      {displayName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          {photoURL && (
            <img
              src={photoURL}
              alt=""
              style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
            />
          )}
          <p style={{ color: '#888', fontSize: 13, margin: 0 }}>Welcome back, {displayName}</p>
        </div>
      )}
      <h1 style={{ fontSize: 20 }}>My Collection</h1>

      {items.length === 0 && <p style={{ color: '#888' }}>No saved 3D models yet.</p>}

      {!selected && recentItems.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 13, color: '#888', margin: '0 0 6px' }}>Recent items</h2>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {recentItems.map((item) => (
              <button
                key={item.id}
                onClick={() => selectItem(item)}
                style={{
                  flexShrink: 0,
                  width: 96,
                  border: '1px solid #444',
                  borderRadius: 8,
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
                    alt="item thumbnail"
                    style={{ width: '100%', height: 72, objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div style={{ width: '100%', height: 72, background: '#333' }} />
                )}
                <div
                  style={{
                    fontSize: 11,
                    color: '#ddd',
                    padding: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.name || 'Untitled item'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!selected && items.length > 0 && (
        <div style={{ marginTop: 12, marginBottom: 12 }}>
          <input
            type="search"
            placeholder="Search by name, location, or type…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px' }}
          />

          {typeOptions.length > 1 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 8, paddingBottom: 4 }}>
              {typeOptions.map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  style={{
                    flexShrink: 0,
                    fontSize: 12,
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: '1px solid ' + (filterType === t ? '#6ea8ff' : '#444'),
                    background: filterType === t ? 'rgba(110, 168, 255, 0.15)' : 'none',
                    color: filterType === t ? '#6ea8ff' : '#ccc',
                    cursor: 'pointer',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12 }}>
            <label htmlFor="sort-select" style={{ color: '#888' }}>
              Sort:
            </label>
            <select
              id="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              style={{ fontSize: 12 }}
            >
              <option value="newest">Date (newest first)</option>
              <option value="oldest">Date (oldest first)</option>
              <option value="location">Location (A–Z)</option>
              <option value="type">Type (A–Z)</option>
            </select>
          </div>
        </div>
      )}

      {selected ? (
        <div>
          <button onClick={() => selectItem(null)} style={{ marginBottom: 12 }}>
            ← Back to list
          </button>

          {editing ? (
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, marginBottom: 8 }}>Edit item details</h2>
              <ItemMetadataForm value={editValue} onChange={setEditValue} />
              {editError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 8 }}>{editError}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={handleSaveEdit} disabled={savingEdit}>
                  {savingEdit ? 'Saving…' : 'Save changes'}
                </button>
                <button onClick={() => setEditing(false)} disabled={savingEdit}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <h2 style={{ fontSize: 18, margin: 0 }}>{selected.name || 'Untitled item'}</h2>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button onClick={startEdit} disabled={deleting}>
                    Edit
                  </button>
                  {selected.photos?.[0] && (
                    <button onClick={handleGenerateSticker} disabled={generatingSticker || deleting}>
                      {generatingSticker ? 'Generating…' : selected.stickerUrl ? 'Regenerate AI Sticker' : 'Generate AI Sticker'}
                    </button>
                  )}
                  <button onClick={handleAddToMoodboard} disabled={addingToMoodboard || deleting}>
                    {addingToMoodboard ? 'Adding…' : addedToMoodboard ? 'Added ✓' : 'Add to Moodboard'}
                  </button>
                  <button onClick={handleDelete} disabled={deleting} style={{ color: '#e05555' }}>
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
              {deleteError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 8 }}>{deleteError}</p>}
              {stickerError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 8 }}>{stickerError}</p>}
              {moodboardError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 8 }}>{moodboardError}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: '#888' }}>
                {selected.type && (
                  <span style={{ border: '1px solid #555', borderRadius: 999, padding: '2px 8px' }}>{selected.type}</span>
                )}
                {selected.location && <span>📍 {selected.location}</span>}
                {selected.date && <span>📅 {selected.date}</span>}
              </div>
              {selected.emotionTags && selected.emotionTags.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {selected.emotionTags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 12,
                        color: '#6ea8ff',
                        border: '1px solid #6ea8ff',
                        borderRadius: 999,
                        padding: '2px 10px',
                        background: 'rgba(110, 168, 255, 0.15)',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {selected.story && <p style={{ marginTop: 8, fontSize: 13, color: '#aaa' }}>{selected.story}</p>}
            </div>
          )}

          {selected.photos && selected.photos.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 14, marginBottom: 6 }}>Original photos</h2>
              <PhotoGallery photos={selected.photos} />
            </div>
          )}

          <ModelViewer
            url={modelProxyUrl(selected.modelUrl)}
            fallbackMessage="This 3D model is no longer available. Please retake photos and regenerate."
          />
        </div>
      ) : displayedItems.length === 0 && items.length > 0 ? (
        <p style={{ color: '#888', fontSize: 13 }}>No items match your search/filter.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {displayedItems.map((item) => (
            <button
              key={item.id}
              onClick={() => selectItem(item)}
              style={{
                border: '1px solid #444',
                borderRadius: 8,
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
                  alt="item thumbnail"
                  style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', height: 120, background: '#333' }} />
              )}
              <div style={{ padding: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name || 'Untitled item'}
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {item.type ?? 'Click to view 3D model'}
                  {item.location ? ` · ${item.location}` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
