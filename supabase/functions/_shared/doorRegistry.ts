// The twelve auto posting doors Buddy can post through: the six from Phase 5 and six from Phase 6.
// Pure data and rules, no network. The four gated channels (Instagram, TikTok, Facebook, Pinterest) are NOT doors.
// Buddy never posts to them.
// Each field's secret name must exist in the secret catalogue (migrations 20261005090000, 20261011090000 and 20261011130000).
// Saved values are never shown again. A door is "connected" only when every field is saved. That is not a live test.
// A door whose send step is not built yet is listed here and on Connections, but it is not in OPEN_DOORS (doorPosts.ts),
// so the day run never sends to it.

export const DOOR_IDS = [
  "telegram",
  "bluesky",
  "mastodon",
  "tumblr",
  "discord",
  "blogger",
  "medium",
  "youtube",
  "pixelfed",
  "wordpress_com",
  "podcast",
  "vimeo",
] as const;
export type DoorId = (typeof DOOR_IDS)[number];

export interface DoorField {
  /** The catalogue name the value is saved under. */
  secretName: string;
  /** Plain owner-facing label. */
  label: string;
  /** "secret": a token or password, typed in a hidden field. "identifier": a name or ID, typed in a plain field. */
  kind: "secret" | "identifier";
}

export interface DoorSpec {
  id: DoorId;
  label: string;
  /** One plain sentence for the owner. */
  summary: string;
  fields: readonly DoorField[];
}

export const DOORS: Readonly<Record<DoorId, DoorSpec>> = {
  telegram: {
    id: "telegram",
    label: "Telegram",
    summary: "Posts to a Telegram channel you run.",
    fields: [
      { secretName: "telegram_bot_token", label: "Bot token", kind: "secret" },
      { secretName: "telegram_chat_id", label: "Channel or chat ID", kind: "identifier" },
    ],
  },
  bluesky: {
    id: "bluesky",
    label: "Bluesky",
    summary: "Posts to your Bluesky account.",
    fields: [
      { secretName: "bluesky_handle", label: "Handle", kind: "identifier" },
      { secretName: "bluesky_app_password", label: "App password", kind: "secret" },
    ],
  },
  mastodon: {
    id: "mastodon",
    label: "Mastodon",
    summary: "Posts to your Mastodon account.",
    fields: [
      { secretName: "mastodon_instance_url", label: "Server address", kind: "identifier" },
      { secretName: "mastodon_access_token", label: "Access token", kind: "secret" },
    ],
  },
  tumblr: {
    id: "tumblr",
    label: "Tumblr",
    summary: "Posts to your Tumblr blog.",
    fields: [
      { secretName: "tumblr_consumer_key", label: "Consumer key", kind: "secret" },
      { secretName: "tumblr_consumer_secret", label: "Consumer secret", kind: "secret" },
      { secretName: "tumblr_access_token", label: "Access token", kind: "secret" },
      { secretName: "tumblr_token_secret", label: "Token secret", kind: "secret" },
      { secretName: "tumblr_blog_name", label: "Blog name", kind: "identifier" },
    ],
  },
  discord: {
    id: "discord",
    label: "Discord",
    summary: "Posts to one Discord channel through its webhook.",
    fields: [{ secretName: "discord_webhook_url", label: "Webhook address", kind: "secret" }],
  },
  blogger: {
    id: "blogger",
    label: "Blogger",
    summary: "Posts to your Blogger blog.",
    fields: [
      { secretName: "blogger_client_id", label: "Client ID", kind: "identifier" },
      { secretName: "blogger_client_secret", label: "Client secret", kind: "secret" },
      { secretName: "blogger_refresh_token", label: "Refresh token", kind: "secret" },
      { secretName: "blogger_blog_id", label: "Blog ID", kind: "identifier" },
    ],
  },
  medium: {
    id: "medium",
    label: "Medium",
    summary: "Posts to your Medium account. Medium no longer issues new tokens, so this works only with a token you already have.",
    fields: [{ secretName: "medium_integration_token", label: "Integration token", kind: "secret" }],
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    summary: "Uploads your short vertical videos to your YouTube channel. No video, no upload.",
    fields: [
      { secretName: "youtube_client_id", label: "Client ID", kind: "identifier" },
      { secretName: "youtube_client_secret", label: "Client secret", kind: "secret" },
      { secretName: "youtube_refresh_token", label: "Refresh token", kind: "secret" },
    ],
  },
  pixelfed: {
    id: "pixelfed",
    label: "Pixelfed",
    summary: "Posts photos to your Pixelfed account.",
    fields: [
      { secretName: "pixelfed_instance_url", label: "Server address", kind: "identifier" },
      { secretName: "pixelfed_access_token", label: "Access token", kind: "secret" },
    ],
  },
  wordpress_com: {
    id: "wordpress_com",
    label: "WordPress.com",
    summary: "Posts a short note with a link back to your article on your WordPress.com site.",
    fields: [
      { secretName: "wordpress_com_site", label: "Site address", kind: "identifier" },
      { secretName: "wordpress_com_access_token", label: "Access token", kind: "secret" },
    ],
  },
  podcast: {
    id: "podcast",
    label: "Podcast",
    summary: "Adds each episode, with its real audio file, to your podcast feed. Apple Podcasts and Spotify read it once you submit the feed yourself.",
    fields: [
      { secretName: "podcast_show_title", label: "Show title", kind: "identifier" },
      { secretName: "podcast_show_author", label: "Show author (a public name, not an email address)", kind: "identifier" },
      { secretName: "podcast_cover_url", label: "Cover picture address (square, 1400 to 3000 pixels)", kind: "identifier" },
    ],
  },
  vimeo: {
    id: "vimeo",
    label: "Vimeo",
    summary: "Uploads your short vertical videos to your Vimeo account. No video, no upload.",
    fields: [{ secretName: "vimeo_access_token", label: "Access token", kind: "secret" }],
  },
};

export type DoorState = "connected" | "partly" | "not_connected";

export interface DoorStatus {
  state: DoorState;
  /** Labels of the fields not saved yet, in order. */
  missing: string[];
}

/** Own-property check, so names such as "toString" or "__proto__" are never treated as doors. */
export function isDoorId(value: unknown): value is DoorId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DOORS, value);
}

/** Every catalogue name the doors use, once each, in door order. */
export function doorSecretNames(): string[] {
  const names: string[] = [];
  for (const id of DOOR_IDS) {
    for (const field of DOORS[id].fields) {
      if (!names.includes(field.secretName)) names.push(field.secretName);
    }
  }
  return names;
}

/** Reads which fields are saved. `saved` holds the catalogue names that have a value. */
export function doorStatus(id: DoorId, saved: ReadonlySet<string>): DoorStatus {
  const fields = DOORS[id].fields;
  const missing = fields.filter((field) => !saved.has(field.secretName)).map((field) => field.label);
  if (missing.length === 0) return { state: "connected", missing };
  if (missing.length === fields.length) return { state: "not_connected", missing };
  return { state: "partly", missing };
}
