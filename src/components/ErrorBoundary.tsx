"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional extra label shown in the fallback, e.g. "the GitHub panel". */
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render-time errors in the subtree below it so one broken component
 * (a bad markdown parse, an unexpected API shape, etc.) shows a small recovery
 * card instead of taking down the entire chat UI. Must be a class component —
 * error boundaries have no hook equivalent in React.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
          <div className="w-10 h-10 rounded-full bg-red-950 light:bg-red-100 flex items-center justify-center text-red-400 light:text-red-600 text-lg">
            !
          </div>
          <div>
            <p className="text-zinc-200 light:text-zinc-800 text-sm font-medium">
              Something went wrong{this.props.fallbackLabel ? ` in ${this.props.fallbackLabel}` : ""}.
            </p>
            <p className="text-zinc-500 light:text-zinc-500 text-xs mt-1 max-w-sm">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
          </div>
          <button
            onClick={this.reset}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 light:bg-zinc-200 text-zinc-200 light:text-zinc-800 hover:bg-zinc-700 light:hover:bg-zinc-300 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
