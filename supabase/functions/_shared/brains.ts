// Buddy's eight brains: the try order and the Vault names for each brain's key. Pure data, no network.
// Thinking walks this list in order (slice 2 wires that). Each key is saved the same way as the other
// Connections keys: one Vault entry per name, shown as "Saved" or "Not saved", never echoed back.
// A brain marked "skip" keeps its slot, but Buddy does not try it, because the provider now needs a card or is paid.
// GitHub Models and Bytez are not brains. Mistral is not a workhorse here.

export const BRAIN_IDS = [
  "gemini",
  "groq",
  "nvidia",
  "cloudflare",
  "openrouter",
  "cerebras",
  "huggingface",
  "deepseek",
] as const;

export type BrainId = (typeof BRAIN_IDS)[number];

/** "free_no_card": Buddy may try it. "skip": the slot exists, Buddy does not try it until the provider is free again. */
export type BrainAccess = "free_no_card" | "skip";

export interface BrainSlot {
  id: BrainId;
  /** 1 is tried first. The order is fixed in code, not a drag list. */
  order: number;
  /** Owner-facing name. Plain words only. */
  label: string;
  /** One plain sentence on what this brain is for. */
  purpose: string;
  access: BrainAccess;
  /** One plain sentence on the free access, for the Brains page and Buddy's how-to. */
  accessNote: string;
  /** The website where the owner makes the key. Shown in Buddy's how-to. Domain only, no deep link. */
  keySite: string;
  /** The Vault name for the main key. Matches automation_secret_catalog.secret_name. */
  secretName: string;
  /** Other Vault names this brain needs (for example Cloudflare's account ID). */
  extraSecretNames: readonly string[];
  /** The OpenAI-style base URL. Null for Gemini, which keeps its own Google path. */
  baseUrl: string | null;
  /** The model name sent to that provider. If a provider drops it ("model gone"), the chain moves to the next brain. */
  model: string;
}

export const BRAIN_SLOTS: readonly BrainSlot[] = [
  {
    id: "gemini",
    order: 1,
    label: "Google Gemini",
    purpose: "Buddy's first brain. Google's own model.",
    access: "free_no_card",
    accessNote: "Google's free tier. No card needed.",
    keySite: "aistudio.google.com",
    secretName: "gemini_api_key",
    extraSecretNames: [],
    baseUrl: null,
    model: "gemini-3.8-flash",
  },
  {
    id: "groq",
    order: 2,
    label: "Groq",
    purpose: "A fast free brain. Used when Google is full.",
    access: "free_no_card",
    accessNote: "Free tier with a request-per-minute limit. No card needed.",
    keySite: "console.groq.com",
    secretName: "groq_api_key",
    extraSecretNames: [],
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
  },
  {
    id: "nvidia",
    order: 3,
    label: "NVIDIA NIM",
    purpose: "A free brain with many open models. Used when the first two are full.",
    access: "free_no_card",
    accessNote: "Free credits from build.nvidia.com. No card needed; some accounts need a phone check.",
    keySite: "build.nvidia.com",
    secretName: "nvidia_api_key",
    extraSecretNames: [],
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "meta/llama-3.3-70b-instruct",
  },
  {
    id: "cloudflare",
    order: 4,
    label: "Cloudflare Workers AI",
    purpose: "A free daily allowance of AI on Cloudflare. Needs the account ID as well as the token.",
    access: "free_no_card",
    accessNote: "A free daily allowance on the Workers free plan. No card needed.",
    keySite: "dash.cloudflare.com",
    secretName: "cloudflare_api_token",
    extraSecretNames: ["cloudflare_account_id"],
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    model: "@cf/openai/gpt-oss-120b",
  },
  {
    id: "openrouter",
    order: 5,
    label: "OpenRouter (free models)",
    purpose: "Only the models marked free. Buddy never uses a paid model here.",
    access: "free_no_card",
    accessNote: "Free models with a daily limit. No card needed.",
    keySite: "openrouter.ai",
    secretName: "openrouter_api_key",
    extraSecretNames: [],
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-oss-120b:free",
  },
  {
    id: "cerebras",
    order: 6,
    label: "Cerebras",
    purpose: "Skipped for now. Cerebras asks for a card before its trial.",
    access: "skip",
    accessNote: "Cerebras asks for a payment card before its trial, so Buddy skips it until it is free again.",
    keySite: "cloud.cerebras.ai",
    secretName: "cerebras_api_key",
    extraSecretNames: [],
    baseUrl: "https://api.cerebras.ai/v1",
    model: "llama3.1-8b",
  },
  {
    id: "huggingface",
    order: 7,
    label: "Hugging Face",
    purpose: "A small free monthly credit. Used near the end of the list.",
    access: "free_no_card",
    accessNote: "A small free monthly credit. No card needed.",
    keySite: "huggingface.co",
    secretName: "huggingface_token",
    extraSecretNames: [],
    baseUrl: "https://router.huggingface.co/v1",
    model: "zai-org/GLM-5.3-Flash",
  },
  {
    id: "deepseek",
    order: 8,
    label: "DeepSeek",
    purpose: "Skipped for now. Its API is paid and has no free tier to rely on.",
    access: "skip",
    accessNote: "The DeepSeek API is paid and has no published free tier, so Buddy skips it.",
    keySite: "platform.deepseek.com",
    secretName: "deepseek_api_key",
    extraSecretNames: [],
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
  },
];

/** Every Vault name the brains use, in try order, the main name first for each brain. */
export function brainSecretNames(): string[] {
  return BRAIN_SLOTS.flatMap((slot) => [slot.secretName, ...slot.extraSecretNames]);
}

/**
 * True when at least one tryable brain has all of its Vault entries saved: its main key, and any extra it needs
 * (Cloudflare needs its account ID too). Takes the names the Vault reports as saved. Never sees a key value.
 */
export function anyTryableBrainConfigured(savedNames: ReadonlySet<string>): boolean {
  return tryableBrains().some((slot) => savedNames.has(slot.secretName) && slot.extraSecretNames.every((name) => savedNames.has(name)));
}

/** The brains Buddy may try, in order. Skipped brains are left out. */
export function tryableBrains(): BrainSlot[] {
  return BRAIN_SLOTS.filter((slot) => slot.access === "free_no_card");
}
