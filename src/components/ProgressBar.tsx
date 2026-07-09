/**
 * Visual progress bar used for the generation status. When `progress` is
 * omitted (e.g. during the brief "uploading" phase where Tripo hasn't
 * reported a percentage yet), it renders an indeterminate animated stripe
 * instead of a stuck-at-0 bar.
 */
export default function ProgressBar({ progress }: { progress?: number }) {
  const indeterminate = progress === undefined;
  const pct = Math.max(0, Math.min(100, progress ?? 0));

  return (
    <div
      style={{
        width: '100%',
        height: 8,
        borderRadius: 999,
        background: '#2a2a2a',
        overflow: 'hidden',
        marginTop: 6,
      }}
    >
      <style>{`
        @keyframes progress-bar-indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
      `}</style>
      {indeterminate ? (
        <div
          style={{
            width: '40%',
            height: '100%',
            borderRadius: 999,
            background: '#6ea8ff',
            animation: 'progress-bar-indeterminate 1.2s ease-in-out infinite',
          }}
        />
      ) : (
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 999,
            background: '#6ea8ff',
            transition: 'width 0.3s ease',
          }}
        />
      )}
    </div>
  );
}
