export type DistributionAdapterChannel =
  | 'instagram' | 'facebook' | 'youtube_shorts' | 'tiktok' | 'pinterest' | 'telegram'
  | 'threads' | 'linkedin' | 'x' | 'tumblr' | 'whatsapp' | 'newsletter' | 'site_widget';

export interface DistributionCredentials {
  [name: string]: string | undefined;
}

export interface ReadbackRequest {
  url: string;
  init: RequestInit;
  expectedResourceId?: string;
  parseTelegramChat?: boolean;
}

export type SafeProviderStatus = 'connected' | 'blocked_by_provider_review' | 'quota_exhausted' | 'not_configured' | 'unavailable';
export type SafeProviderCode =
  | 'PROVIDER_READBACK_OK' | 'PROVIDER_AUTH' | 'PROVIDER_REVIEW_REQUIRED'
  | 'PROVIDER_QUOTA' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_NOT_CONFIGURED' | 'PROVIDER_UNEXPECTED';

const GUARDED_GET: Pick<RequestInit, 'method' | 'cache' | 'redirect' | 'referrerPolicy'> = {
  method: 'GET', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
};
const bearer = (token: string) => ({ Accept: 'application/json', Authorization: `Bearer ${token}` });
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
const credential = (credentials: DistributionCredentials, name: string): string | null => {
  const value = credentials[name]?.trim();
  return value && value.length <= 10000 && !hasControlCharacters(value) ? value : null;
};

/** Return one bounded, read-only request; unsupported or paid-risk channels stay manual. */
export function buildDistributionReadback(
  channel: DistributionAdapterChannel,
  credentials: DistributionCredentials,
): ReadbackRequest | null {
  const meta = credential(credentials, 'meta_access_token');
  const threads = credential(credentials, 'threads_access_token');
  switch (channel) {
    case 'instagram': {
      const id = credential(credentials, 'instagram_user_id');
      return meta && id ? {
        url: `https://graph.facebook.com/v23.0/${encodeURIComponent(id)}?fields=id,username`,
        expectedResourceId: id,
        init: { ...GUARDED_GET, headers: bearer(meta) },
      } : null;
    }
    case 'facebook': {
      const id = credential(credentials, 'facebook_page_id');
      return meta && id ? {
        url: `https://graph.facebook.com/v23.0/${encodeURIComponent(id)}?fields=id,name`,
        expectedResourceId: id,
        init: { ...GUARDED_GET, headers: bearer(meta) },
      } : null;
    }
    case 'threads': {
      const id = credential(credentials, 'threads_user_id');
      return threads && id ? {
        url: `https://graph.threads.net/v1.0/${encodeURIComponent(id)}?fields=id,username`,
        expectedResourceId: id,
        init: { ...GUARDED_GET, headers: bearer(threads) },
      } : null;
    }
    case 'tiktok': {
      const token = credential(credentials, 'tiktok_access_token');
      return token ? {
        url: 'https://open.tiktokapis.com/v2/user/info/?fields=open_id',
        init: { ...GUARDED_GET, headers: bearer(token) },
      } : null;
    }
    case 'pinterest': {
      const token = credential(credentials, 'pinterest_access_token');
      const board = credential(credentials, 'pinterest_board_id');
      return token && board ? {
        url: `https://api.pinterest.com/v5/boards/${encodeURIComponent(board)}`,
        expectedResourceId: board,
        init: { ...GUARDED_GET, headers: bearer(token) },
      } : null;
    }
    case 'telegram': {
      const token = credential(credentials, 'telegram_bot_token');
      const chat = credential(credentials, 'telegram_chat_id');
      return token && /^[0-9]{5,15}:[A-Za-z0-9_-]{20,128}$/.test(token) && chat && /^-?[0-9]{1,32}$/.test(chat) ? {
        // Telegram requires the bot token in its URL path; the endpoint is fixed HTTPS and response is never returned.
        url: `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chat)}`,
        init: { ...GUARDED_GET, headers: { Accept: 'application/json' } },
        parseTelegramChat: true,
      } : null;
    }
    case 'linkedin': {
      const token = credential(credentials, 'linkedin_access_token');
      const organization = credential(credentials, 'linkedin_organization_id');
      return token && organization ? {
        url: `https://api.linkedin.com/v2/organizations/${encodeURIComponent(organization)}`,
        expectedResourceId: organization,
        init: { ...GUARDED_GET, headers: { ...bearer(token), 'X-Restli-Protocol-Version': '2.0.0' } },
      } : null;
    }
    case 'whatsapp': {
      const token = credential(credentials, 'whatsapp_access_token');
      const phoneId = credential(credentials, 'whatsapp_phone_number_id');
      return token && phoneId ? {
        url: `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneId)}?fields=id,verified_name,display_phone_number`,
        expectedResourceId: phoneId,
        init: { ...GUARDED_GET, headers: bearer(token) },
      } : null;
    }
    case 'newsletter': {
      const token = credential(credentials, 'resend_api_key');
      return token ? { url: 'https://api.resend.com/domains', init: { ...GUARDED_GET, headers: bearer(token) } } : null;
    }
    // YouTube requires a paired OAuth refresh and is handled by the bounded helper in the Edge Function.
    // X API may consume paid credit, Tumblr needs signed OAuth 1.0a, and video upload is a later gated step.
    case 'youtube_shorts':
    case 'x':
    case 'tumblr':
    case 'site_widget':
      return null;
  }
}

export function classifyReadbackStatus(status: number): { status: SafeProviderStatus; code: SafeProviderCode } {
  if (status >= 200 && status < 300) return { status: 'connected', code: 'PROVIDER_READBACK_OK' };
  if (status === 401) return { status: 'blocked_by_provider_review', code: 'PROVIDER_AUTH' };
  if (status === 403) return { status: 'blocked_by_provider_review', code: 'PROVIDER_REVIEW_REQUIRED' };
  if (status === 429) return { status: 'quota_exhausted', code: 'PROVIDER_QUOTA' };
  if (status >= 500 || status === 408) return { status: 'unavailable', code: 'PROVIDER_UNAVAILABLE' };
  return { status: 'unavailable', code: 'PROVIDER_UNEXPECTED' };
}

/** Treat HTTP 2xx as a connection only when the provider confirms the expected account resource. */
export async function parseDistributionReadback(
  channel: DistributionAdapterChannel,
  response: Response,
  expectedResourceId?: string,
): Promise<{ status: SafeProviderStatus; code: SafeProviderCode }> {
  if (!response.ok) return classifyReadbackStatus(response.status);
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > 16_384) {
    try { await response.body?.cancel(); } catch { /* discard oversized provider body */ }
    return { status: 'unavailable', code: 'PROVIDER_UNEXPECTED' };
  }
  const reader = response.body?.getReader();
  if (!reader) return { status: 'unavailable', code: 'PROVIDER_UNEXPECTED' };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); return { status: 'unavailable', code: 'PROVIDER_UNEXPECTED' }; }
      chunks.push(value);
    }
  } catch { return { status: 'unavailable', code: 'PROVIDER_UNAVAILABLE' }; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid response');
    const body = payload as Record<string, unknown>;
    const error = body.error && typeof body.error === 'object' && !Array.isArray(body.error)
      ? body.error as Record<string, unknown> : null;
    if (error && !(channel === 'tiktok' && error.code === 'ok')) {
      const providerCode = String(error.code || '').toLowerCase();
      if (providerCode === '190' || providerCode.includes('token_invalid') || providerCode.includes('unauthorized')) {
        return { status: 'blocked_by_provider_review', code: 'PROVIDER_AUTH' };
      }
      if (providerCode === '10' || providerCode === '200' || providerCode.includes('permission') || providerCode.includes('scope')) {
        return { status: 'blocked_by_provider_review', code: 'PROVIDER_REVIEW_REQUIRED' };
      }
      return { status: 'unavailable', code: 'PROVIDER_UNEXPECTED' };
    }
    const idMatches = typeof body.id === 'string' || typeof body.id === 'number'
      ? expectedResourceId !== undefined && String(body.id) === expectedResourceId
      : false;
    const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? body.data as Record<string, unknown> : null;
    const user = data?.user && typeof data.user === 'object' && !Array.isArray(data.user)
      ? data.user as Record<string, unknown> : null;
    const tiktokError = body.error && typeof body.error === 'object' && !Array.isArray(body.error)
      ? body.error as Record<string, unknown> : null;
    const tiktokOk = !tiktokError || tiktokError.code === 'ok';
    const confirmed = channel === 'newsletter'
      ? Array.isArray(body.data) && body.data.some((domain: unknown) => Boolean(
          domain && typeof domain === 'object' && !Array.isArray(domain)
          && (domain as Record<string, unknown>).status === 'verified'
          && typeof (domain as Record<string, unknown>).name === 'string'
          && ((domain as Record<string, unknown>).name as string).length > 0,
        ))
      : channel === 'tiktok'
        ? tiktokOk && typeof user?.open_id === 'string' && user.open_id.length > 0
        : ['instagram', 'facebook', 'threads', 'pinterest', 'linkedin', 'whatsapp'].includes(channel) && idMatches;
    if (channel === 'newsletter' && !confirmed) {
      return { status: 'blocked_by_provider_review', code: 'PROVIDER_REVIEW_REQUIRED' };
    }
    return confirmed
      ? { status: 'connected', code: 'PROVIDER_READBACK_OK' }
      : { status: 'unavailable', code: 'PROVIDER_UNEXPECTED' };
  } catch { return { status: 'unavailable', code: 'PROVIDER_UNEXPECTED' }; }
}

export function readbackForMissingCredentials(): { status: 'not_configured'; code: 'PROVIDER_NOT_CONFIGURED' } {
  return { status: 'not_configured', code: 'PROVIDER_NOT_CONFIGURED' };
}

export interface TelegramReceipt {
  ok: boolean;
  remoteMessageId: string | null;
  safeStatus: SafeProviderStatus;
  safeCode: SafeProviderCode;
}

/** Verify the configured chat with Telegram's read-only getChat API; discard all account details. */
export async function parseTelegramChatReadback(response: Response, expectedChatId: string): Promise<{ status: SafeProviderStatus; code: SafeProviderCode }> {
  if (!response.ok) return classifyReadbackStatus(response.status);
  const reader = response.body?.getReader();
  if (!reader) return { status: 'unavailable', code: 'PROVIDER_UNEXPECTED' };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); return { status: 'unavailable', code: 'PROVIDER_UNEXPECTED' }; }
      chunks.push(value);
    }
  } catch { return { status: 'unavailable', code: 'PROVIDER_UNAVAILABLE' }; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid response');
    const body = payload as Record<string, unknown>;
    const chat = body.result && typeof body.result === 'object' && !Array.isArray(body.result)
      ? body.result as Record<string, unknown> : null;
    if (body.ok === true && chat && String(chat.id) === expectedChatId) return { status: 'connected', code: 'PROVIDER_READBACK_OK' };
    if (body.error_code === 401) return { status: 'blocked_by_provider_review', code: 'PROVIDER_AUTH' };
    if (body.error_code === 403) return { status: 'blocked_by_provider_review', code: 'PROVIDER_REVIEW_REQUIRED' };
    if (body.error_code === 429) return { status: 'quota_exhausted', code: 'PROVIDER_QUOTA' };
    return { status: 'unavailable', code: 'PROVIDER_UNEXPECTED' };
  } catch { return { status: 'unavailable', code: 'PROVIDER_UNEXPECTED' }; }
}

/** Parse only the Telegram receipt fields required for idempotent confirmation. Never returns message text. */
export async function parseTelegramReceipt(response: Response, expectedChatId: string): Promise<TelegramReceipt> {
  if (!response.ok) {
    const classified = classifyReadbackStatus(response.status);
    return { ok: false, remoteMessageId: null, safeStatus: classified.status, safeCode: classified.code };
  }
  const reader = response.body?.getReader();
  if (!reader) return { ok: false, remoteMessageId: null, safeStatus: 'unavailable', safeCode: 'PROVIDER_UNEXPECTED' };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        return { ok: false, remoteMessageId: null, safeStatus: 'unavailable', safeCode: 'PROVIDER_UNEXPECTED' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, remoteMessageId: null, safeStatus: 'unavailable', safeCode: 'PROVIDER_UNAVAILABLE' };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid response');
    const body = payload as Record<string, unknown>;
    const result = body.result && typeof body.result === 'object' && !Array.isArray(body.result)
      ? body.result as Record<string, unknown> : null;
    const chat = result?.chat && typeof result.chat === 'object' && !Array.isArray(result.chat)
      ? result.chat as Record<string, unknown> : null;
    const messageId = result?.message_id;
    if (body.ok === true && Number.isInteger(messageId) && (messageId as number) > 0
        && chat && String(chat.id) === expectedChatId) {
      return { ok: true, remoteMessageId: String(messageId), safeStatus: 'connected', safeCode: 'PROVIDER_READBACK_OK' };
    }
    const errorCode = body.error_code;
    if (errorCode === 401) return { ok: false, remoteMessageId: null, safeStatus: 'blocked_by_provider_review', safeCode: 'PROVIDER_AUTH' };
    if (errorCode === 403) return { ok: false, remoteMessageId: null, safeStatus: 'blocked_by_provider_review', safeCode: 'PROVIDER_REVIEW_REQUIRED' };
    if (errorCode === 429) return { ok: false, remoteMessageId: null, safeStatus: 'quota_exhausted', safeCode: 'PROVIDER_QUOTA' };
    return { ok: false, remoteMessageId: null, safeStatus: 'unavailable', safeCode: 'PROVIDER_UNEXPECTED' };
  } catch {
    return { ok: false, remoteMessageId: null, safeStatus: 'unavailable', safeCode: 'PROVIDER_UNEXPECTED' };
  }
}

/** Resend's accepted email ID is a receipt; response bodies and recipient data stay server-side. */
export async function parseResendReceipt(response: Response): Promise<TelegramReceipt> {
  if (!response.ok) {
    const classified = classifyReadbackStatus(response.status);
    return { ok: false, remoteMessageId: null, safeStatus: classified.status, safeCode: classified.code };
  }
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > 16_384) {
    try { await response.body?.cancel(); } catch { /* discard oversized provider receipt */ }
    return { ok: false, remoteMessageId: null, safeStatus: 'unavailable', safeCode: 'PROVIDER_UNEXPECTED' };
  }
  const reader = response.body?.getReader();
  if (!reader) return { ok: false, remoteMessageId: null, safeStatus: 'unavailable', safeCode: 'PROVIDER_UNEXPECTED' };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        return { ok: false, remoteMessageId: null, safeStatus: 'unavailable', safeCode: 'PROVIDER_UNEXPECTED' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, remoteMessageId: null, safeStatus: 'unavailable', safeCode: 'PROVIDER_UNAVAILABLE' };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid receipt');
    const id = (payload as Record<string, unknown>).id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(id)) throw new Error('missing receipt id');
    return { ok: true, remoteMessageId: id, safeStatus: 'connected', safeCode: 'PROVIDER_READBACK_OK' };
  } catch {
    return { ok: false, remoteMessageId: null, safeStatus: 'unavailable', safeCode: 'PROVIDER_UNEXPECTED' };
  }
}
