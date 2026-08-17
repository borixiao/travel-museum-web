// Design tokens for the "Memory Museum" visual design, copied verbatim from
// the design team's handoff (brand-spec.md v1.2 / memory-museum-ui-v1.html's
// :root) rather than approximated from screenshots. The spec explicitly
// calls for OKLCH used directly at runtime ("统一使用 OKLCH，不直接散落原始
// 色值") rather than converting to hex, so these are plain CSS color strings,
// not hex — they work as-is in any `style={{ color: ... }}` value.
import type { CSSProperties } from 'react';

export const BG = 'oklch(98.4% 0.007 260.7)';
export const SURFACE = 'oklch(100% 0 89.9)';
export const FG = 'oklch(21.3% 0.008 264.4)';
export const MUTED = 'oklch(52.2% 0.003 48.7)';
export const BORDER = 'oklch(93.1% 0.004 157.2)';
export const ACCENT = 'oklch(46.9% 0.100 42.5)';

// Derived via the same color-mix() recipes as the spec, rather than
// hand-picked approximations, so they track BG/SURFACE/MUTED/ACCENT if those
// ever change.
export const SOFT = `color-mix(in oklch, ${MUTED} 6%, ${SURFACE})`;
export const ACCENT_SOFT = `color-mix(in oklch, ${ACCENT} 13%, ${SURFACE})`;
export const SHADOW = `0 24px 70px color-mix(in oklch, ${MUTED} 11%, transparent)`;

// The app-wide "ambient light" background — three low-contrast radial
// washes (cool blue upper-left, faint mint right, warm yellow lower-left)
// over the near-white BG. This is deliberately the only large-area color
// accent in the whole product (brand-spec.md §视觉语言规则 1) — content
// (photos/stickers/3D objects) is supposed to carry color, not chrome.
export const AMBIENT =
  'radial-gradient(ellipse 78% 58% at 2% 22%, oklch(96.8% 0.018 252.8 / .82), transparent 72%), ' +
  'radial-gradient(ellipse 72% 55% at 98% 46%, oklch(96.6% 0.028 162.5 / .72), transparent 70%), ' +
  'radial-gradient(ellipse 68% 48% at 10% 80%, oklch(97% 0.024 106.6 / .58), transparent 70%)';

export const RADIUS = 20;

export const FONT_DISPLAY = "'New York', 'Iowan Old Style', Charter, Georgia, serif";
export const FONT_BODY = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', sans-serif";
export const FONT_MONO = "'SFMono-Regular', 'SF Mono', ui-monospace, monospace";

/** A page's outer container background — near-white base + the ambient wash. */
export const pageBackground: CSSProperties = {
  backgroundColor: BG,
  backgroundImage: AMBIENT,
};

/** Small uppercase mono label (spec's `.eyebrow`) — dates, counts, overline
 *  labels, technical/status metadata. Never for headings — those are Display. */
export const eyebrowStyle: CSSProperties = {
  color: MUTED,
  font: `11px ${FONT_MONO}`,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
};

/** The recurring dotted "board" texture (spec's `.board-dots` /
 *  `.memory-preview.board-dots`) — used behind scan targets, collection
 *  preview cards, and the account card. `opacity` is the dot's color-mix
 *  percentage into transparent (spec varies this 34–45% by context). */
export function dotsBackground(opacity = 34, size = 18): CSSProperties {
  return {
    backgroundColor: SOFT,
    backgroundImage: `radial-gradient(circle, color-mix(in oklch, ${MUTED} ${opacity}%, transparent) 1px, transparent 1.3px)`,
    backgroundSize: `${size}px ${size}px`,
  };
}

/** Filter/jump chip pill (spec's `.memory-filter`). */
export function chipStyle(active: boolean): CSSProperties {
  return {
    flexShrink: 0,
    minHeight: 36,
    padding: '7px 13px',
    borderRadius: 999,
    border: '1px solid ' + (active ? FG : BORDER),
    background: active ? FG : SURFACE,
    color: active ? SURFACE : MUTED,
    fontSize: 12,
    fontWeight: 680,
    cursor: 'pointer',
  };
}

/** Primary/secondary/danger action button (spec's `.btn`/`.btn-primary`/
 *  `.btn-secondary`). Danger has no equivalent in the design system (delete
 *  in the prototype is a hold-and-confirm gesture, not a red button) — kept
 *  as a plain semantic red rather than left unstyled. */
export function actionButtonStyle(variant: 'primary' | 'secondary' | 'danger', disabled = false): CSSProperties {
  const base: CSSProperties = {
    minHeight: 48,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 18px',
    borderRadius: 14,
    fontWeight: 680,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  };
  if (variant === 'primary') {
    return { ...base, border: '1px solid transparent', background: ACCENT, color: SURFACE };
  }
  if (variant === 'danger') {
    return { ...base, border: '1px solid oklch(58% 0.19 25)', background: SURFACE, color: 'oklch(58% 0.19 25)' };
  }
  return { ...base, border: '1px solid ' + BORDER, background: SURFACE, color: FG };
}
