import Icon from './Icon';
import { SURFACE, FG, MUTED, ACCENT, BORDER } from '../theme';

export interface TabDef {
  key: string;
  label: string;
  /** Icon.tsx name, not emoji — see the design handoff's tabbar()/icon(). */
  icon: 'home' | 'box' | 'person';
}

/**
 * Floating dock matching the design handoff's `.bottom-dock` — a rounded
 * glassy bar of regular tabs plus a separate solid-accent scan button,
 * rather than a single flush-to-edge row. Approximated (no multi-layer
 * gradient/inset-shadow glass effect), not a literal CSS port.
 */
export default function BottomTabBar<T extends string>({
  tabs,
  active,
  onChange,
  onScan,
}: {
  tabs: readonly TabDef[];
  active: T;
  onChange: (key: T) => void;
  onScan: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        left: 10,
        right: 10,
        bottom: 10,
        maxWidth: 620,
        margin: '0 auto',
        height: 72,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 72px',
        gap: 10,
        zIndex: 35,
      }}
    >
      <nav
        style={{
          minWidth: 0,
          height: 72,
          padding: '7px 10px',
          display: 'grid',
          gridTemplateColumns: `repeat(${tabs.length}, 1fr)`,
          gap: 5,
          border: '1px solid ' + BORDER,
          borderRadius: 24,
          background: `color-mix(in oklch, ${SURFACE} 88%, transparent)`,
          backdropFilter: 'blur(24px) saturate(160%)',
          boxShadow: '0 14px 30px rgba(0,0,0,0.10)',
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              onClick={() => onChange(tab.key as T)}
              style={{
                minHeight: 56,
                borderRadius: 16,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                fontSize: 10,
                background: isActive ? `color-mix(in oklch, ${MUTED} 14%, transparent)` : 'none',
                border: 'none',
                cursor: 'pointer',
                color: isActive ? FG : MUTED,
              }}
            >
              <Icon name={tab.icon} size={20} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
      <button
        onClick={onScan}
        aria-label="Scan a photo"
        style={{
          width: 72,
          height: 72,
          borderRadius: 24,
          border: '1px solid ' + ACCENT,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          background: ACCENT,
          color: SURFACE,
          fontSize: 10,
          fontWeight: 680,
          cursor: 'pointer',
          boxShadow: '0 7px 16px color-mix(in oklch, ' + ACCENT + ' 25%, transparent)',
        }}
      >
        <Icon name="camera" size={22} />
        <span>Scan</span>
      </button>
    </div>
  );
}
