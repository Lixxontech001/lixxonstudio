import { Component, type ReactNode } from 'react';

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

/** Keep render failures inside the current route instead of blanking the full app shell. */
export default class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main role="alert" aria-live="assertive" className="container-narrow w-full px-4 py-12 text-center sm:py-16">
        <div className="border border-bronze/40 bg-taupe-light/30 p-5 sm:p-8">
          <p className="text-[10px] tracking-ultra-wide uppercase text-bronze mb-3">Page unavailable</p>
          <h1 className="font-serif text-2xl text-charcoal sm:text-3xl">This page hit a snag</h1>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-muted">
            Your other pages are still available. Try this page again or reload it.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="btn-bronze min-h-11 w-full px-5 py-3 text-xs uppercase tracking-editorial sm:w-auto"
            >
              Try this page again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-outline-luxury min-h-11 w-full px-5 py-3 text-xs uppercase tracking-editorial sm:w-auto"
            >
              Reload page
            </button>
          </div>
        </div>
      </main>
    );
  }
}
