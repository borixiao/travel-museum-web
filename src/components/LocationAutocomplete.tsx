import { useRef, useState } from 'react';
import { searchPlaces, type PlaceSuggestion } from '../services/places';
import { metadataInputStyle } from './formStyles';

/**
 * Instagram-style "type to search a place" field, backed by Google Places
 * Autocomplete (New) via our server proxy (server/index.js) so the billed
 * API key never reaches the browser.
 *
 * Deliberately does NOT auto-fill from GPS/EXIF or the browser's current
 * location — for this app, "location" means "where the item was acquired",
 * which is frequently NOT where/when the photo is actually taken (e.g. items
 * photographed at home after moving, long after the trip). Auto-detecting
 * would silently produce a wrong value more often than a right one, so the
 * user always types/picks it deliberately.
 */
export default function LocationAutocomplete({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);
  const requestIdRef = useRef(0);

  function handleInputChange(text: string) {
    onChange(text);
    setOpen(true);

    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    if (text.trim().length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const requestId = ++requestIdRef.current;
    debounceRef.current = window.setTimeout(async () => {
      try {
        const results = await searchPlaces(text);
        if (requestIdRef.current === requestId) setSuggestions(results);
      } catch {
        if (requestIdRef.current === requestId) setSuggestions([]);
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    }, 300);
  }

  function handleSelect(s: PlaceSuggestion) {
    onChange(s.secondaryText ? `${s.mainText}, ${s.secondaryText}` : s.mainText);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => setOpen(true)}
        // Delay closing so a click on a suggestion registers before the list unmounts.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search a city or country…"
        style={metadataInputStyle}
      />
      {open && (loading || suggestions.length > 0) && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: '#1c1c1c',
            border: '1px solid #444',
            borderRadius: 4,
            marginTop: 2,
            zIndex: 10,
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {loading && <div style={{ padding: 8, fontSize: 12, color: '#888' }}>Searching…</div>}
          {!loading &&
            suggestions.map((s) => (
              <div
                key={s.placeId}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(s)}
                style={{ padding: 8, fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #333' }}
              >
                <div style={{ color: '#ddd' }}>{s.mainText}</div>
                {s.secondaryText && <div style={{ fontSize: 11, color: '#888' }}>{s.secondaryText}</div>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
