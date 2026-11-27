// A page that throws while rendering must not blank the whole dashboard. The shell, the
// navigation and the agent console stay usable, and the error is shown, not swallowed.
import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("A page failed to render", error, info.componentStack);
  }

  componentDidUpdate(previous: { resetKey?: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="rounded-[10px] border border-critical/30 bg-critical-soft p-5 text-[13.5px] text-critical-text">
        <p className="text-[15px] font-semibold">This page could not be displayed</p>
        <p className="mt-1">{this.state.error.message}</p>
        <p className="mt-2 text-[12.5px]">Your data is unaffected. Choose another page from the menu, or reload. If it keeps happening, use Reset demo in the top bar.</p>
      </div>
    );
  }
}
