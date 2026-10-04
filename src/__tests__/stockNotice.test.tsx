// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { StockNotice } from '../components/shop/ProductExtras';
import type { Product } from '../lib/types';

const { submitForm } = vi.hoisted(() => ({ submitForm: vi.fn() }));
vi.mock('../lib/api', () => ({
  submitForm,
  ApiError: class ApiError extends Error {},
}));
vi.mock('../hooks/useV3', () => ({
  useBundlesForProduct: () => ({ bundles: [] }),
  useCurrencyRates: () => ({}),
}));
vi.mock('../context/CartContext', () => ({ useCart: () => ({ items: [], addItem: vi.fn() }) }));
vi.mock('../context/NavigationContext', () => ({ Link: ({ children }: { children: unknown }) => children }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  localStorage.clear();
  submitForm.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

it('requires explicit one-time consent and submits the alert through the server form', async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const product = { id: '10000000-0000-0000-0000-000000000001', stock_status: 'out_of_stock' } as unknown as Product;
  act(() => { root?.render(<StockNotice product={product} />); });

  const email = host.querySelector<HTMLInputElement>('input[type="email"]');
  const consent = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  const button = host.querySelector<HTMLButtonElement>('button[type="submit"]');
  const form = host.querySelector<HTMLFormElement>('form');
  expect(email ? host.querySelector(`label[for="${email.id}"]`)?.textContent : null).toBe('Email address');
  expect(consent?.checked).toBe(false);
  expect(button?.disabled).toBe(true);
  expect(host.textContent).toContain('This alert will not sign me up for the newsletter.');

  act(() => {
    if (email) { email.value = 'reader@example.com'; Simulate.change(email); }
    if (consent) { consent.checked = true; Simulate.change(consent); }
  });
  expect(button?.disabled).toBe(false);

  await act(async () => {
    if (form) Simulate.submit(form);
    await Promise.resolve();
  });

  expect(submitForm).toHaveBeenCalledWith('restock_notify', {
    product_id: product.id,
    email: 'reader@example.com',
    consent: true,
  });
  expect(host.querySelector('[role="status"]')?.textContent).toContain('one email');
});
