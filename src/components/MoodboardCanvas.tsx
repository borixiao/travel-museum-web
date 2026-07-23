import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MoodboardCard } from '../types';
import ModelViewer from './ModelViewer';
import { modelProxyUrl } from '../services/tripoClient';
import { DEFAULT_MOODBOARD_BACKGROUND } from '../services/moodboard';

// A fixed pixel height (independent of the responsive width) would break
// the whole point of storing card x/y/w as percentages: on a narrower
// viewport the width shrinks but the height wouldn't, distorting the
// canvas's aspect ratio and making the same relative layout look crammed
// into a smaller portion of it. A fixed aspect ratio instead lets width
// and height shrink together, so percentage-positioned cards stay in the
// same relative spot at any viewport size (e.g. viewing a published board
// on a narrower/mobile screen than it was arranged on).
const CANVAS_ASPECT_RATIO = '4 / 3';

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Shared canvas renderer for the Moodboard editor (PRD MoodboardScreen) and
 * its public read-only viewer. Card positions/sizes are stored as
 * percentages of the canvas (see MoodboardCard in types.ts), so the same
 * component just toggles `editable` rather than needing two implementations.
 *
 * Dragging is done with pointer capture (not a drag-and-drop library) —
 * functional-first per this pass's scope: no snapping, layering, or resize
 * handles yet.
 */
// Below this pointer-travel distance (px), a pointer down→up is treated as a
// tap (opens the item's expanded detail/3D view) rather than a drag. Tracked
// independently of the editable-only x/y drag math below so tap-to-expand
// works in both the editor and the read-only public view.
const TAP_THRESHOLD_PX = 6;

// Keeps a card from shrinking into an unusable sliver or growing to
// swallow the whole board — the shrink-wrapped item/text boxes have no
// other floor/ceiling on their own.
const MIN_CARD_W = 6;
const MAX_CARD_W = 70;

export default function MoodboardCanvas({
  cards,
  editable,
  backgroundColor,
  onMove,
  onDragEnd,
  onRemove,
  onTextChange,
  onTextBlur,
  onExpand,
  onRotate,
  onResize,
  onToggleDisplayMode,
}: {
  cards: MoodboardCard[];
  editable: boolean;
  /** Falls back to the same default a freshly-created moodboard is seeded
   *  with, so boards saved before this field existed render identically. */
  backgroundColor?: string;
  onMove?: (id: string, x: number, y: number) => void;
  // Called once at the end of a move, rotate, or resize gesture that
  // actually changed something — the id lets the caller bring that card to
  // the front of the stacking order (see MoodboardPage.handleDragEnd) before
  // persisting, since "the thing you just touched should come out on top"
  // is the whole point of a physical collage/corkboard layout.
  onDragEnd?: (id: string) => void;
  onRemove?: (id: string) => void;
  onTextChange?: (id: string, text: string) => void;
  onTextBlur?: () => void;
  onExpand?: (card: MoodboardCard) => void;
  onRotate?: (id: string, rotation: number) => void;
  onResize?: (id: string, w: number) => void;
  // Sticker/3D display-mode toggle (only meaningful for 'item' cards that
  // have a modelUrl) — a discrete click, not a drag gesture, so unlike
  // onMove/onRotate/onResize there's no separate "end" callback needed.
  onToggleDisplayMode?: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; startClientX: number; startClientY: number; w: number } | null>(null);
  // Separate from dragRef (move) so a rotate-drag never gets confused with a
  // move-drag — see the pointer-capture note on the rotate handle below for
  // why handlePointerMove/handlePointerUp (bound to the card body) safely
  // no-op during a rotate gesture rather than fighting over the same ref.
  const rotateRef = useRef<{ id: string; centerX: number; centerY: number; startAngle: number; startRotation: number } | null>(null);
  // Same isolation story as rotateRef, one ref per gesture kind.
  const resizeRef = useRef<{ id: string; startW: number; startX: number; startClientX: number; canvasWidth: number } | null>(null);

  // `cards`' own array order doubles as the stacking order — "bring to
  // front" (MoodboardPage.handleDragEnd) works by moving the just-touched
  // card to the end of that array. Originally this fed straight into
  // `cards.map(...)` below, so a bring-to-front reorder physically moved
  // that card's DOM node to a new position among its siblings. That's
  // harmless for a plain <img>/text card, but it silently breaks the 3D
  // display mode's live WebGL <canvas> — browsers don't reliably preserve a
  // WebGL context across a node being detached/reattached elsewhere in the
  // DOM (observed: the model went blank the instant a 3D-mode card was
  // dragged, i.e. the instant it got reordered to the front). So DOM order
  // is now kept stable per card (first-seen order, tracked in this ref) and
  // never changes; the *visual* stacking order still follows `cards`' array
  // order, just expressed as a z-index instead of DOM position.
  const domOrderRef = useRef<string[]>([]);
  const cardIds = new Set(cards.map((c) => c.id));
  domOrderRef.current = domOrderRef.current.filter((id) => cardIds.has(id));
  for (const card of cards) {
    if (!domOrderRef.current.includes(card.id)) domOrderRef.current.push(card.id);
  }
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const orderedCards = domOrderRef.current.map((id) => cardsById.get(id)!);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>, card: MoodboardCard) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: card.id, startX: card.x, startY: card.y, startClientX: e.clientX, startClientY: e.clientY, w: card.w };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!editable) return;
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas || !onMove) return;
    const rect = canvas.getBoundingClientRect();
    const dxPercent = ((e.clientX - drag.startClientX) / rect.width) * 100;
    const dyPercent = ((e.clientY - drag.startClientY) / rect.height) * 100;
    const nextX = clamp(drag.startX + dxPercent, 0, 100 - drag.w);
    const nextY = clamp(drag.startY + dyPercent, 0, 92);
    onMove(drag.id, nextX, nextY);
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>, card: MoodboardCard) {
    const drag = dragRef.current;
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    const moved = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) > TAP_THRESHOLD_PX;
    if (moved) {
      if (editable) onDragEnd?.(card.id);
    } else if (card.type === 'item') {
      onExpand?.(card);
    }
  }

  function angleFromCenter(centerX: number, centerY: number, clientX: number, clientY: number) {
    return Math.atan2(clientY - centerY, clientX - centerX) * (180 / Math.PI);
  }

  // The rotate handle is a small button pinned to the card's own corner (see
  // render below), so its parentElement is the card's outer positioned div —
  // used here purely to read the card's on-screen center, not for any of
  // the percentage/canvas math handleMove uses (rotation doesn't need the
  // canvas's bounding rect at all, just the card's own).
  function handleRotateStart(e: ReactPointerEvent<HTMLButtonElement>, card: MoodboardCard) {
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const cardEl = handle.parentElement;
    if (!cardEl) return;
    const rect = cardEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    rotateRef.current = {
      id: card.id,
      centerX,
      centerY,
      startAngle: angleFromCenter(centerX, centerY, e.clientX, e.clientY),
      startRotation: card.rotation,
    };
  }

  function handleRotateMove(e: ReactPointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const r = rotateRef.current;
    if (!r || !onRotate) return;
    const currentAngle = angleFromCenter(r.centerX, r.centerY, e.clientX, e.clientY);
    onRotate(r.id, r.startRotation + (currentAngle - r.startAngle));
  }

  function handleRotateEnd(e: ReactPointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const r = rotateRef.current;
    if (!r) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    rotateRef.current = null;
    onDragEnd?.(r.id);
  }

  // Resize only ever changes `w` (the card's own left/top anchor stays put)
  // — horizontal pointer travel converted to a percentage of the *canvas*
  // width, same conversion handlePointerMove already uses for x/y, just
  // applied to one axis. Height follows for free: item cards are a fixed
  // aspect-ratio square, text cards just reflow their textarea width.
  function handleResizeStart(e: ReactPointerEvent<HTMLButtonElement>, card: MoodboardCard) {
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const canvas = canvasRef.current;
    if (!canvas) return;
    resizeRef.current = {
      id: card.id,
      startW: card.w,
      startX: card.x,
      startClientX: e.clientX,
      canvasWidth: canvas.getBoundingClientRect().width,
    };
  }

  function handleResizeMove(e: ReactPointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const r = resizeRef.current;
    if (!r || !onResize || r.canvasWidth === 0) return;
    const dwPercent = ((e.clientX - r.startClientX) / r.canvasWidth) * 100;
    const maxW = Math.min(MAX_CARD_W, 100 - r.startX);
    onResize(r.id, clamp(r.startW + dwPercent, MIN_CARD_W, maxW));
  }

  function handleResizeEnd(e: ReactPointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const r = resizeRef.current;
    if (!r) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    resizeRef.current = null;
    onDragEnd?.(r.id);
  }

  return (
    <div
      ref={canvasRef}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: CANVAS_ASPECT_RATIO,
        background: backgroundColor ?? DEFAULT_MOODBOARD_BACKGROUND,
        border: '1px solid #444',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {cards.length === 0 && (
        <p style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 13, margin: 0 }}>
          {editable ? 'Add items or text below, then drag them into place.' : 'This board is empty.'}
        </p>
      )}
      {orderedCards.map((card) => (
        <div
          key={card.id}
          onPointerDown={(e) => handlePointerDown(e, card)}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => handlePointerUp(e, card)}
          style={{
            position: 'absolute',
            left: `${card.x}%`,
            top: `${card.y}%`,
            width: `${card.w}%`,
            // DOM order is now stable (see domOrderRef above) — this
            // z-index is what actually implements "bring to front" on top
            // of that, tracking `cards`' own (still-reorderable) array
            // order.
            zIndex: cards.findIndex((c) => c.id === card.id),
            // Rotating the same box that carries the remove/rotate handles
            // (rather than just an inner content wrapper) means the handles
            // swing around with the card as it tilts, matching how
            // selection handles behave in design tools — expected, not a
            // bug, when you're mid-drag on the rotate handle itself.
            transform: `rotate(${card.rotation}deg)`,
            touchAction: editable ? 'none' : undefined,
            cursor: editable ? 'grab' : card.type === 'item' ? 'pointer' : 'default',
            userSelect: 'none',
          }}
        >
          {editable && onRemove && (
            <button
              onClick={() => onRemove(card.id)}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: -10,
                right: -10,
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: 'none',
                background: '#c0392b',
                color: '#fff',
                fontSize: 12,
                lineHeight: '20px',
                padding: 0,
                cursor: 'pointer',
                zIndex: 2,
              }}
            >
              ×
            </button>
          )}
          {editable && onRotate && (
            <button
              onPointerDown={(e) => handleRotateStart(e, card)}
              onPointerMove={handleRotateMove}
              onPointerUp={handleRotateEnd}
              title="Drag to rotate"
              style={{
                position: 'absolute',
                top: -10,
                left: -10,
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: 'none',
                background: '#3a7bd5',
                color: '#fff',
                fontSize: 12,
                lineHeight: '20px',
                padding: 0,
                cursor: 'grab',
                touchAction: 'none',
                zIndex: 2,
              }}
            >
              ⟳
            </button>
          )}
          {editable && onResize && (
            <button
              onPointerDown={(e) => handleResizeStart(e, card)}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
              title="Drag to resize"
              style={{
                position: 'absolute',
                bottom: -10,
                right: -10,
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: 'none',
                background: '#2f9e5b',
                color: '#fff',
                fontSize: 11,
                lineHeight: '20px',
                padding: 0,
                cursor: 'nwse-resize',
                touchAction: 'none',
                zIndex: 2,
              }}
            >
              ⇲
            </button>
          )}
          {editable && onToggleDisplayMode && card.type === 'item' && card.modelUrl && (
            <button
              onClick={() => onToggleDisplayMode(card.id)}
              onPointerDown={(e) => e.stopPropagation()}
              title={card.displayMode === 'model' ? 'Show sticker' : 'Show 3D model'}
              style={{
                position: 'absolute',
                bottom: -10,
                left: -10,
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: 'none',
                background: '#8e44ad',
                color: '#fff',
                fontSize: 10,
                lineHeight: '20px',
                padding: 0,
                cursor: 'pointer',
                zIndex: 2,
              }}
            >
              {card.displayMode === 'model' ? '🖼' : '🧊'}
            </button>
          )}
          {card.type === 'item' ? (
            <div style={{ background: '#fff', borderRadius: 6, overflow: 'hidden', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
              {card.displayMode === 'model' && card.modelUrl ? (
                <div style={{ width: '100%', aspectRatio: '1' }}>
                  <ModelViewer url={modelProxyUrl(card.modelUrl)} interactive={false} height="100%" fallbackMessage="3D preview unavailable" />
                </div>
              ) : card.photoUrl ? (
                <img
                  src={card.photoUrl}
                  alt={card.name ?? ''}
                  draggable={false}
                  style={{ width: '100%', display: 'block', aspectRatio: '1', objectFit: 'cover' }}
                />
              ) : (
                <div style={{ width: '100%', aspectRatio: '1', background: '#ddd' }} />
              )}
              <div
                style={{
                  fontSize: 11,
                  padding: '4px 6px',
                  color: '#222',
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {card.name || 'Untitled item'}
              </div>
            </div>
          ) : (
            <div style={{ background: '#fff8dc', borderRadius: 6, boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
              {editable ? (
                <>
                  <div style={{ height: 14, background: 'rgba(0,0,0,0.08)', borderRadius: '6px 6px 0 0' }} />
                  <textarea
                    value={card.text ?? ''}
                    onChange={(e) => onTextChange?.(card.id, e.target.value)}
                    onBlur={() => onTextBlur?.()}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      display: 'block',
                      width: '100%',
                      minHeight: 60,
                      border: 'none',
                      background: 'transparent',
                      resize: 'vertical',
                      font: 'inherit',
                      fontSize: 12,
                      color: '#222',
                      padding: 8,
                      boxSizing: 'border-box',
                    }}
                  />
                </>
              ) : (
                <p style={{ fontSize: 12, color: '#222', padding: 8, margin: 0, whiteSpace: 'pre-wrap' }}>{card.text}</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
