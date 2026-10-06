import { describe, expect, it } from 'vitest';
import {
  distributionCorsHeaders,
  distributionPreflight,
  distributionResponse,
} from '../../supabase/functions/_shared/distributionCors';

const allowed = (origin: string | null) => origin === 'https://lixxonstudio.com';

describe('distribution Edge Function CORS', () => {
  it('answers an allowed browser preflight with the exact origin and required headers', async () => {
    const req = new Request('https://project.supabase.co/functions/v1/automation-distribution', {
      method: 'OPTIONS', headers: { Origin: 'https://lixxonstudio.com' },
    });
    const response = distributionPreflight(req, allowed);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://lixxonstudio.com');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Apikey');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-Client-Info');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(await response.text()).toBe('');
  });

  it('fails closed for missing or disallowed origins without wildcard CORS', () => {
    for (const origin of [null, 'https://evil.example']) {
      const headers = origin ? { Origin: origin } : undefined;
      const req = new Request('https://project.supabase.co/functions/v1/automation-distribution', {
        method: 'OPTIONS', headers,
      });
      const response = distributionPreflight(req, allowed);
      expect(response.status).toBe(403);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(response.headers.get('Access-Control-Allow-Headers')).toBeNull();
    }
  });

  it('uses the same injected origin policy for JSON responses and preflight', async () => {
    const req = new Request('https://project.supabase.co/functions/v1/automation-distribution', {
      method: 'POST', headers: { Origin: 'https://lixxonstudio.com' },
    });
    const cors = distributionCorsHeaders(req, allowed);
    const response = distributionResponse(req, { ok: true }, 200, allowed);
    expect(cors?.['Access-Control-Allow-Origin']).toBe('https://lixxonstudio.com');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(cors?.['Access-Control-Allow-Origin']);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.json()).toEqual({ ok: true });

    const deniedReq = new Request('https://project.supabase.co/functions/v1/automation-distribution', {
      method: 'POST', headers: { Origin: 'https://evil.example' },
    });
    expect(distributionResponse(deniedReq, { ok: true }, 200, allowed).status).toBe(403);
  });
});
