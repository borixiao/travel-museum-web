import type { CSSProperties } from 'react';

// Shared by ItemMetadataForm and LocationAutocomplete. Split into its own
// module (rather than exported from ItemMetadataForm.tsx) so the two
// components can import from each other without a circular dependency.
export const metadataInputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: 8,
  boxSizing: 'border-box',
  borderRadius: 4,
  border: '1px solid #555',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
};
