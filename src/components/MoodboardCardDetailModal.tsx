import ModelViewer from './ModelViewer';
import { modelProxyUrl } from '../services/tripoClient';
import type { MoodboardCard } from '../types';

/**
 * "Tap a card to expand full detail + 3D viewer" (PRD 4.8 Public Moodboard
 * View). Shared between the editor (MoodboardPage) and the public read-only
 * viewer (MoodboardViewPage) — both render it the same way, driven entirely
 * by whatever was snapshotted onto the card when it was added, since the
 * public viewer never has access to the live `items` collection.
 */
export default function MoodboardCardDetailModal({ card, onClose }: { card: MoodboardCard; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1a1a1a',
          borderRadius: 10,
          maxWidth: 480,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>{card.name || 'Untitled item'}</h2>
          <button onClick={onClose}>Close</button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: '#888' }}>
          {card.itemType && (
            <span style={{ border: '1px solid #555', borderRadius: 999, padding: '2px 8px' }}>{card.itemType}</span>
          )}
          {card.location && <span>📍 {card.location}</span>}
          {card.date && <span>📅 {card.date}</span>}
        </div>

        {card.emotionTags && card.emotionTags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {card.emotionTags.map((tag) => (
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

        {card.story && <p style={{ marginTop: 8, fontSize: 13, color: '#aaa' }}>{card.story}</p>}

        <div style={{ marginTop: 12 }}>
          {card.modelUrl ? (
            <ModelViewer
              url={modelProxyUrl(card.modelUrl)}
              fallbackMessage="This 3D model is no longer available."
            />
          ) : card.photoUrl ? (
            <img src={card.photoUrl} alt={card.name ?? ''} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
          ) : (
            <p style={{ fontSize: 12, color: '#888' }}>No preview available for this item.</p>
          )}
        </div>
      </div>
    </div>
  );
}
