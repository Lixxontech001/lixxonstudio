// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import NetworkStatusBanner from '../components/NetworkStatusBanner';
import RouteErrorBoundary from '../components/RouteErrorBoundary';
import { reportRequestError } from '../lib/requestStatus';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
let routeShouldThrow = true;

function mount(children: ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(children); });
}

function FailingRoute() {
  if (routeShouldThrow) throw new Error('render failed');
  return <p>Recovered route content</p>;
}

function RouteHarness() {
  const [route, setRoute] = useState('broken');
  return (
    <>
      <button type="button" onClick={() => setRoute('healthy')}>Navigate to healthy route</button>
      <RouteErrorBoundary key={route}>
        {route === 'broken' ? <FailingRoute /> : <p>Healthy route content</p>}
      </RouteErrorBoundary>
    </>
  );
}

beforeEach(() => {
  document.body.innerHTML = '';
  routeShouldThrow = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  vi.restoreAllMocks();
});

describe('network recovery banner', () => {
  it('stays hidden while healthy and announces offline/online changes', () => {
    mount(<NetworkStatusBanner onRetry={() => undefined} />);
    expect(host.querySelector('[role="status"]')).toBeNull();

    act(() => { window.dispatchEvent(new Event('offline')); });
    const offlineStatus = host.querySelector('[role="status"]');
    expect(offlineStatus?.textContent).toContain('You’re offline');
    expect(offlineStatus?.querySelector('.container-wide')?.className).toContain('flex-col');
    expect(host.querySelector('button')).toBeNull();

    act(() => { window.dispatchEvent(new Event('online')); });
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('shows an accessible request error with a mobile-sized retry control', () => {
    const onRetry = vi.fn();
    mount(<NetworkStatusBanner onRetry={onRetry} />);
    expect(host.querySelector('[role="alert"]')).toBeNull();

    act(() => { reportRequestError('supabase'); });

    const alert = host.querySelector('[role="alert"]');
    const retry = host.querySelector('button');
    expect(alert?.textContent).toContain('We couldn’t load some data');
    expect(alert?.getAttribute('aria-live')).toBe('assertive');
    expect(retry?.className).toContain('min-h-11');
    expect(retry?.className).toContain('w-full');

    act(() => { retry?.click(); });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(retry?.textContent).toContain('Retrying');
    expect(retry?.disabled).toBe(true);
  });
});

describe('route error boundary', () => {
  it('contains render errors and lets the user retry the route', () => {
    mount(
      <RouteErrorBoundary>
        <FailingRoute />
      </RouteErrorBoundary>,
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('This page hit a snag');

    routeShouldThrow = false;
    const retry = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Try this page again'));
    act(() => { retry?.click(); });

    expect(host.textContent).toContain('Recovered route content');
  });

  it('resets its failure state when navigation changes the route key', () => {
    mount(<RouteHarness />);
    expect(host.textContent).toContain('This page hit a snag');

    const navigate = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Navigate to healthy route'));
    act(() => { navigate?.click(); });

    expect(host.textContent).toContain('Healthy route content');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
