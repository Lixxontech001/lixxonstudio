import { BRAIN_SLOTS, type BrainId } from "./brains.ts";

// Buddy's how-to answers for every open door: the sixteen auto doors in doorRegistry.ts (OPEN_DOORS). Pure: no network, no database, no model.
// The four gated channels are not doors, so they have no how-to here.
// When the owner asks how to connect one of them, Buddy answers with these fixed steps. The steps name only the
// Connections page and the fields on it. No secret is asked for in chat, and no country or currency is named.

export const HOWTO_DOORS = [
  "telegram", "discord", "bluesky", "mastodon", "tumblr", "blogger", "medium", "youtube", "pixelfed", "wordpress_com",
  "podcast", "vimeo", "flipboard", "google_news", "microsoft_start", "smartnews",
] as const;
export type HowToDoor = (typeof HOWTO_DOORS)[number];

const DOOR_WORDS: Array<{ door: HowToDoor; words: RegExp }> = [
  { door: "telegram", words: /\btelegram\b/i },
  { door: "discord", words: /\bdiscord\b/i },
  { door: "bluesky", words: /\bbluesky\b/i },
  { door: "mastodon", words: /\bmastodon\b/i },
  { door: "tumblr", words: /\btumblr\b/i },
  { door: "blogger", words: /\bblogger\b/i },
  { door: "medium", words: /\bmedium\b/i },
  { door: "youtube", words: /\b(youtube|you tube)\b/i },
  { door: "pixelfed", words: /\bpixelfed\b/i },
  { door: "wordpress_com", words: /\bwordpress(\.com)?\b/i },
  { door: "podcast", words: /\bpodcast\b/i },
  { door: "vimeo", words: /\bvimeo\b/i },
  { door: "flipboard", words: /\bflipboard\b/i },
  { door: "google_news", words: /\bgoogle news\b/i },
  { door: "microsoft_start", words: /\bmicrosoft start\b/i },
  { door: "smartnews", words: /\bsmartnews\b/i },
];

const HOW_WORDS = /\b(how|steps?|set ?up|connect|hook up)\b/i;

export const HOWTO_REPLIES: Record<HowToDoor, string> = {
  telegram: [
    "Telegram: open Connections, then find Telegram.",
    "Paste your bot token, and the channel or chat ID the bot posts to, then save.",
    "Buddy sends one text message per article, with a link back to the article.",
    "Press Test. The test is a read-only check. It posts nothing.",
  ].join(" "),
  discord: [
    "Discord: open Connections, then find Discord.",
    "Paste the webhook address from your Discord channel's settings, then save.",
    "Buddy sends one message per article to that channel, with a link back to the article.",
    "Press Test. The test is a read-only check. It posts nothing.",
  ].join(" "),
  bluesky: [
    "Bluesky: open Connections, then find Bluesky.",
    "Paste your handle, such as name.bsky.social, and an app password made in your Bluesky settings, then save.",
    "Buddy posts one short line with a link back to the article.",
    "Press Test. The test signs in and posts nothing.",
  ].join(" "),
  mastodon: [
    "Mastodon: open Connections, then find Mastodon.",
    "Paste your server address (the full https web address of your Mastodon server) and your access token, then save.",
    "Buddy posts one status with a link back to the article.",
    "Press Test. The test is a read-only check. It posts nothing.",
  ].join(" "),
  tumblr: [
    "Tumblr: open Connections, then find Tumblr.",
    "Paste the consumer key, the consumer secret, the access token, the token secret and your blog name, then save.",
    "Buddy posts one text post with a link back to the article.",
    "Press Test. The test is a read-only check. It posts nothing.",
  ].join(" "),
  blogger: [
    "Blogger: open Connections, then find Blogger.",
    "Paste the Client ID, the Client secret, the Refresh token and the Blog ID from your Google project, then save.",
    "Buddy publishes one post per article with a link back to the article.",
    "Press Test. The test is a read-only check. It posts nothing.",
  ].join(" "),
  medium: [
    "Medium: open Connections, then find Medium.",
    "Paste the integration token you already have into the token box, then save.",
    "Medium no longer issues new tokens. If you have no token, this door stays off.",
    "Press Test. The test only checks the account. It posts nothing.",
  ].join(" "),
  youtube: [
    "YouTube: open Connections, then find YouTube.",
    "Paste the Client ID, the Client secret and the Refresh token from your Google project, then save.",
    "A video goes up only when a real video was made for that article. Until then YouTube skips the day and says so.",
    "A new Google project can upload videos as private until Google approves the app.",
  ].join(" "),
  pixelfed: [
    "Pixelfed: open Connections, then find Pixelfed.",
    "Paste your server address (the full https web address of your Pixelfed server) and your access token, then save.",
    "Pixelfed posts need a picture, so an article with no cover picture is skipped.",
  ].join(" "),
  wordpress_com: [
    "WordPress.com: open Connections, then find WordPress.com.",
    "Paste your site address, such as yourname.wordpress.com, and your access token, then save.",
    "Buddy posts a short line with a link back to the article, not the whole article.",
  ].join(" "),
  podcast: [
    "Podcast: open Connections, then find Podcast.",
    "Enter the show title, the show author, and the secure link to a square cover picture (1400 to 3000 pixels, under 510 KB, JPEG or PNG), then save.",
    "Your show feed is the /podcast.xml address on your site. You submit that feed yourself in Apple Podcasts and Spotify. Buddy does not submit it.",
    "An episode is added only when its audio file exists.",
  ].join(" "),
  vimeo: [
    "Vimeo: open Connections, then find Vimeo.",
    "Paste your Vimeo access token, then save.",
    "A video goes up only when a real video was made for that article. Vimeo limits uploads on your plan, and if Vimeo refuses, the door says so.",
  ].join(" "),
  // Phase 8: the RSS doors. Nothing is typed in. The owner adds the feed address in each service.
  flipboard: [
    "Flipboard: there is nothing to save on Connections.",
    "Buddy keeps your RSS feed current and pings a free hub for each new article.",
    "To get your articles into Flipboard, add your feed address (your site's /rss.xml address) in Flipboard yourself.",
  ].join(" "),
  google_news: [
    "Google News: there is nothing to save on Connections.",
    "Buddy keeps your RSS feed current and pings a free hub for each new article.",
    "To get your articles into Google News, add your feed address (your site's /rss.xml address) in Google News yourself.",
  ].join(" "),
  microsoft_start: [
    "Microsoft Start: there is nothing to save on Connections.",
    "Buddy keeps your RSS feed current and pings a free hub for each new article.",
    "To get your articles into Microsoft Start, add your feed address (your site's /rss.xml address) in Microsoft Start yourself.",
  ].join(" "),
  smartnews: [
    "SmartNews: there is nothing to save on Connections.",
    "Buddy keeps your RSS feed current and pings a free hub for each new article.",
    "To get your articles into SmartNews, add your feed address (your site's /rss.xml address) in SmartNews yourself.",
  ].join(" "),
};

/**
 * The door a how-to question is about, or null. Needs a how-to word and exactly one door name, so an order such as
 * "post to YouTube" (no how-to word) is never taken for a question, and a message that names two doors is left alone.
 */
export function howToDoor(message: string): HowToDoor | null {
  if (!HOW_WORDS.test(message)) return null;
  const named = DOOR_WORDS.filter((item) => item.words.test(message));
  return named.length === 1 ? named[0].door : null;
}

export function howToReply(door: HowToDoor): string {
  return HOWTO_REPLIES[door];
}

// Phase A slice 4: how to get and save each brain's key. The steps name the Brains page and the box to paste into.
// No key is asked for in chat. A brain named with no key words ("how is Groq doing") is not a how-to question.
const BRAIN_WORDS: Array<{ brain: BrainId; words: RegExp }> = [
  { brain: "gemini", words: /\b(gemini|google key|google ai)\b/i },
  { brain: "groq", words: /\bgroq\b/i },
  { brain: "nvidia", words: /\b(nvidia|nim)\b/i },
  { brain: "cloudflare", words: /\bcloudflare\b/i },
  { brain: "openrouter", words: /\b(openrouter|open router)\b/i },
  { brain: "cerebras", words: /\bcerebras\b/i },
  { brain: "huggingface", words: /\b(hugging ?face|huggingface)\b/i },
  { brain: "deepseek", words: /\bdeepseek\b/i },
];

const BRAIN_KEY_WORDS = /\b(key|token|sign ?up|set ?up|connect|get|add|steps?)\b/i;

/**
 * The brain a how-to question is about, or null. Needs the word "how", a key word, and exactly one brain name.
 */
export function brainHowTo(message: string): BrainId | null {
  if (!/\bhow\b/i.test(message) || !BRAIN_KEY_WORDS.test(message)) return null;
  const named = BRAIN_WORDS.filter((item) => item.words.test(message));
  return named.length === 1 ? named[0].brain : null;
}

export function brainHowToReply(brain: BrainId): string {
  const slot = BRAIN_SLOTS.find((item) => item.id === brain);
  if (!slot) return "Buddy does not know that brain.";
  const steps = [
    `${slot.label}: go to ${slot.keySite} and make a key there. Copy it once.`,
    "Then open Admin, go to Brains under Automation, paste the key into the box for that brain, and press Save.",
    `${slot.accessNote}`,
  ];
  if (slot.id === "cloudflare") steps.push("Cloudflare also needs your account ID, which is on the Workers page. Paste it into the second box.");
  if (slot.access === "skip") steps.push("Buddy skips this brain for now, so a saved key does not change its answers yet.");
  steps.push("Saved keys are never shown again. Press Test to check one with a single read-only request.");
  return steps.join(" ");
}
