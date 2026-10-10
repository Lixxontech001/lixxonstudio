// Buddy's how-to answers for the six doors added in Phase 6. Pure: no network, no database, no model.
// When the owner asks how to connect one of them, Buddy answers with these fixed steps. The steps name only the
// Connections page and the fields on it. No secret is asked for in chat, and no country or currency is named.

export const HOWTO_DOORS = ["medium", "youtube", "pixelfed", "wordpress_com", "podcast", "vimeo", "flipboard", "google_news", "microsoft_start", "smartnews"] as const;
export type HowToDoor = (typeof HOWTO_DOORS)[number];

const DOOR_WORDS: Array<{ door: HowToDoor; words: RegExp }> = [
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
