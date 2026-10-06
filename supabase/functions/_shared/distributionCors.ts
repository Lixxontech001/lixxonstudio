export type OriginCheck = (origin: string | null) => boolean;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function distributionCorsHeaders(req: Request, isAllowed: OriginCheck): Record<string, string> | null {
  const origin = req.headers.get('Origin');
  if (!origin || !isAllowed(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Apikey, Content-Type, X-Client-Info, X-Supabase-Api-Version',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

export function distributionResponse(
  req: Request,
  body: unknown,
  status: number,
  isAllowed: OriginCheck,
): Response {
  const cors = distributionCorsHeaders(req, isAllowed);
  if (!cors) return new Response(JSON.stringify({ error: 'Origin is not allowed.' }), { status: 403, headers: JSON_HEADERS });
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...cors } });
}

export function distributionPreflight(req: Request, isAllowed: OriginCheck): Response {
  const cors = distributionCorsHeaders(req, isAllowed);
  return cors
    ? new Response(null, { status: 204, headers: cors })
    : new Response(null, { status: 403, headers: JSON_HEADERS });
}
