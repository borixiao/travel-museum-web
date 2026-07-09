import { ITEM_TYPES, EMOTION_TAGS, type ItemType, type EmotionTag, type ItemMetadata } from '../types';
import LocationAutocomplete from './LocationAutocomplete';
import { metadataInputStyle } from './formStyles';

export { metadataInputStyle };

/**
 * Shared form for the PRD's Add Item metadata fields (name/type/location/
 * date/story/emotion tags). Used both when creating a new item
 * (UploadPage) and when editing an existing one (HomePage detail view),
 * so the two stay in sync instead of drifting apart.
 */
export default function ItemMetadataForm({
  value,
  onChange,
  nameRequired,
}: {
  value: ItemMetadata;
  onChange: (next: ItemMetadata) => void;
  nameRequired?: boolean;
}) {
  function toggleTag(tag: EmotionTag) {
    const emotionTags = value.emotionTags.includes(tag)
      ? value.emotionTags.filter((t) => t !== tag)
      : [...value.emotionTags, tag];
    onChange({ ...value, emotionTags });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{ fontSize: 12, color: '#888' }}>
        Item name{nameRequired ? ' (required)' : ''}
        <input
          type="text"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="e.g. Eiffel Tower Keychain"
          style={metadataInputStyle}
        />
      </label>

      <label style={{ fontSize: 12, color: '#888' }}>
        Type
        <select value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value as ItemType })} style={metadataInputStyle}>
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label style={{ fontSize: 12, color: '#888' }}>
        Location (city, country)
        <LocationAutocomplete value={value.location} onChange={(location) => onChange({ ...value, location })} />
      </label>

      <label style={{ fontSize: 12, color: '#888' }}>
        Date acquired
        <input type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} style={metadataInputStyle} />
      </label>

      <label style={{ fontSize: 12, color: '#888' }}>
        Story / description
        <textarea
          value={value.story}
          onChange={(e) => onChange({ ...value, story: e.target.value })}
          rows={3}
          placeholder="What's the memory behind this souvenir?"
          style={{ ...metadataInputStyle, resize: 'vertical', font: 'inherit' }}
        />
      </label>

      <div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Emotion tags</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {EMOTION_TAGS.map((tag) => {
            const active = value.emotionTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 999,
                  border: active ? '1px solid #6ea8ff' : '1px solid #555',
                  background: active ? 'rgba(110, 168, 255, 0.15)' : 'transparent',
                  color: active ? '#6ea8ff' : '#888',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const emptyItemMetadata: ItemMetadata = {
  name: '',
  type: 'Other',
  location: '',
  date: '',
  story: '',
  emotionTags: [],
};
