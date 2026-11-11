import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Called once per caught error; wire to the main-process logger. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Name of the renderer ("assistant", "settings"...) shown in diagnostics. */
  scope: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Global error boundary for each renderer: never leave a blank window. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="bk-glass mx-auto flex max-w-md flex-col items-center gap-3 rounded-card p-6 text-center text-fg"
      >
        <h2 className="text-base font-semibold">Something went wrong</h2>
        <p className="text-sm text-fg-muted">
          Beekeeper hit an unexpected problem in the {this.props.scope} window. Your data is safe.
        </p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
