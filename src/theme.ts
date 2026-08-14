// Shared light/warm palette for the "Memory Museum" visual design, used as
// screens get restyled to match the design mockups. Plain constants (not a
// CSS-in-JS theme provider) to match this codebase's existing inline-style
// convention.
import type { CSSProperties } from 'react';

export const PAGE_BG = '#faf7f4';
export const CARD_BG = '#ffffff';
export const TEXT_PRIMARY = '#1c1917';
export const TEXT_MUTED = '#8a8078';
export const BORDER_LIGHT = '#e8e1d8';
export const ACCENT = '#a1552e';
export const PLACEHOLDER_BG = '#efe8df';

// Shared style for the small action-button rows used across the redesigned
// screens (Item Detail's Edit/Delete/etc., Profile's Save/Sign out) —
// replaces the browser's unstyled default buttons with a consistent
// primary/secondary/danger set instead of every screen inventing its own.
export function actionButtonStyle(variant: 'primary' | 'secondary' | 'danger', disabled = false): CSSProperties {
  const base: CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 14px',
    borderRadius: 10,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
  if (variant === 'primary') {
    return { ...base, border: 'none', background: ACCENT, color: '#fff' };
  }
  if (variant === 'danger') {
    return { ...base, border: '1px solid #e05555', background: CARD_BG, color: '#e05555' };
  }
  return { ...base, border: '1px solid ' + BORDER_LIGHT, background: CARD_BG, color: TEXT_PRIMARY };
}
