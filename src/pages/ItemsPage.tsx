import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { getItems } from '../services/items';
import type { Item } from '../types';
import { SURFACE, FG, MUTED, SOFT, pageBackground, chipStyle } from '../theme';

// PRD's "物件" (Items) screen. Rebuilt (twice) to match the design
// handoff's free-scatter-of-objects interaction instead of a search+sort+
// grid — but the device-tilt physics simulation from the first pass turned
// out to be the wrong target entirely: what was actually wanted is a
// static, deliberately-overlapping cascade of stickers piled toward the
// bottom of the screen (like a fan of photos dropped on a shelf), not a
// live physics toy. This version drops the whole gravity/DeviceOrientation
// simulation — no more mobile-Safari layout-timing bugs to chase — in
// favor of a deterministic cascade layout computed once per item.

// Deterministic pseudo-random in [0, 1) from a string seed, so each item's
// rotation/jitter is stable across re-renders instead of reshuffling every
// time `items` re-fetches.
function seededRandom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  return ((h >>> 0) % 10000) / 10000;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

interface Placement {
  x: number; // percent
  y: number; // percent
  size: number; // px
  rotate: number; // deg
}

// Cascades items diagonally in short runs of 3-4 before starting a new
// "column" further across the field, with per-item jitter and rotation —
// close overlap by design (the reference look is a pile of stickers, not a
// tidy scatter), anchored toward the lower half of the field.
function cascadePlacement(item: Item, index: number): Placement {
  const RUN_LENGTH = 4;
  const run = Math.floor(index / RUN_LENGTH);
  const posInRun = index % RUN_LENGTH;
  const columnBaseX = 16 + (run % 3) * 26;
  const columnBaseY = 34 + Math.floor(run / 3) * 10;

  const jx = (seededRandom(item.id + 'x') - 0.5) * 6;
  const jy = (seededRandom(item.id + 'y') - 0.5) * 6;
  const jr = (seededRandom(item.id + 'r') - 0.5) * 28;
  const js = seededRandom(item.id + 's');

  return {
    x: clamp(columnBaseX + posInRun * 8 + jx, 10, 88),
    y: clamp(columnBaseY + posInRun * 11 + jy, 28, 90),
    size: 92 + Math.round(js * 22),
    rotate: Math.round(jr),
  };
}

export default function ItemsPage({ user, onSelectItem }: { user: User; onSelectItem: (item: Item) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState('All');

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

  const visibleItems = useMemo(
    () => items.filter((item) => filterType === 'All' || item.type === filterType),
    [items, filterType],
  );

  if (loading) return <p style={{ textAlign: 'center', marginTop: 40 }}>Loading your items…</p>;
  if (error) return <p style={{ textAlign: 'center', marginTop: 40, color: 'crimson' }}>{error}</p>;

  return (
    <div
      style={{
        maxWidth: 640,
        margin: '0 auto',
        minHeight: '100vh',
        boxSizing: 'border-box',
        ...pageBackground,
        color: FG,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <h1 style={{ textAlign: 'center', fontSize: 18, letterSpacing: '-.02em', margin: '20px 0 12px', padding: '0 18px' }}>Items</h1>

      {items.length === 0 ? (
        <p style={{ color: MUTED, textAlign: 'center', padding: '0 18px' }}>No saved items yet — scan one from Home to get started.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '0 18px 4px' }}>
            {typeOptions.map((t) => (
              <button key={t} onClick={() => setFilterType(t)} style={chipStyle(filterType === t)}>
                {t}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative', flex: 1, minHeight: 'max(420px, 55vh)', margin: '8px 0 0', overflow: 'hidden' }}>
            {visibleItems.length === 0 ? (
              <p style={{ color: MUTED, textAlign: 'center', padding: 24 }}>No items in this category yet.</p>
            ) : (
              visibleItems.map((item, index) => {
                const { x, y, size, rotate } = cascadePlacement(item, index);
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectItem(item)}
                    aria-label={item.name || 'Untitled item'}
                    style={{
                      position: 'absolute',
                      left: `${x}%`,
                      top: `${y}%`,
                      width: size,
                      height: size,
                      zIndex: index,
                      transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
                      borderRadius: 16,
                      overflow: 'hidden',
                      border: '3px solid ' + SURFACE,
                      padding: 0,
                      cursor: 'pointer',
                      background: SURFACE,
                      boxShadow: '0 8px 16px rgba(0,0,0,0.16)',
                    }}
                  >
                    {item.stickerUrl ?? item.photos?.[0] ? (
                      <img
                        src={item.stickerUrl ?? item.photos![0]}
                        alt=""
                        draggable={false}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
                      />
                    ) : (
                      <div style={{ width: '100%', height: '100%', background: SOFT }} />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
