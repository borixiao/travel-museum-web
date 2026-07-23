import { useRef, useState } from 'react';

/**
 * PRD 4.5 Item Detail Screen — "Original photos, swipeable". A native
 * scroll-snap carousel (not a JS drag library): each photo is full-width, one
 * per "page", and the browser's own touch-scroll physics handle the swipe —
 * works the same on a phone (finger swipe) or desktop (trackpad/scrollbar)
 * without any pointer-event plumbing of our own.
 */
export default function PhotoGallery({ photos }: { photos: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  function handleScroll() {
    const el = containerRef.current;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIndex(Math.min(photos.length - 1, Math.max(0, index)));
  }

  if (photos.length === 0) return null;

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          display: 'flex',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          borderRadius: 8,
          border: '1px solid #444',
        }}
      >
        {photos.map((url, i) => (
          <img
            key={i}
            src={url}
            alt={`Original photo ${i + 1} of ${photos.length}`}
            draggable={false}
            style={{
              scrollSnapAlign: 'start',
              flexShrink: 0,
              width: '100%',
              aspectRatio: '1',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ))}
      </div>

      {photos.length > 1 && (
        <>
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              fontSize: 11,
              color: '#fff',
              background: 'rgba(0,0,0,0.55)',
              borderRadius: 999,
              padding: '2px 8px',
            }}
          >
            {activeIndex + 1} / {photos.length}
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: 4,
            }}
          >
            {photos.map((_, i) => (
              <span
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: i === activeIndex ? '#6ea8ff' : 'rgba(255,255,255,0.5)',
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
