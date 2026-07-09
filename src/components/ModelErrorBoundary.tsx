import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Custom user-facing message. Falls back to showing the raw error detail if omitted. */
  fallbackMessage?: string;
}

interface State {
  error: Error | null;
}

export default class ModelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[ModelViewer] failed to load model:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ width: '100%', height: 480, background: '#fff', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', color: '#888', padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ color: '#333', fontWeight: 600 }}>
            {this.props.fallbackMessage ?? 'Failed to load model'}
          </div>
          <div style={{ fontSize: 12, color: '#aaa' }}>{this.state.error.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}
