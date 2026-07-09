import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { getItems, updateItemMetadata } from '../services/items';
import { modelProxyUrl } from '../services/tripoClient';
import ModelViewer from '../components/ModelViewer';
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
    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  function selectItem(item: Item | null) {
    setSelected(item);
    setEditing(false);
    setEditError(null);
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

  if (loading) return <p style={{ textAlign: 'center', marginTop: 40 }}>Loading your collection…</p>;
  if (error) return <p style={{ textAlign: 'center', marginTop: 40, color: 'crimson' }}>{error}</p>;

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 20 }}>My Collection</h1>

      {items.length === 0 && <p style={{ color: '#888' }}>No saved 3D models yet.</p>}

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
                <button onClick={startEdit} style={{ flexShrink: 0 }}>
                  Edit
                </button>
              </div>
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

          <ModelViewer
            url={modelProxyUrl(selected.modelUrl)}
            fallbackMessage="This 3D model is no longer available. Please retake photos and regenerate."
          />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {items.map((item) => (
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
              {item.photos?.[0] ? (
                <img
                  src={item.photos[0]}
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
