import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { User } from 'firebase/auth';
import {
  getItems,
  updateItemMetadata,
  updateItemSticker,
  setItemBackgroundImage,
  clearItemBackgroundImage,
  moveItemToCollection,
  deleteItem,
} from '../services/items';
import { getCollections, createCollection, deleteCollection } from '../services/collections';
import { getOrCreateUserProfile } from '../services/users';
import { modelProxyUrl } from '../services/tripoClient';
import { generateStickerFromUrl } from '../services/stickerClient';
import { addItemToMoodboard } from '../services/moodboard';
import ModelViewer from '../components/ModelViewer';
import PhotoGallery from '../components/PhotoGallery';
import ItemMetadataForm, { emptyItemMetadata } from '../components/ItemMetadataForm';
import type { Item, ItemMetadata, Collection } from '../types';

// Sentinels for the collection tab selector — never persisted, only used as
// the `selectedCollectionId` UI state's "no real collection selected" values.
const ALL_COLLECTIONS = '__all__';
const UNCATEGORIZED = '__uncategorized__';

// Light/warm palette for the browse view (hero, chips, item grid), matching
// the "Memory Museum" visual design mockup. Kept as plain constants (not a
// theme file) to match this codebase's existing inline-style convention —
// the Item Detail screen below is a separate PRD screen not covered by this
// pass and intentionally left in its prior styling.
const PAGE_BG = '#faf7f4';
const CARD_BG = '#ffffff';
const TEXT_PRIMARY = '#1c1917';
const TEXT_MUTED = '#8a8078';
const BORDER_LIGHT = '#e8e1d8';
const ACCENT = '#a1552e';
const PLACEHOLDER_BG = '#efe8df';

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

export default function HomePage({ user, onAddItem }: { user: User; onAddItem?: () => void }) {
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
  const [savingBackgroundImage, setSavingBackgroundImage] = useState(false);
  const [backgroundImageError, setBackgroundImageError] = useState<string | null>(null);
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

  // PRD 4.2 "My Collections" — named groupings the user creates to organize
  // items. `selectedCollectionId` is one of ALL_COLLECTIONS/UNCATEGORIZED or
  // a real Collection's id; kept separate from the §4.6 filter/sort state
  // below since a collection is a coarser, user-authored grouping rather
  // than a derived filter, but both narrow the same `items` array together.
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>(ALL_COLLECTIONS);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [savingCollection, setSavingCollection] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [movingItem, setMovingItem] = useState(false);

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
      if (selectedCollectionId === UNCATEGORIZED && item.collectionId) return false;
      if (
        selectedCollectionId !== ALL_COLLECTIONS &&
        selectedCollectionId !== UNCATEGORIZED &&
        item.collectionId !== selectedCollectionId
      ) {
        return false;
      }
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
  }, [items, searchQuery, filterType, sortBy, selectedCollectionId]);

  function selectItem(item: Item | null) {
    setSelected(item);
    setEditing(false);
    setEditError(null);
    setDeleteError(null);
    setStickerError(null);
    setMoodboardError(null);
    setAddedToMoodboard(false);
    setBackgroundImageError(null);
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

  async function handleBackgroundImageChange(file: File | undefined) {
    if (!selected || !file) return;
    setSavingBackgroundImage(true);
    setBackgroundImageError(null);
    try {
      const backgroundImageUrl = await setItemBackgroundImage(selected, file);
      const updated = { ...selected, backgroundImageUrl };
      setSelected(updated);
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    } catch (err) {
      setBackgroundImageError(err instanceof Error ? err.message : 'Failed to upload background image');
    } finally {
      setSavingBackgroundImage(false);
    }
  }

  async function handleRemoveBackgroundImage() {
    if (!selected) return;
    setSavingBackgroundImage(true);
    setBackgroundImageError(null);
    try {
      await clearItemBackgroundImage(selected);
      const updated = { ...selected, backgroundImageUrl: undefined };
      setSelected(updated);
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    } catch (err) {
      setBackgroundImageError(err instanceof Error ? err.message : 'Failed to remove background image');
    } finally {
      setSavingBackgroundImage(false);
    }
  }

  async function handleCreateCollection() {
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

  async function handleDeleteCollection(collectionToDelete: Collection) {
    // Deleting a collection only removes the label — member items are
    // reassigned to Uncategorized by deleteCollection(), not deleted.
    const ok = window.confirm(
      `Delete "${collectionToDelete.name}"? Items in it will move to Uncategorized, not be deleted.`
    );
    if (!ok) return;

    setCollectionsError(null);
    try {
      await deleteCollection(user.uid, collectionToDelete.id);
      setCollections((prev) => prev.filter((c) => c.id !== collectionToDelete.id));
      setItems((prev) =>
        prev.map((it) => (it.collectionId === collectionToDelete.id ? { ...it, collectionId: undefined } : it))
      );
      if (selectedCollectionId === collectionToDelete.id) setSelectedCollectionId(ALL_COLLECTIONS);
    } catch (err) {
      setCollectionsError(err instanceof Error ? err.message : 'Failed to delete collection');
    }
  }

  async function handleMoveSelectedItemToCollection(collectionId: string | null) {
    if (!selected) return;
    setMovingItem(true);
    setCollectionsError(null);
    try {
      await moveItemToCollection(selected.id, collectionId);
      const updated = { ...selected, collectionId: collectionId ?? undefined };
      setSelected(updated);
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    } catch (err) {
      setCollectionsError(err instanceof Error ? err.message : 'Failed to move item');
    } finally {
      setMovingItem(false);
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

  // Shared pill style for the collection/type filter chip rows below —
  // selected = solid dark fill, unselected = light outline — matching the
  // "Memory Museum" design mockup's chip treatment.
  function chipStyle(active: boolean): CSSProperties {
    return {
      flexShrink: 0,
      fontSize: 12,
      padding: '6px 12px',
      borderRadius: 999,
      border: '1px solid ' + (active ? TEXT_PRIMARY : BORDER_LIGHT),
      background: active ? TEXT_PRIMARY : CARD_BG,
      color: active ? '#fff' : TEXT_PRIMARY,
      cursor: 'pointer',
    };
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: 40 }}>Loading your collection…</p>;
  if (error) return <p style={{ textAlign: 'center', marginTop: 40, color: 'crimson' }}>{error}</p>;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', minHeight: '100vh', boxSizing: 'border-box', background: PAGE_BG, padding: '24px 16px 40px', color: TEXT_PRIMARY }}>
      {!selected && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            {photoURL && (
              <img
                src={photoURL}
                alt=""
                style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
              />
            )}
            <p style={{ color: TEXT_MUTED, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', margin: 0 }}>
              {displayName ? `${displayName}'s Memory Museum` : 'Your Memory Museum'}
            </p>
          </div>
          <h1 style={{ fontSize: 30, lineHeight: 1.3, margin: '0 0 8px', color: TEXT_PRIMARY, fontWeight: 700, letterSpacing: -0.5 }}>
            Turn your life into a museum you can collect.
          </h1>
          <p style={{ fontSize: 14, color: TEXT_MUTED, margin: '0 0 20px' }}>
            Keep travel, relationships, and daily life in objects.
          </p>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <button
              onClick={onAddItem}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                textAlign: 'left',
                padding: '14px 14px',
                borderRadius: 16,
                border: 'none',
                background: ACCENT,
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 15,
                }}
              >
                📷
              </span>
              <span>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>Scan a Photo</span>
                <span style={{ display: 'block', fontSize: 11, opacity: 0.85, marginTop: 1 }}>Capture a new item</span>
              </span>
            </button>
            <button
              onClick={() => setCreatingCollection(true)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                textAlign: 'left',
                padding: '14px 14px',
                borderRadius: 16,
                border: '1px solid ' + BORDER_LIGHT,
                background: CARD_BG,
                color: TEXT_PRIMARY,
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  borderRadius: '50%',
                  background: PLACEHOLDER_BG,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  color: ACCENT,
                }}
              >
                +
              </span>
              <span>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>New Memory</span>
                <span style={{ display: 'block', fontSize: 11, color: TEXT_MUTED, marginTop: 1 }}>Start a new collection</span>
              </span>
            </button>
          </div>
        </>
      )}

      {items.length === 0 && <p style={{ color: TEXT_MUTED }}>No saved 3D models yet.</p>}

      {!selected && recentItems.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 13, color: TEXT_MUTED, fontWeight: 600, margin: '0 0 6px' }}>Recent items</h2>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {recentItems.map((item) => (
              <button
                key={item.id}
                onClick={() => selectItem(item)}
                style={{
                  flexShrink: 0,
                  width: 96,
                  border: '1px solid ' + BORDER_LIGHT,
                  borderRadius: 12,
                  padding: 0,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  background: CARD_BG,
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
                  <div style={{ width: '100%', height: 72, background: PLACEHOLDER_BG }} />
                )}
                <div
                  style={{
                    fontSize: 11,
                    color: TEXT_PRIMARY,
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
        <div style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 14, color: TEXT_PRIMARY, fontWeight: 700, margin: '0 0 8px' }}>Browse Memories</h2>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, alignItems: 'center' }}>
            <button onClick={() => setSelectedCollectionId(ALL_COLLECTIONS)} style={chipStyle(selectedCollectionId === ALL_COLLECTIONS)}>
              All Items
            </button>
            <button onClick={() => setSelectedCollectionId(UNCATEGORIZED)} style={chipStyle(selectedCollectionId === UNCATEGORIZED)}>
              Uncategorized
            </button>
            {collections.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <button onClick={() => setSelectedCollectionId(c.id)} style={chipStyle(selectedCollectionId === c.id)}>
                  {c.name}
                </button>
                {selectedCollectionId === c.id && (
                  <button
                    onClick={() => handleDeleteCollection(c)}
                    title="Delete collection"
                    style={{ marginLeft: 2, fontSize: 11, color: '#e05555', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {creatingCollection ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                <input
                  autoFocus
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateCollection();
                    if (e.key === 'Escape') {
                      setCreatingCollection(false);
                      setNewCollectionName('');
                    }
                  }}
                  placeholder="Collection name"
                  style={{ fontSize: 12, padding: '4px 8px', width: 120, borderRadius: 6, border: '1px solid ' + BORDER_LIGHT }}
                  disabled={savingCollection}
                />
                <button onClick={handleCreateCollection} disabled={savingCollection || !newCollectionName.trim()} style={{ fontSize: 12 }}>
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
              </div>
            ) : (
              <button
                onClick={() => setCreatingCollection(true)}
                style={{
                  flexShrink: 0,
                  fontSize: 12,
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: '1px dashed ' + BORDER_LIGHT,
                  background: 'none',
                  color: TEXT_MUTED,
                  cursor: 'pointer',
                }}
              >
                + New Collection
              </button>
            )}
          </div>
          {collectionsError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 6 }}>{collectionsError}</p>}
        </div>
      )}

      {!selected && items.length > 0 && (
        <div style={{ marginTop: 12, marginBottom: 12 }}>
          <input
            type="search"
            placeholder="Search by name, location, or type…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid ' + BORDER_LIGHT,
              background: CARD_BG,
              color: TEXT_PRIMARY,
            }}
          />

          {typeOptions.length > 1 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 8, paddingBottom: 4 }}>
              {typeOptions.map((t) => (
                <button key={t} onClick={() => setFilterType(t)} style={chipStyle(filterType === t)}>
                  {t}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12 }}>
            <label htmlFor="sort-select" style={{ color: TEXT_MUTED }}>
              Sort:
            </label>
            <select
              id="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              style={{ fontSize: 12, borderRadius: 6, border: '1px solid ' + BORDER_LIGHT, padding: '3px 6px' }}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: '#888' }}>
                <label htmlFor="collection-select">Collection:</label>
                <select
                  id="collection-select"
                  value={selected.collectionId ?? ''}
                  onChange={(e) => handleMoveSelectedItemToCollection(e.target.value || null)}
                  disabled={movingItem}
                  style={{ fontSize: 12 }}
                >
                  <option value="">Uncategorized</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {movingItem && <span>Moving…</span>}
              </div>
              {collectionsError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 4 }}>{collectionsError}</p>}
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

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 12, color: '#888' }}>
            <label style={{ cursor: savingBackgroundImage ? 'default' : 'pointer' }}>
              {savingBackgroundImage
                ? 'Saving…'
                : selected.backgroundImageUrl
                  ? 'Change background image'
                  : 'Upload background image'}
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
            {selected.backgroundImageUrl && (
              <button onClick={handleRemoveBackgroundImage} disabled={savingBackgroundImage} style={{ fontSize: 12 }}>
                Remove image
              </button>
            )}
          </div>
          {backgroundImageError && <p style={{ color: 'crimson', fontSize: 12, marginBottom: 8 }}>{backgroundImageError}</p>}

          <ModelViewer
            url={modelProxyUrl(selected.modelUrl)}
            fallbackMessage="This 3D model is no longer available. Please retake photos and regenerate."
            backgroundImageUrl={selected.backgroundImageUrl}
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
                border: '1px solid ' + BORDER_LIGHT,
                borderRadius: 12,
                padding: 0,
                overflow: 'hidden',
                cursor: 'pointer',
                background: CARD_BG,
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
                <div style={{ width: '100%', height: 120, background: PLACEHOLDER_BG }} />
              )}
              <div style={{ padding: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name || 'Untitled item'}
                </div>
                <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 2 }}>
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
