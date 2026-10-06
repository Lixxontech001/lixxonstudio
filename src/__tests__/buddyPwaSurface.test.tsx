import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BuddyPwaApp from '../buddy/BuddyPwaApp';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { id: 'owner-1' } },
    loading: false,
    isAdmin: true,
    refreshAdmin: vi.fn(),
    can: (permission: string) => permission === 'automation.check',
  }),
}));
vi.mock('../admin/MfaGate', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../lib/supabaseClient', () => ({ supabase: { rpc: vi.fn().mockResolvedValue({ data: { status: 'active' }, error: null }) } }));

describe('Buddy safe PWA surface', () => {
  it('renders a review-only command queue and explains the offline boundary', () => {
    const markup = renderToStaticMarkup(<BuddyPwaApp />);
    expect(markup).toContain('Safe command queue');
    expect(markup).toContain('Nothing runs automatically after reconnecting');
    expect(markup).toContain('a first launch with no network is not guaranteed');
    expect(markup).toContain('External actions are not available through Buddy yet');
    expect(markup).toContain('grant admin access');
    expect(markup).toContain('/admin/automation/distribution');
  });
});
