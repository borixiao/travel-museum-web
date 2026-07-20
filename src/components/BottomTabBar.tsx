export interface TabDef {
  key: string;
  label: string;
  icon: string;
}

/**
 * Native-app-style bottom tab bar, fixed to the viewport bottom. Built to
 * test/validate mobile layout: content panes must leave enough bottom
 * padding (see App.tsx) so this never overlaps scrollable content.
 */
export default function BottomTabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly TabDef[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        background: '#1c1c1c',
        borderTop: '1px solid #333',
        // Respect iPhone home-indicator safe area so tabs aren't covered by it.
        paddingBottom: 'env(safe-area-inset-bottom)',
        zIndex: 20,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key as T)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              padding: '8px 4px 10px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: isActive ? '#6ea8ff' : '#888',
            }}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }}>{tab.icon}</span>
            <span style={{ fontSize: 11 }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
