import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_PERMISSIONS } from '../admin/permissions';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const NAV = read('src/context/NavigationContext.tsx');
const APP = read('src/admin/AdminApp.tsx');
const LAYOUT = read('src/admin/AdminLayout.tsx');
const MINDS = read('src/admin/pages/AdminMinds.tsx');

describe('Connections is one Admin page under Minds, not a tab', () => {
  it('the address /admin/ai/connections opens the Connections route, and /admin/ai still opens Minds', () => {
    expect(NAV).toContain("if (parts[1] === 'ai' && parts[2] === 'connections') return { name: 'admin-connections' };");
    expect(NAV).toContain("if (parts[1] === 'ai') return { name: 'admin-ai' };");
    expect(NAV).toContain("case 'admin-connections': return '/admin/ai/connections';");
    expect(NAV.indexOf("parts[2] === 'connections'")).toBeLessThan(NAV.indexOf("if (parts[1] === 'ai') return { name: 'admin-ai' };"));
  });

  it('the Admin app renders the Connections page lazily', () => {
    expect(APP).toContain("const AdminConnections = lazy(() => import('./pages/AdminConnections'));");
    expect(APP).toContain("case 'admin-connections':");
  });

  it('only the owner permission gates it, the same one the Keys page uses', () => {
    expect(ROUTE_PERMISSIONS['admin-connections']).toBe('automation.keys');
    expect(ROUTE_PERMISSIONS['admin-automation-keys']).toBe('automation.keys');
  });

  it('the sidebar has no Connections tab: Minds stays the one AI entry', () => {
    expect(LAYOUT).not.toMatch(/label:\s*'Connections'/);
    expect(LAYOUT).toContain("{ label: 'Minds', route: { name: 'admin-ai' }");
  });

  it('the Minds page links to Connections with a plain link to the address', () => {
    expect(MINDS).toContain('href="/admin/ai/connections"');
    expect(MINDS).toContain('>Connections</a>');
  });
});
