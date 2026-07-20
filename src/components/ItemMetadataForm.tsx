import { useState } from 'react';
import { ITEM_TYPE_PRESETS, CUSTOM_ITEM_TYPE, EMOTION_TAGS, type EmotionTag, type ItemMetadata } from '../types';
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
  // Whether the current type is a free-typed custom value rather than one of
  // the presets. Initialized once from the incoming value (e.g. an existing
  // item's saved type) and only flipped afterwards by explicit user action —
  // this component remounts fresh whenever the parent switches which item
  // it's editing (see HomePage's conditional render), so this stays in sync.
  const [customType, setCustomType] = useState(() => !ITEM_TYPE_PRESETS.some((p) => p.value === value.type));

  function toggleTag(tag: EmotionTag) {
    const emotionTags = value.emotionTags.includes(tag)
      ? value.emotionTags.filter((t) => t !== tag)
      : [...value.emotionTags, tag];
    onChange({ ...value, emotionTags });
  }

  function handleTypeSelect(next: string) {
    if (next === CUSTOM_ITEM_TYPE) {
      setCustomType(true);
      onChange({ ...value, type: '' });
    } else {
      setCustomType(false);
      onChange({ ...value, type: next });
    }
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
        <select
          value={customType ? CUSTOM_ITEM_TYPE : value.type}
          onChange={(e) => handleTypeSelect(e.target.value)}
          style={metadataInputStyle}
        >
          {ITEM_TYPE_PRESETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
          <option value={CUSTOM_ITEM_TYPE}>Custom… (自訂類別)</option>
        </select>
        {customType && (
          <input
            type="text"
            value={value.type}
            onChange={(e) => onChange({ ...value, type: e.target.value })}
            placeholder="Type your own category… (自訂類別名稱)"
            style={{ ...metadataInputStyle, marginTop: 6 }}
          />
        )}
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
