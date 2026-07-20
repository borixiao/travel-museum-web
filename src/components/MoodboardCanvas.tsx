import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MoodboardCard } from '../types';

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

export default function MoodboardCanvas({
  cards,
  editable,
  onMove,
  onDragEnd,
  onRemove,
  onTextChange,
  onTextBlur,
  onExpand,
}: {
  cards: MoodboardCard[];
  editable: boolean;
  onMove?: (id: string, x: number, y: number) => void;
  onDragEnd?: () => void;
  onRemove?: (id: string) => void;
  onTextChange?: (id: string, text: string) => void;
  onTextBlur?: () => void;
  onExpand?: (card: MoodboardCard) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; startClientX: number; startClientY: number; w: number } | null>(null);

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
      if (editable) onDragEnd?.();
    } else if (card.type === 'item') {
      onExpand?.(card);
    }
  }

  return (
    <div
      ref={canvasRef}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: CANVAS_ASPECT_RATIO,
        background: '#f4f1ea',
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
      {cards.map((card) => (
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
          {card.type === 'item' ? (
            <div style={{ background: '#fff', borderRadius: 6, overflow: 'hidden', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
              {card.photoUrl ? (
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
