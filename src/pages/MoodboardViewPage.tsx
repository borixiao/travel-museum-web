import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPublishedMoodboard } from '../services/moodboard';
import MoodboardCanvas from '../components/MoodboardCanvas';
import MoodboardCardDetailModal from '../components/MoodboardCardDetailModal';
import type { Moodboard, MoodboardCard } from '../types';

/**
 * Public, unauthenticated viewer for a published moodboard — reached via the
 * shareable `/m/:moodboardId` link (PRD: "publish a public link"). Rendered
 * outside the logged-in tab shell in App.tsx, since a visitor opening this
 * link won't have (or need) an account.
 */
export default function MoodboardViewPage() {
  const { moodboardId } = useParams<{ moodboardId: string }>();
  const [moodboard, setMoodboard] = useState<Moodboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCard, setExpandedCard] = useState<MoodboardCard | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!moodboardId) {
      setLoading(false);
      return;
    }
    getPublishedMoodboard(moodboardId).then((board) => {
      if (cancelled) return;
      setMoodboard(board);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [moodboardId]);

  if (loading) return <p style={{ textAlign: 'center', marginTop: 40 }}>Loading…</p>;

  if (!moodboard) {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', color: '#888', padding: '0 16px' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
        <h1 style={{ fontSize: 18, color: '#ddd' }}>Board not found</h1>
        <p style={{ fontSize: 13, marginTop: 8 }}>This link is invalid, or the board hasn't been published (yet).</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '24px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 20 }}>{moodboard.title}</h1>
      <MoodboardCanvas
        cards={moodboard.cards}
        backgroundColor={moodboard.backgroundColor}
        editable={false}
        onExpand={setExpandedCard}
      />
      {expandedCard && <MoodboardCardDetailModal card={expandedCard} onClose={() => setExpandedCard(null)} />}
    </div>
  );
}
