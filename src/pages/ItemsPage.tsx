import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { getItems } from '../services/items';
import type { Item } from '../types';
import { SURFACE, FG, MUTED, BORDER, SOFT, ACCENT, pageBackground, chipStyle } from '../theme';

// PRD's "物件" (Items) screen. The design handoff's actual version isn't a
// searchable grid — it's a free scatter of objects with an optional
// "gravity" mode that follows the device's tilt (falling back to the
// pointer on desktop), filtered by a row of chips. Rebuilt to match that
// interaction model instead of the search+sort+CSS-grid this screen used
// to be. The handoff's own filter chips are 全部/2D/3D/生成中 (keyed to
// model-generation status) — that doesn't map onto this app's data (an item
// is only ever saved *after* its 3D model finishes, so "generating" can
// never apply to a saved item here), so the chips are item `type` values
// instead, same as every other type-filter already in this app.

interface Body {
  id: string;
  x: number; // percent, 0-100
  y: number; // percent, 0-100
  vx: number;
  vy: number;
  size: number; // px
  rotate: number; // deg — fixed per item, physics doesn't touch it
}

// Deterministic pseudo-random in [0, 1) from a string seed, so each item's
// starting scatter position/size/tilt is stable across re-renders instead
// of jumping around whenever `items` re-fetches.
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

const FIELD_MARGIN_X = 8; // percent — keeps a body's left/right edge off the wall
const GRAVITY_ACCEL = 70; // percent/s^2
const FRICTION = 0.94;
const BOUNCE = 0.35;
const SLEEP_SPEED = 0.05; // percent/s combined — below this a body counts as "at rest"
const SLEEP_FRAMES = 40; // consecutive resting frames before the rAF loop pauses
const REST_IMPACT_SPEED = 2; // percent/s — below this, a wall hit stops instead of bouncing
const MAX_SPEED = 60; // percent/s — hard velocity cap; a crowded pile's separation nudges
// can compound with wall bounces in ways that are hard to fully rule out analytically, so
// this bounds the worst case instead of chasing every possible configuration.
const FORCE_SLEEP_FRAMES = 600; // ~10s at 60fps — sleep unconditionally past this, regardless
// of residual speed, so a dense pile can never keep the rAF loop (and battery) running forever.

type GravityStatus = 'idle' | 'granted' | 'denied';

export default function ItemsPage({ user, onSelectItem }: { user: User; onSelectItem: (item: Item) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState('All');
  const [gravityStatus, setGravityStatus] = useState<GravityStatus>('idle');
  const [, forceTick] = useState(0);

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const fieldRef = useRef<HTMLDivElement>(null);
  const bodiesRef = useRef<Map<string, Body>>(new Map());
  const gravityVecRef = useRef<{ x: number; y: number }>({ x: 0, y: 1 });
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const restFramesRef = useRef(0);
  const framesSinceWakeRef = useRef(0);
  // On-screen diagnostic (temporary) — surfaces exactly what the physics
  // loop sees each frame, so a "gravity does nothing" report can be
  // screenshotted directly instead of reasoned about blind. Remove once
  // the real-device behavior is confirmed fixed.
  const debugRef = useRef({ rect: '—', status: 'idle', frame: 0 });

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

  const runFrame = useCallback(
    (timestamp: number) => {
      const field = fieldRef.current;
      if (!field) {
        rafRef.current = null;
        return;
      }
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = timestamp;

      const rect = field.getBoundingClientRect();
      debugRef.current.rect = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      // Mobile Safari can report a zero-size rect for a frame or two while
      // 100vh-based flex layout settles (a known viewport-unit quirk) — a
      // zero width/height here would divide-by-zero into Infinity and
      // permanently corrupt every body's position. Skip the physics step
      // (but keep polling) until the field actually has real dimensions.
      if (rect.width < 10 || rect.height < 10) {
        debugRef.current.status = 'waiting for layout';
        forceTick((t) => t + 1);
        rafRef.current = requestAnimationFrame(runFrame);
        return;
      }
      const { x: gx, y: gy } = gravityVecRef.current;
      let maxSpeed = 0;

      bodiesRef.current.forEach((body) => {
        const marginXPercent = Math.max(FIELD_MARGIN_X, (body.size / 2 / rect.width) * 100);
        const marginYPercent = (body.size / 2 / Math.max(rect.height, 1)) * 100;

        body.vx += gx * GRAVITY_ACCEL * dt;
        body.vy += gy * GRAVITY_ACCEL * dt;
        body.vx *= FRICTION;
        body.vy *= FRICTION;
        // Hard cap — a crowded pile's separation nudges (see below) can in
        // principle compound with wall bounces across many overlapping
        // pairs in ways not fully ruled out analytically; this bounds the
        // worst case instead of chasing every possible dense configuration.
        const speed = Math.hypot(body.vx, body.vy);
        if (speed > MAX_SPEED) {
          body.vx = (body.vx / speed) * MAX_SPEED;
          body.vy = (body.vy / speed) * MAX_SPEED;
        }
        body.x += body.vx * dt;
        body.y += body.vy * dt;

        const minX = marginXPercent;
        const maxX = 100 - marginXPercent;
        const minY = marginYPercent;
        const maxY = 100 - marginYPercent;
        // Below REST_IMPACT_SPEED, treat a wall hit as inelastic (velocity
        // zeroed) instead of reflecting it — without this floor, a body
        // resting on the floor re-hits it every single frame under gravity
        // and settles into a permanent low-amplitude bounce loop instead of
        // ever truly stopping. Confirmed numerically: a body simulated for
        // 3000 frames never dropped below the sleep-speed threshold,
        // oscillating at a steady ~0.3 forever — exactly the speed the
        // on-device debug overlay reported.
        if (body.x < minX) {
          body.x = minX;
          body.vx = Math.abs(body.vx) < REST_IMPACT_SPEED ? 0 : -body.vx * BOUNCE;
        } else if (body.x > maxX) {
          body.x = maxX;
          body.vx = Math.abs(body.vx) < REST_IMPACT_SPEED ? 0 : -body.vx * BOUNCE;
        }
        if (body.y < minY) {
          body.y = minY;
          body.vy = Math.abs(body.vy) < REST_IMPACT_SPEED ? 0 : -body.vy * BOUNCE;
        } else if (body.y > maxY) {
          body.y = maxY;
          body.vy = Math.abs(body.vy) < REST_IMPACT_SPEED ? 0 : -body.vy * BOUNCE;
        }
        maxSpeed = Math.max(maxSpeed, Math.hypot(body.vx, body.vy));
      });

      // Pairwise separation — deliberately soft. The target look (per a
      // reference recording) is a dense pile of overlapping stickers, like
      // a stack of photos dropped on a shelf, not evenly-spaced billiard
      // balls — so this only stops bodies from landing at the *exact* same
      // point (which reads as "nothing moved" / a single sticker) rather
      // than pushing them apart until they stop touching. minDist is a
      // fraction of combined size well under 1, and only half the push is
      // applied per pair, so items keep settling into overlapping stacks.
      const bodies = Array.from(bodiesRef.current.values());
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const b1 = bodies[i];
          const b2 = bodies[j];
          const dxPx = ((b2.x - b1.x) / 100) * rect.width;
          const dyPx = ((b2.y - b1.y) / 100) * rect.height;
          const dist = Math.hypot(dxPx, dyPx) || 0.001;
          const minDist = ((b1.size + b2.size) / 2) * 0.4;
          if (dist < minDist) {
            const overlap = minDist - dist;
            const nx = dxPx / dist;
            const ny = dyPx / dist;
            const pushXPercent = ((nx * overlap * 0.3) / rect.width) * 100;
            const pushYPercent = ((ny * overlap * 0.3) / rect.height) * 100;
            b1.x -= pushXPercent;
            b1.y -= pushYPercent;
            b2.x += pushXPercent;
            b2.y += pushYPercent;
            // NOT folded into maxSpeed below — overlap is a pixel-space
            // penetration depth, not a percent/s velocity, and a dense
            // permissive-overlap pile is *supposed* to stay within minDist
            // of its neighbors indefinitely. Feeding it into the same
            // threshold as real velocity meant a settled pile's overlap
            // alone (tens of px) permanently defeated the sleep check —
            // confirmed live: the debug overlay showed speed=0.30 (30–40x
            // the 0.05 sleep threshold) still climbing at frame 1152.
          }
        }
      }

      // Re-clamp after separation — the wall-bounce pass above keeps
      // bodies in bounds against *gravity*, but separation can push a body
      // past the field edge on its own (confirmed live: items visibly
      // exited the field and were clipped by its `overflow: hidden`,
      // reported as "items fell out"). Without this, a crowded pile with
      // many overlapping pairs has no guarantee the cumulative pushes stay
      // inside [margin, 100 - margin].
      bodiesRef.current.forEach((body) => {
        const marginXPercent = Math.max(FIELD_MARGIN_X, (body.size / 2 / rect.width) * 100);
        const marginYPercent = (body.size / 2 / Math.max(rect.height, 1)) * 100;
        body.x = clamp(body.x, marginXPercent, 100 - marginXPercent);
        body.y = clamp(body.y, marginYPercent, 100 - marginYPercent);
      });

      debugRef.current.frame += 1;
      framesSinceWakeRef.current += 1;
      debugRef.current.status = `running · gx=${gx.toFixed(2)} gy=${gy.toFixed(2)} speed=${maxSpeed.toFixed(2)} bodies=${bodiesRef.current.size}`;
      forceTick((t) => t + 1);

      restFramesRef.current = maxSpeed < SLEEP_SPEED ? restFramesRef.current + 1 : 0;
      if (restFramesRef.current > SLEEP_FRAMES || framesSinceWakeRef.current > FORCE_SLEEP_FRAMES) {
        debugRef.current.status =
          framesSinceWakeRef.current > FORCE_SLEEP_FRAMES ? 'asleep (forced timeout)' : 'asleep (at rest)';
        rafRef.current = null; // asleep — don't schedule another frame until woken
        return;
      }
      rafRef.current = requestAnimationFrame(runFrame);
    },
    [],
  );

  const wake = useCallback(() => {
    if (reducedMotion) return;
    lastTimeRef.current = 0;
    restFramesRef.current = 0;
    framesSinceWakeRef.current = 0;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(runFrame);
    }
  }, [reducedMotion, runFrame]);

  // Seeds a Body for every newly-visible item (stable per item id, so
  // switching filters doesn't reshuffle items that stay visible) and drops
  // ones that scrolled out of the current filter, then wakes the sim so
  // any newly-added items actually fall into place.
  useEffect(() => {
    const bodies = bodiesRef.current;
    const visibleIds = new Set(visibleItems.map((it) => it.id));
    for (const id of bodies.keys()) {
      if (!visibleIds.has(id)) bodies.delete(id);
    }
    // Grid+jitter starting positions, not pure hash-based — seededRandom on
    // short/similar item ids (e.g. UUIDs sharing a prefix) can land close
    // enough together that several items start on top of each other, which
    // combined with gravity always pointing straight down (no horizontal
    // spread at all) made everything pile into one spot at the bottom.
    // Index-based cells guarantee real starting separation regardless of
    // hash quality; seededRandom now only jitters *within* a cell.
    const cols = Math.max(2, Math.ceil(Math.sqrt(visibleItems.length * 1.4)));
    visibleItems.forEach((item, index) => {
      if (bodies.has(item.id)) return;
      const col = index % cols;
      const row = Math.floor(index / cols);
      const cellW = 100 / cols;
      const cellRows = Math.max(1, Math.ceil(visibleItems.length / cols));
      const cellH = 30 / cellRows;
      const jx = (seededRandom(item.id + 'x') - 0.5) * cellW * 0.7;
      const jy = (seededRandom(item.id + 'y') - 0.5) * cellH * 0.7;
      const rs = seededRandom(item.id + 's');
      const rr = seededRandom(item.id + 'r');
      bodies.set(item.id, {
        id: item.id,
        x: clamp(cellW * (col + 0.5) + jx, FIELD_MARGIN_X, 100 - FIELD_MARGIN_X),
        // Start in the upper portion so there's somewhere for gravity to
        // drop them from, matching the handoff's "物件已下落" (items have
        // already fallen) framing rather than spawning already at rest.
        y: clamp(10 + cellH * row + jy, 6, 40),
        vx: 0,
        vy: 0,
        size: 64 + Math.round(rs * 18),
        rotate: Math.round((rr - 0.5) * 24),
      });
    });
    forceTick((t) => t + 1);
    wake();
  }, [visibleItems, wake]);

  const handleOrientation = useCallback(
    (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      gravityVecRef.current = { x: clamp(e.gamma / 30, -1, 1), y: clamp(e.beta / 30, -1, 1) };
      setGravityStatus('granted');
      wake();
    },
    [wake],
  );

  // Android/desktop browsers expose DeviceOrientationEvent without a
  // permission gate — safe to just start listening. iOS 13+ requires an
  // explicit user-gesture request instead (the button below).
  useEffect(() => {
    if (reducedMotion) return;
    const OrientationCtor = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (OrientationCtor && typeof OrientationCtor.requestPermission !== 'function') {
      window.addEventListener('deviceorientation', handleOrientation);
      return () => window.removeEventListener('deviceorientation', handleOrientation);
    }
  }, [reducedMotion, handleOrientation]);

  async function handleEnableGravity() {
    const OrientationCtor = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (!OrientationCtor?.requestPermission) return;
    try {
      const result = await OrientationCtor.requestPermission();
      if (result === 'granted') {
        window.addEventListener('deviceorientation', handleOrientation);
      } else {
        setGravityStatus('denied');
      }
    } catch {
      setGravityStatus('denied');
    }
  }

  // Desktop fallback — pointer position over the field substitutes for
  // tilt, same as the handoff's "倾斜手机或移动指针" (tilt your phone or
  // move your pointer) copy. Only active before real device tilt has taken
  // over, so it doesn't fight a live sensor reading on mobile.
  function handleFieldPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (gravityStatus === 'granted') return;
    const field = fieldRef.current;
    if (!field) return;
    const rect = field.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    gravityVecRef.current = { x: clamp((px - 0.5) * 2, -1, 1), y: clamp((py - 0.5) * 2, -1, 1) };
    wake();
  }

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function gravityLabel(): string {
    if (gravityStatus === 'denied') return 'Motion access denied';
    if (gravityStatus === 'granted') return 'Following your phone’s tilt';
    const OrientationCtor = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    return OrientationCtor?.requestPermission ? 'Items have settled · Enable tilt' : 'Items have settled · Tilt or move your pointer';
  }

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

          <div
            ref={fieldRef}
            onPointerMove={handleFieldPointerMove}
            style={{ position: 'relative', flex: 1, minHeight: 'max(420px, 55vh)', margin: '8px 0 0', overflow: 'hidden' }}
          >
            {/* Temporary on-screen diagnostic — see debugRef's comment above. */}
            <div
              style={{
                position: 'absolute',
                top: 4,
                left: 4,
                zIndex: 50,
                fontSize: 9,
                fontFamily: 'monospace',
                color: '#fff',
                background: 'rgba(0,0,0,0.6)',
                padding: '3px 6px',
                borderRadius: 6,
                pointerEvents: 'none',
              }}
            >
              rect={debugRef.current.rect} frame={debugRef.current.frame} {debugRef.current.status}
            </div>
            {visibleItems.length === 0 ? (
              <p style={{ color: MUTED, textAlign: 'center', padding: 24 }}>No items in this category yet.</p>
            ) : (
              visibleItems.map((item, index) => {
                const body = bodiesRef.current.get(item.id);
                if (!body) return null;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectItem(item)}
                    aria-label={item.name || 'Untitled item'}
                    style={{
                      position: 'absolute',
                      left: `${body.x}%`,
                      top: `${body.y}%`,
                      width: body.size,
                      height: body.size,
                      zIndex: index,
                      transform: `translate(-50%, -50%) rotate(${body.rotate}deg)`,
                      borderRadius: 16,
                      overflow: 'hidden',
                      border: '3px solid ' + SURFACE,
                      padding: 0,
                      cursor: 'pointer',
                      background: SURFACE,
                      boxShadow: '0 8px 16px rgba(0,0,0,0.18)',
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

            {!reducedMotion && (
              <button
                onClick={handleEnableGravity}
                disabled={gravityStatus === 'granted'}
                style={{
                  position: 'absolute',
                  right: 18,
                  bottom: 18,
                  fontSize: 11,
                  padding: '8px 14px',
                  borderRadius: 999,
                  border: '1px solid ' + BORDER,
                  background: `color-mix(in oklch, ${SURFACE} 88%, transparent)`,
                  backdropFilter: 'blur(12px)',
                  color: gravityStatus === 'granted' ? ACCENT : MUTED,
                  cursor: gravityStatus === 'granted' ? 'default' : 'pointer',
                }}
              >
                {gravityLabel()}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
