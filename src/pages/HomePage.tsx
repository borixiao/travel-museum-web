import { useEffect, useMemo, useRef, useState } from 'react';
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
import ItemMetadataForm, { emptyItemMetadata } from '../components/ItemMetadataForm';
import Icon from '../components/Icon';
import type { Item, ItemMetadata, Collection } from '../types';
import {
  SURFACE,
  FG,
  MUTED,
  BORDER,
  ACCENT,
  SOFT,
  actionButtonStyle,
  chipStyle,
  eyebrowStyle,
  pageBackground,
  FONT_DISPLAY,
  stickyHeaderStyle,
  entryButtonStyle,
  entryIconWrapStyle,
  galleryLabelStyle,
} from '../theme';

// Ref-map key for the Uncategorized row (scroll-to-row target) — distinct
// from any real Collection id, which are Firestore-generated document ids.
const UNCATEGORIZED = '__uncategorized__';


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
  // items, now the primary way to browse Home (one row per collection —
  // see the collection-rows list below). `movingItem` is still used by the
  // Item Detail view's own Collection picker.
  const [collections, setCollections] = useState<Collection[]>([]);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [savingCollection, setSavingCollection] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [movingItem, setMovingItem] = useState(false);

  // Browse-Memories chips are quick-jump links into the collection-rows list
  // below, not filters — `rowRefs` holds each row's DOM node (keyed by
  // Collection id, or UNCATEGORIZED for the Uncategorized row) so a chip
  // click can smooth-scroll straight to it; `topRef` is the "All Items"
  // chip's target (back to the top of the list).
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const topRef = useRef<HTMLDivElement>(null);

  function scrollToRow(key: string) {
    if (key === 'top') {
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    rowRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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

  // PRD 4.2 "Recent items rail (latest 4, horizontal scroll)" — always shows
  // the true most-recently-added 4, sourced straight from `items`, which
  // Firestore already returns newest first.
  const recentItems = useMemo(() => items.slice(0, 4), [items]);

  // Groups items by collection for the one-row-per-collection browse list
  // below. An item whose `collectionId` doesn't match any current Collection
  // (the collection it pointed to was since deleted, or it predates this
  // feature) falls into Uncategorized right alongside items with no
  // collectionId at all — same convention `deleteCollection` already uses.
  const itemsByCollection = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const c of collections) map.set(c.id, []);
    for (const item of items) {
      if (item.collectionId && map.has(item.collectionId)) {
        map.get(item.collectionId)!.push(item);
      }
    }
    return map;
  }, [items, collections]);

  const uncategorizedItems = useMemo(
    () => items.filter((item) => !item.collectionId || !collections.some((c) => c.id === item.collectionId)),
    [items, collections],
  );

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
      setNewCollectionName('');
      setCreatingCollection(false);
      // The new row's ref isn't registered until the `collections` update
      // above actually commits/renders — deferring one tick is enough for
      // that to happen before we try to scroll to it.
      setTimeout(() => scrollToRow(created.id), 0);
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



  // One row per collection (plus Uncategorized) in the Browse Memories list
  // below — factored out since the two call sites (named collections vs.
  // the Uncategorized bucket) are otherwise identical except for the delete
  // button, which only makes sense on a real Collection.
  function renderCollectionRow(key: string, name: string, rowItems: Item[], onDelete?: () => void) {
    return (
      <div
        key={key}
        ref={(el) => {
          if (el) rowRefs.current.set(key, el);
          else rowRefs.current.delete(key);
        }}
        style={{ background: SURFACE, border: '1px solid ' + BORDER, borderRadius: 16, padding: 14 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: FG }}>{name}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
              {rowItems.length} item{rowItems.length === 1 ? '' : 's'}
            </div>
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              title="Delete collection"
              style={{ flexShrink: 0, background: 'none', border: 'none', color: '#e05555', cursor: 'pointer', fontSize: 13, padding: 4 }}
            >
              ✕
            </button>
          )}
        </div>
        {rowItems.length > 0 ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, overflowX: 'auto', paddingBottom: 2 }}>
            {rowItems.slice(0, 6).map((item) => (
              <button
                key={item.id}
                onClick={() => selectItem(item)}
                style={{
                  flexShrink: 0,
                  width: 64,
                  height: 64,
                  borderRadius: 10,
                  overflow: 'hidden',
                  border: '1px solid ' + BORDER,
                  padding: 0,
                  cursor: 'pointer',
                  background: SOFT,
                }}
              >
                {(item.stickerUrl ?? item.photos?.[0]) && (
                  <img
                    src={item.stickerUrl ?? item.photos![0]}
                    alt={item.name || 'item'}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
              </button>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: MUTED, marginTop: 10, marginBottom: 0 }}>No items yet.</p>
        )}
      </div>
    );
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: 40 }}>Loading your collection…</p>;
  if (error) return <p style={{ textAlign: 'center', marginTop: 40, color: 'crimson' }}>{error}</p>;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', minHeight: '100vh', boxSizing: 'border-box', ...pageBackground, color: FG }}>
      {!selected && (
        <div style={{ padding: '10px 18px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {photoURL && (
              <img
                src={photoURL}
                alt=""
                style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
              />
            )}
            <p style={{ ...eyebrowStyle, margin: 0 }}>
              {displayName ? `${displayName}'s Memory Museum` : 'Your Memory Museum'}
            </p>
          </div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 29, lineHeight: 1.04, letterSpacing: '-.035em', margin: '5px 0 0', color: FG, fontWeight: 650 }}>
            Turn your life into a museum you can collect.
          </h1>
          <p style={{ fontSize: 13, color: MUTED, margin: '7px 0 0' }}>
            Keep travel, relationships, and daily life in objects.
          </p>
        </div>
      )}

      {items.length === 0 && <p style={{ color: MUTED, padding: '16px 18px 0' }}>No saved 3D models yet.</p>}

      {!selected && recentItems.length > 0 && (
        <div style={{ marginTop: 16, padding: '0 18px' }}>
          <h2 style={{ fontSize: 13, color: MUTED, fontWeight: 600, margin: '0 0 6px' }}>Recent items</h2>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {recentItems.map((item) => (
              <button
                key={item.id}
                onClick={() => selectItem(item)}
                style={{
                  flexShrink: 0,
                  width: 96,
                  border: '1px solid ' + BORDER,
                  borderRadius: 12,
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
                    alt="item thumbnail"
                    style={{ width: '100%', height: 72, objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div style={{ width: '100%', height: 72, background: SOFT }} />
                )}
                <div
                  style={{
                    fontSize: 11,
                    color: FG,
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

      {/* Sticky CTA + filter header (spec's .memory-sticky) — stays pinned
          above the scrolling collection list below, matching the design
          handoff's actual DOM structure rather than scrolling away with
          the hero like the rest of this section used to. */}
      {!selected && items.length > 0 && (
        <div style={stickyHeaderStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
            <button onClick={onAddItem} style={entryButtonStyle('scan')}>
              <span style={entryIconWrapStyle('scan')}>
                <Icon name="camera" size={20} />
              </span>
              <span>
                <strong style={{ display: 'block', fontSize: 14 }}>Scan a Photo</strong>
                <small style={{ display: 'block', marginTop: 3, fontSize: 10, lineHeight: 1.25, color: `color-mix(in oklch, ${SURFACE} 82%, transparent)` }}>
                  Capture a new item
                </small>
              </span>
            </button>
            <button onClick={() => setCreatingCollection(true)} style={entryButtonStyle('create')}>
              <span style={entryIconWrapStyle('create')}>
                <Icon name="plus" size={20} />
              </span>
              <span>
                <strong style={{ display: 'block', fontSize: 14 }}>New Memory</strong>
                <small style={{ display: 'block', marginTop: 3, fontSize: 10, lineHeight: 1.25, color: MUTED }}>Start a new collection</small>
              </span>
            </button>
          </div>

          <p style={galleryLabelStyle}>Browse Memories</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 9, overflowX: 'auto', paddingBottom: 3, alignItems: 'center' }}>
            <button onClick={() => scrollToRow('top')} style={chipStyle(true)}>
              All Items
            </button>
            <button onClick={() => scrollToRow(UNCATEGORIZED)} style={chipStyle(false)}>
              Uncategorized
            </button>
            {collections.map((c) => (
              <button key={c.id} onClick={() => scrollToRow(c.id)} style={chipStyle(false)}>
                {c.name}
              </button>
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
                  style={{ fontSize: 12, padding: '4px 8px', width: 120, borderRadius: 6, border: '1px solid ' + BORDER }}
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
                  border: '1px dashed ' + BORDER,
                  background: 'none',
                  color: MUTED,
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

      {selected ? (
        <div style={{ padding: '16px 18px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <button
              onClick={() => selectItem(null)}
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
            <h1 style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: 700, margin: 0, marginRight: 36 }}>Item Details</h1>
          </div>

          <ModelViewer
            url={modelProxyUrl(selected.modelUrl)}
            fallbackMessage="This 3D model is no longer available. Please retake photos and regenerate."
            backgroundImageUrl={selected.backgroundImageUrl}
            height={320}
          />

          <div
            style={{
              background: SURFACE,
              borderRadius: 20,
              marginTop: -20,
              position: 'relative',
              padding: '20px 16px 24px',
            }}
          >
            {editing ? (
              <div>
                <h2 style={{ fontSize: 16, marginBottom: 8, color: FG }}>Edit item details</h2>
                <ItemMetadataForm value={editValue} onChange={setEditValue} />
                {editError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 8 }}>{editError}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={handleSaveEdit} disabled={savingEdit} style={actionButtonStyle('primary', savingEdit)}>
                    {savingEdit ? 'Saving…' : 'Save changes'}
                  </button>
                  <button onClick={() => setEditing(false)} disabled={savingEdit} style={actionButtonStyle('secondary', savingEdit)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: MUTED }}>
                  {[selected.type, selected.location, selected.date].filter(Boolean).join(' · ')}
                </div>
                <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 650, margin: '4px 0 8px', color: FG }}>
                  {selected.name || 'Untitled item'}
                </h2>
                {selected.story && <p style={{ fontSize: 14, color: MUTED, margin: '0 0 16px', lineHeight: 1.5 }}>{selected.story}</p>}

                {selected.emotionTags && selected.emotionTags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                    {selected.emotionTags.map((tag) => (
                      <span
                        key={tag}
                        style={{
                          fontSize: 12,
                          color: ACCENT,
                          border: '1px solid ' + ACCENT,
                          borderRadius: 999,
                          padding: '2px 10px',
                          background: SOFT,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Matches the mockup's "Stored in <Collection>" card — repurposed
                    to also be the collection-reassignment control (a plain <select>
                    styled to sit inside the card) rather than a second, separate
                    control elsewhere on the page. */}
                <div style={{ border: '1px solid ' + BORDER, borderRadius: 14, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: FG, marginBottom: 2 }}>
                    Stored in {selected.collectionId ? collections.find((c) => c.id === selected.collectionId)?.name ?? 'Uncategorized' : 'Uncategorized'}
                  </div>
                  <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
                    Kept together with the other items, photos, and stories in this memory.
                  </div>
                  <select
                    id="collection-select"
                    value={selected.collectionId ?? ''}
                    onChange={(e) => handleMoveSelectedItemToCollection(e.target.value || null)}
                    disabled={movingItem}
                    style={{ fontSize: 12, borderRadius: 6, border: '1px solid ' + BORDER, padding: '3px 6px' }}
                  >
                    <option value="">Uncategorized</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {movingItem && <span style={{ fontSize: 12, color: MUTED, marginLeft: 6 }}>Moving…</span>}
                </div>
                {collectionsError && <p style={{ color: 'crimson', fontSize: 12, marginTop: -12, marginBottom: 12 }}>{collectionsError}</p>}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <button onClick={startEdit} disabled={deleting} style={actionButtonStyle('secondary', deleting)}>
                    Edit
                  </button>
                  {selected.photos?.[0] && (
                    <button
                      onClick={handleGenerateSticker}
                      disabled={generatingSticker || deleting}
                      style={actionButtonStyle('secondary', generatingSticker || deleting)}
                    >
                      {generatingSticker ? 'Generating…' : selected.stickerUrl ? 'Regenerate AI Sticker' : 'Generate AI Sticker'}
                    </button>
                  )}
                  <button
                    onClick={handleAddToMoodboard}
                    disabled={addingToMoodboard || deleting}
                    style={actionButtonStyle('secondary', addingToMoodboard || deleting)}
                  >
                    {addingToMoodboard ? 'Adding…' : addedToMoodboard ? 'Added ✓' : 'Add to Moodboard'}
                  </button>
                  <button onClick={handleDelete} disabled={deleting} style={actionButtonStyle('danger', deleting)}>
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
                {deleteError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 4 }}>{deleteError}</p>}
                {stickerError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 4 }}>{stickerError}</p>}
                {moodboardError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 4 }}>{moodboardError}</p>}
              </>
            )}

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, fontSize: 12 }}>
              <label
                style={{
                  cursor: savingBackgroundImage ? 'default' : 'pointer',
                  color: MUTED,
                  textDecoration: 'underline',
                  opacity: savingBackgroundImage ? 0.5 : 1,
                }}
              >
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
                <button
                  onClick={handleRemoveBackgroundImage}
                  disabled={savingBackgroundImage}
                  style={{
                    fontSize: 12,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: MUTED,
                    textDecoration: 'underline',
                    cursor: savingBackgroundImage ? 'default' : 'pointer',
                    opacity: savingBackgroundImage ? 0.5 : 1,
                  }}
                >
                  Remove image
                </button>
              )}
            </div>
            {backgroundImageError && <p style={{ color: 'crimson', fontSize: 12, marginTop: 4 }}>{backgroundImageError}</p>}
          </div>
        </div>
      ) : (
        items.length > 0 && (
          <div ref={topRef} style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 18px 40px' }}>
            {collections.map((c) => renderCollectionRow(c.id, c.name, itemsByCollection.get(c.id) ?? [], () => handleDeleteCollection(c)))}
            {uncategorizedItems.length > 0 && renderCollectionRow(UNCATEGORIZED, 'Uncategorized', uncategorizedItems)}
          </div>
        )
      )}
    </div>
  );
}
