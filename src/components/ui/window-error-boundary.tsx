"use client";

// One window's crash stays in that window. Without this, an error thrown
// while rendering any window (a partial server answer, a bad stored row)
// reached the app's root error page and the whole app went blank: sidebar,
// Home and Chat with it. Mounted by AppModalShell around every window body.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "@/components/ui/empty-state";

type Props = { children: ReactNode; onClose?: () => void; resetKey?: unknown };
type State = { failed: boolean };

export class WindowErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("A window failed to render", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // Opening the window again starts it fresh.
    if (this.state.failed && prev.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-[260px] place-items-center p-6">
        <ErrorState
          title="This window ran into a problem"
          description="Nothing you made is lost. Try again, or close it and carry on."
          onRetry={() => this.setState({ failed: false })}
          action={
            this.props.onClose ? (
              <button
                type="button"
                onClick={this.props.onClose}
                className="inline-flex h-9 items-center rounded-full border border-[var(--ds-card-border)] px-4 text-sm font-medium"
              >
                Close
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }
}
