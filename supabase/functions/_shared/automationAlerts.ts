import { distributionFailureMessage, type DistributionFailureClass } from './distributionSafety.ts';

interface AutomationAlertClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALERTABLE_CODES = new Set([
  "PREFLIGHT_INVALID",
  "GITHUB_TOKEN_MISSING", "GITHUB_AUTH", "GITHUB_FORBIDDEN", "GITHUB_RATE_LIMITED",
  "GITHUB_UNAVAILABLE", "GITHUB_UNEXPECTED", "GITHUB_NETWORK_ERROR",
  "APPROVAL_REVOKED", "POST_MISSING", "SOURCE_HASH_FAILED", "SOURCE_EMPTY", "SOURCE_CHANGED",
  "METADATA_INVALID", "UNSAFE_LINKS", "RUNNER_STEP_FAILED", "RUNNER_DATABASE_UNAVAILABLE",
  "VIDEO_RENDERER_NOT_READY",
]);
const OWNER_RUNS_URL = "https://lixxonstudio.com/admin/automation/runs";
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };
const TIMEOUT_MS = 8_000;

type AlertEvent = "dispatch_failed" | "pipeline_failed";
type AlertChannel = "email" | "telegram" | "none";

interface ClaimedFailure {
  run_id: string;
  safe_error_code: string;
  event: AlertEvent;
}

export interface AutomationAlertDelivery {
  runId: string;
  event: AlertEvent;
  channel: AlertChannel;
  delivered: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validFailure(value: unknown): value is ClaimedFailure {
  if (!isRecord(value) || typeof value.run_id !== "string" || !RUN_ID_RE.test(value.run_id)) return false;
  if (typeof value.safe_error_code !== "string" || !ALERTABLE_CODES.has(value.safe_error_code)) return false;
  return value.event === "dispatch_failed" || value.event === "pipeline_failed";
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

async function getInternalSecret(sb: AutomationAlertClient, name: string): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc("automation_secret_get_internal", { p_secret_name: name });
    return !error && typeof data === "string" && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

async function logDelivery(
  sb: AutomationAlertClient,
  runId: string,
  status: "succeeded" | "failed" | "blocked",
  channel: "email" | "telegram" | "none",
): Promise<void> {
  try {
    await sb.rpc("automation_write_log", {
      p_event_code: "ALERT.DELIVERY",
      p_status: status,
      p_entity_type: "article_run",
      p_entity_id: runId,
      // Safe allow-listed metadata only: no address, provider response or secret.
      p_details: { run_id: runId, step: "failure_alert", channel },
    });
  } catch {
    // Delivery remains best-effort; never turn a provider outcome into a response/log leak.
  }
}

async function requestStatus(fetcher: typeof fetch, url: string, init: RequestInit): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response | null = null;
  try {
    response = await fetcher(url, { ...init, signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    try { await response?.body?.cancel(); } catch { /* Provider bodies are never read or logged. */ }
  }
}

async function deliverFailure(
  sb: AutomationAlertClient,
  failure: ClaimedFailure,
  fetcher: typeof fetch,
): Promise<AutomationAlertDelivery> {
  const { run_id: runId, event, safe_error_code: errorCode } = failure;
  const eventDescription = event === "dispatch_failed"
    ? "The scheduled article run could not be started by GitHub Actions."
    : "The article automation stopped safely before publishing.";
  const subject = `[Lixxon Studio] Automation ${event === "dispatch_failed" ? "dispatch" : "pipeline"} failure`;
  const text = [
    eventDescription,
    `Safe failure code: ${errorCode}`,
    `Run ID: ${runId}`,
    `Owner run monitor: ${OWNER_RUNS_URL}`,
    "No article prose, credentials, or provider response was included.",
  ].join("\n");
  const html = `<p>${htmlEscape(eventDescription)}</p><p>Safe failure code: <code>${htmlEscape(errorCode)}</code></p><p>Run ID: <code>${htmlEscape(runId)}</code></p><p><a href="${OWNER_RUNS_URL}">Open the owner run monitor</a></p><p>No article prose, credentials, or provider response was included.</p>`;

  let emailDelivered = false;
  let emailAttempted = false;
  let owners: string[] = [];
  try {
    const { data, error } = await sb.rpc("automation_alert_recipients");
    if (!error && Array.isArray(data)) {
      owners = data.slice(0, 5).flatMap((row: unknown) => {
        if (!isRecord(row) || typeof row.email !== "string") return [];
        const address = row.email.trim().toLowerCase();
        return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(address) ? [address] : [];
      });
    }
  } catch {
    owners = [];
  }

  if (owners.length > 0) {
    const emailKey = await getInternalSecret(sb, "resend_api_key");
    if (emailKey && emailKey.length <= 10000 && !/[\r\n]/.test(emailKey)) {
      const configuredFrom = Deno.env.get("EMAIL_FROM") || "Lixxon Studio <onboarding@resend.dev>";
      const from = configuredFrom.length <= 200 && !/[\r\n]/.test(configuredFrom)
        ? configuredFrom
        : "Lixxon Studio <onboarding@resend.dev>";
      emailAttempted = true;
      const outcomes = await Promise.all(owners.map(address => requestStatus(fetcher, "https://api.resend.com/emails", {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${emailKey}` },
        body: JSON.stringify({ from, to: [address], subject, text, html }),
      })));
      emailDelivered = outcomes.some(Boolean);
    }
  }

  if (emailDelivered) {
    await logDelivery(sb, runId, "succeeded", "email");
    return { runId, event, channel: "email", delivered: true };
  }
  if (emailAttempted) await logDelivery(sb, runId, "failed", "email");

  const botToken = await getInternalSecret(sb, "telegram_bot_token");
  const chatId = await getInternalSecret(sb, "telegram_chat_id");
  if (botToken && /^[0-9]{5,15}:[A-Za-z0-9_-]{20,128}$/.test(botToken)
      && chatId && /^-?[0-9]{1,32}$/.test(chatId)) {
    const telegramText = `${eventDescription}\nSafe failure code: ${errorCode}\nRun ID: ${runId}\n${OWNER_RUNS_URL}`;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const delivered = await requestStatus(fetcher, url, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: JSON_HEADERS,
      body: JSON.stringify({ chat_id: chatId, text: telegramText, disable_web_page_preview: true }),
    });
    await logDelivery(sb, runId, delivered ? "succeeded" : "failed", "telegram");
    return { runId, event, channel: delivered ? "telegram" : "none", delivered };
  }

  await logDelivery(sb, runId, emailAttempted ? "failed" : "blocked", "none");
  return { runId, event, channel: "none", delivered: false };
}

/** Claim only terminal, safe failures in SQL, then use email with private-chat Telegram fallback. */
export async function deliverPendingAutomationFailureAlerts(
  sb: AutomationAlertClient,
  fetcher: typeof fetch = fetch,
): Promise<AutomationAlertDelivery[]> {
  let rows: unknown[];
  try {
    const response = await sb.rpc("automation_claim_failure_alerts", { p_limit: 2 });
    if (response.error || !Array.isArray(response.data)) return [];
    rows = response.data;
  } catch {
    return [];
  }
  const results: AutomationAlertDelivery[] = [];
  for (const row of rows) {
    if (!validFailure(row)) continue;
    try {
      results.push(await deliverFailure(sb, row, fetcher));
    } catch {
      await logDelivery(sb, row.run_id, "failed", "none");
      results.push({ runId: row.run_id, event: row.event, channel: "none", delivered: false });
    }
  }
  return results;
}

interface ClaimedDistributionFailureAlert {
  alert_id: number;
  channel_key: string;
  failure_class: DistributionFailureClass;
  safe_error_code: string;
  attempt_count: number;
}

export interface DistributionFailureAlertDelivery {
  alertId: number;
  channel: AlertChannel;
  failureClass: DistributionFailureClass;
  delivered: boolean;
}

const DISTRIBUTION_CHANNEL_LABELS: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook Pages', youtube_shorts: 'YouTube Shorts',
  tiktok: 'TikTok', pinterest: 'Pinterest', telegram: 'Telegram', threads: 'Threads',
  linkedin: 'LinkedIn', x: 'X', tumblr: 'Tumblr', whatsapp: 'WhatsApp',
  newsletter: 'Email test', site_widget: 'Site widget',
};
const DISTRIBUTION_FAILURE_CLASSES = new Set<DistributionFailureClass>([
  'quota', 'authentication', 'policy', 'transient',
]);
const DISTRIBUTION_KIT_URL = 'https://lixxonstudio.com/admin/automation/distribution';

function validDistributionFailure(value: unknown): value is ClaimedDistributionFailureAlert {
  if (!isRecord(value) || !Number.isSafeInteger(value.alert_id) || (value.alert_id as number) < 1
      || typeof value.channel_key !== 'string' || !Object.hasOwn(DISTRIBUTION_CHANNEL_LABELS, value.channel_key)
      || typeof value.failure_class !== 'string' || !DISTRIBUTION_FAILURE_CLASSES.has(value.failure_class as DistributionFailureClass)
      || typeof value.safe_error_code !== 'string' || !/^[A-Z0-9_.:-]{1,64}$/.test(value.safe_error_code)
      || !Number.isInteger(value.attempt_count) || (value.attempt_count as number) < 1 || (value.attempt_count as number) > 3) return false;
  return true;
}

async function deliverDistributionFailureAlert(
  sb: AutomationAlertClient,
  failure: ClaimedDistributionFailureAlert,
  fetcher: typeof fetch,
): Promise<DistributionFailureAlertDelivery> {
  const channelLabel = DISTRIBUTION_CHANNEL_LABELS[failure.channel_key];
  const plainMessage = distributionFailureMessage(channelLabel, failure.failure_class);
  const subject = `[Lixxon Studio] ${channelLabel} distribution paused`;
  const text = [plainMessage, `Safe status: ${failure.safe_error_code}`, `Daily Distribution Kit: ${DISTRIBUTION_KIT_URL}`].join('\n');
  const html = `<p>${htmlEscape(plainMessage)}</p><p>Safe status: <code>${htmlEscape(failure.safe_error_code)}</code></p><p><a href="${DISTRIBUTION_KIT_URL}">Open the Daily Distribution Kit</a></p><p>No article prose, customer data, credentials or provider response was included.</p>`;

  let owners: string[] = [];
  try {
    const { data, error } = await sb.rpc('automation_alert_recipients');
    if (!error && Array.isArray(data)) {
      owners = data.slice(0, 5).flatMap((row: unknown) => {
        if (!isRecord(row) || typeof row.email !== 'string') return [];
        const address = row.email.trim().toLowerCase();
        return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(address) ? [address] : [];
      });
    }
  } catch { owners = []; }

  let emailAttempted = false;
  let delivered = false;
  if (owners.length > 0) {
    const emailKey = await getInternalSecret(sb, 'resend_api_key');
    if (emailKey && emailKey.length <= 10000 && !/[\r\n]/.test(emailKey)) {
      const configuredFrom = typeof Deno !== 'undefined' ? Deno.env.get('EMAIL_FROM') || 'Lixxon Studio <onboarding@resend.dev>' : 'Lixxon Studio <onboarding@resend.dev>';
      const from = configuredFrom.length <= 200 && !/[\r\n]/.test(configuredFrom)
        ? configuredFrom : 'Lixxon Studio <onboarding@resend.dev>';
      emailAttempted = true;
      const outcomes = await Promise.all(owners.map(address => requestStatus(fetcher, 'https://api.resend.com/emails', {
        method: 'POST', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${emailKey}` },
        body: JSON.stringify({ from, to: [address], subject, text, html }),
      })));
      delivered = outcomes.some(Boolean);
    }
  }

  let deliveryChannel: AlertChannel = delivered ? 'email' : 'none';
  if (!delivered) {
    const botToken = await getInternalSecret(sb, 'telegram_bot_token');
    const chatId = await getInternalSecret(sb, 'telegram_chat_id');
    if (botToken && /^[0-9]{5,15}:[A-Za-z0-9_-]{20,128}$/.test(botToken)
        && chatId && /^-?[0-9]{1,32}$/.test(chatId)) {
      const telegramText = `${plainMessage}\nSafe status: ${failure.safe_error_code}\n${DISTRIBUTION_KIT_URL}`;
      delivered = await requestStatus(fetcher, `https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: JSON_HEADERS,
        body: JSON.stringify({ chat_id: chatId, text: telegramText, disable_web_page_preview: true }),
      });
      if (delivered) deliveryChannel = 'telegram';
    }
  }

  try {
    await sb.rpc('automation_complete_distribution_failure_alert', {
      p_alert_id: failure.alert_id,
      p_status: delivered ? 'delivered' : emailAttempted ? 'failed' : 'blocked',
      p_delivery_channel: deliveryChannel,
    });
  } catch { /* The channel's plain-English state reason remains visible in the Daily Kit. */ }
  return { alertId: failure.alert_id, channel: deliveryChannel, failureClass: failure.failure_class, delivered };
}

/** Deliver deduplicated distribution blocks to active owners; never include post or customer data. */
export async function deliverPendingDistributionFailureAlerts(
  sb: AutomationAlertClient,
  fetcher: typeof fetch = fetch,
): Promise<DistributionFailureAlertDelivery[]> {
  let rows: unknown[];
  try {
    const response = await sb.rpc('automation_claim_distribution_failure_alerts', { p_limit: 5 });
    if (response.error || !Array.isArray(response.data)) return [];
    rows = response.data;
  } catch { return []; }
  const results: DistributionFailureAlertDelivery[] = [];
  for (const row of rows) {
    if (!validDistributionFailure(row)) continue;
    try { results.push(await deliverDistributionFailureAlert(sb, row, fetcher)); }
    catch {
      try {
        await sb.rpc('automation_complete_distribution_failure_alert', {
          p_alert_id: row.alert_id, p_status: 'failed', p_delivery_channel: 'none',
        });
      } catch { /* Keep the queue and safe UI reason for a later attempt. */ }
      results.push({ alertId: row.alert_id, channel: 'none', failureClass: row.failure_class, delivered: false });
    }
  }
  return results;
}
