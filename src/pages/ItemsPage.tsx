import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { getItems } from '../services/items';
import type { Item } from '../types';
import { SURFACE, FG, MUTED, BORDER, SOFT, pageBackground, chipStyle, eyebrowStyle } from '../theme';

// PRD's "物件" (Items) screen — the flat, searchable/sortable library of
// every item regardless of which Memory/Collection it's filed under.
// Reintroduces the grid Home used to show directly (removed when Home
// switched to one-row-per-collection browsing) as its own top-level screen,
// matching the design handoff's separate `记忆`/`物件` tabs.
export default function ItemsPage({ user, onSelectItem }: { user: User; onSelectItem: (item: Item) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    return () => {
      cancelled = true;
    };
  }, [user]);

  const typeOptions = useMemo(() => {
    const seen = new Set<string>();
    items.forEach((item) => {
      if (item.type) seen.add(item.type);
    });
    return ['All', ...Array.from(seen).sort((a, b) => a.localeCompare(b))];
  }, [items]);

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
      result = [...result].reverse();
    } else if (sortBy === 'location') {
      result = [...result].sort((a, b) => (a.location ?? '').localeCompare(b.location ?? ''));
    } else if (sortBy === 'type') {
      result = [...result].sort((a, b) => (a.type ?? '').localeCompare(b.type ?? ''));
    }
    return result;
  }, [items, searchQuery, filterType, sortBy]);

  if (loading) return <p style={{ textAlign: 'center', marginTop: 40 }}>Loading your items…</p>;
  if (error) return <p style={{ textAlign: 'center', marginTop: 40, color: 'crimson' }}>{error}</p>;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', minHeight: '100vh', boxSizing: 'border-box', ...pageBackground, padding: '20px 18px 40px', color: FG }}>
      <h1 style={{ textAlign: 'center', fontSize: 17, fontWeight: 700, margin: '0 0 16px' }}>Items</h1>

      {items.length === 0 ? (
        <p style={{ color: MUTED, textAlign: 'center' }}>No saved items yet — scan one from Home to get started.</p>
      ) : (
        <>
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
              border: '1px solid ' + BORDER,
              background: SURFACE,
              color: FG,
            }}
          />

          {typeOptions.length > 1 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 10, paddingBottom: 4 }}>
              {typeOptions.map((t) => (
                <button key={t} onClick={() => setFilterType(t)} style={chipStyle(filterType === t)}>
                  {t}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <label htmlFor="items-sort-select" style={eyebrowStyle}>
              Sort
            </label>
            <select
              id="items-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              style={{ fontSize: 12, borderRadius: 6, border: '1px solid ' + BORDER, padding: '3px 6px' }}
            >
              <option value="newest">Date (newest first)</option>
              <option value="oldest">Date (oldest first)</option>
              <option value="location">Location (A–Z)</option>
              <option value="type">Type (A–Z)</option>
            </select>
          </div>

          {displayedItems.length === 0 ? (
            <p style={{ color: MUTED, fontSize: 13, marginTop: 20 }}>No items match your search/filter.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginTop: 16 }}>
              {displayedItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelectItem(item)}
                  style={{
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
                      style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <div style={{ width: '100%', height: 120, background: SOFT }} />
                  )}
                  <div style={{ padding: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: FG, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name || 'Untitled item'}
                    </div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                      {item.type ?? 'Click to view'}
                      {item.location ? ` · ${item.location}` : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
