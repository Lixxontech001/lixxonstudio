#!/usr/bin/env node
/**
 * Multi-Channel Syndication Runner Script
 * 
 * Automatically syncs the latest published editorial article to all active
 * destinations (Discord, Flipboard, Telegram, Bluesky, Mastodon, Medium, Tumblr, Substack)
 * based on category niche filtering and deduplication rules.
 * 
 * Usage:
 *   node scripts/syndicate.mjs
 */

import { createClient } from '@supabase/supabase-js';

// Fallback dummy WebSocket implementation for Node.js runtimes lacking global WebSocket
if (typeof globalThis.WebSocket === 'undefined') {
  class DummyWebSocket {
    constructor() {
      this.readyState = 3; // CLOSED
    }
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
  }
  globalThis.WebSocket = DummyWebSocket;
}

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[syndicate] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.warn('[syndicate] Please ensure these secrets are added in GitHub repository settings. Skipping execution.');
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SITE_URL = 'https://lixxonstudio.com';

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Dispatch to Discord webhook with rich embed formatting
 */
async function dispatchDiscord(post, postUrl, config) {
  if (!config.webhook_url) throw new Error('Missing Discord webhook_url');

  const payload = {
    username: 'Lixxon Studio Editorial',
    avatar_url: `${SITE_URL}/favicon.png`,
    embeds: [
      {
        title: post.title,
        url: postUrl,
        description: post.excerpt || '',
        color: 0x9c6647, // Brand Bronze color #9C6647
        image: post.cover_image ? { url: post.cover_image } : undefined,
        author: {
          name: 'Lixxon Studio',
          url: SITE_URL,
        },
        footer: {
          text: 'Lixxon Studio • Skincare Science & Minimalist Wellness',
        },
        timestamp: post.published_at || new Date().toISOString(),
      },
    ],
  };

  const res = await fetch(config.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord returned HTTP ${res.status}: ${text}`);
  }
}

/**
 * Dispatch to Flipboard magazine via session API
 */
async function dispatchFlipboard(post, postUrl, config) {
  if (!config.magazine_url) throw new Error('Missing Flipboard magazine_url');
  const sessionCookie = config.flipboard_session || config.session_cookie || '';
  if (!sessionCookie) throw new Error('Missing Flipboard flipboard_session cookie');

  const res = await fetch(config.magazine_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `flipboard_session=${sessionCookie}`,
      'User-Agent': 'LixxonStudio-Syndication/1.0',
    },
    body: JSON.stringify({
      url: postUrl,
      title: post.title,
      description: post.excerpt || '',
      image_url: post.cover_image || '',
    }),
  });

  if (!res.ok && res.status !== 200 && res.status !== 201) {
    const text = await res.text().catch(() => '');
    throw new Error(`Flipboard returned HTTP ${res.status}: ${text}`);
  }
}

/**
 * Dispatch to Telegram channel or chat with inline button
 */
async function dispatchTelegram(post, postUrl, config) {
  if (!config.bot_token || !config.chat_id) {
    throw new Error('Missing Telegram bot_token or chat_id');
  }

  const messageText = `<b>${escapeHtml(post.title)}</b>\n\n${escapeHtml(post.excerpt || '')}\n\n<a href="${postUrl}">Read full story on Lixxon Studio</a>`;

  const res = await fetch(`https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chat_id,
      text: messageText,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Read on Lixxon Studio ↗', url: postUrl }],
        ],
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.description || `Telegram returned HTTP ${res.status}`);
  }
}

/**
 * Dispatch to Bluesky / AT Protocol with link card facets
 */
async function dispatchBluesky(post, postUrl, config) {
  if (!config.handle || !config.app_password) {
    throw new Error('Missing Bluesky handle or app_password');
  }

  // 1. Authenticate session
  const sessionRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: config.handle,
      password: config.app_password,
    }),
  });

  const session = await sessionRes.json().catch(() => ({}));
  if (!sessionRes.ok) {
    throw new Error(`Bluesky auth failed: ${session.message || sessionRes.statusText}`);
  }

  // 2. Post record with external link card
  const postText = `${post.title}\n\n${postUrl}`;
  const record = {
    $type: 'app.bsky.feed.post',
    text: postText,
    createdAt: new Date().toISOString(),
    embed: {
      $type: 'app.bsky.embed.external',
      external: {
        uri: postUrl,
        title: post.title,
        description: post.excerpt || '',
      },
    },
  };

  const createRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  });

  if (!createRes.ok) {
    const createData = await createRes.json().catch(() => ({}));
    throw new Error(`Bluesky post failed: ${createData.message || createRes.statusText}`);
  }
}

/**
 * Dispatch to Mastodon instance
 */
async function dispatchMastodon(post, postUrl, config) {
  const instance = (config.instance_url || config.instance || 'https://mastodon.social').replace(/\/$/, '');
  const token = config.access_token || config.token;
  if (!token) throw new Error('Missing Mastodon access_token');

  const statusText = `${post.title}\n\n${post.excerpt || ''}\n\n${postUrl}`;

  const res = await fetch(`${instance}/api/v1/statuses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      status: statusText,
      visibility: 'public',
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Mastodon returned HTTP ${res.status}`);
  }
}

/**
 * Dispatch to Medium publication / personal story with canonical URL
 */
async function dispatchMedium(post, postUrl, config) {
  const token = config.integration_token || config.token;
  if (!token) throw new Error('Missing Medium integration_token');

  let authorId = config.author_id;
  if (!authorId) {
    const meRes = await fetch('https://api.medium.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meData = await meRes.json().catch(() => ({}));
    if (!meRes.ok) {
      throw new Error(`Medium /me failed: ${meData.errors?.[0]?.message || meRes.statusText}`);
    }
    authorId = meData.data?.id;
  }

  if (!authorId) throw new Error('Could not resolve Medium author ID');

  const contentMarkdown = `# ${post.title}\n\n${post.cover_image ? `![${post.title}](${post.cover_image})\n\n` : ''}${post.excerpt ? `> ${post.excerpt}\n\n` : ''}${post.content || ''}\n\n---\n*Originally published at [Lixxon Studio](${postUrl})*`;

  const res = await fetch(`https://api.medium.com/v1/users/${authorId}/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: post.title,
      contentFormat: 'markdown',
      content: contentMarkdown,
      canonicalUrl: postUrl,
      publishStatus: 'public',
      tags: ['wellness', 'skincare', 'minimalism'],
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errors?.[0]?.message || `Medium returned HTTP ${res.status}`);
  }
}

/**
 * Dispatch to Tumblr blog
 */
async function dispatchTumblr(post, postUrl, config) {
  if (!config.blog_identifier) throw new Error('Missing Tumblr blog_identifier');
  const token = config.consumer_key || config.access_token;
  if (!token) throw new Error('Missing Tumblr consumer_key');

  const res = await fetch(`https://api.tumblr.com/v2/blog/${encodeURIComponent(config.blog_identifier)}/post`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      type: 'link',
      url: postUrl,
      title: post.title,
      description: post.excerpt || '',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Tumblr returned HTTP ${res.status}: ${text}`);
  }
}

/**
 * Dispatch draft to Substack publication
 */
async function dispatchSubstack(post, postUrl, config) {
  if (!config.subdomain) throw new Error('Missing Substack subdomain');
  const sid = config.connect_sid || config.cookie || '';
  if (!sid) throw new Error('Missing Substack connect.sid session cookie');

  const res = await fetch(`https://${config.subdomain}.substack.com/api/v1/drafts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `connect.sid=${sid}`,
    },
    body: JSON.stringify({
      draft_title: post.title,
      draft_subtitle: post.excerpt || '',
      draft_body: `<p>${escapeHtml(post.excerpt || '')}</p><p><a href="${postUrl}">Read full story on Lixxon Studio</a></p>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Substack returned HTTP ${res.status}: ${text}`);
  }
}

/**
 * Main Runner
 */
async function run() {
  console.log('[syndicate] Starting multi-channel syndication runner...');

  // 1. Query latest published post
  const { data: posts, error: postErr } = await supabase
    .from('posts')
    .select('id, slug, title, excerpt, content, cover_image, published_at, status, category_id, category:categories(name, slug)')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1);

  if (postErr) {
    console.error('[syndicate] Failed to query latest post:', postErr.message);
    process.exit(1);
  }

  if (!posts || posts.length === 0) {
    console.log('[syndicate] No published posts found. Exiting.');
    return;
  }

  const post = posts[0];
  const postUrl = `${SITE_URL}/blog/${post.slug}`;
  const postCategory = (post.category?.name || post.category_id || '').toLowerCase();
  const postCategorySlug = (post.category?.slug || '').toLowerCase();

  console.log(`[syndicate] Found latest published article: "${post.title}" (${post.slug})`);
  console.log(`[syndicate] Article Category: "${postCategory || 'none'}"`);

  // 2. Fetch all active destinations
  const { data: destinations, error: destErr } = await supabase
    .from('syndication_destinations')
    .select('*')
    .eq('is_active', true);

  if (destErr) {
    console.error('[syndicate] Failed to fetch destinations:', destErr.message);
    process.exit(1);
  }

  if (!destinations || destinations.length === 0) {
    console.log('[syndicate] No active destinations configured. Exiting.');
    return;
  }

  console.log(`[syndicate] Found ${destinations.length} active destination(s). Filtering by niche...`);

  // 3. Filter destinations based on post category / niche
  const matchedDestinations = destinations.filter(dest => {
    if (!dest.niche || dest.niche.toLowerCase() === 'all') return true;
    const n = dest.niche.toLowerCase();
    return n === postCategory || n === postCategorySlug || postCategory.includes(n);
  });

  console.log(`[syndicate] ${matchedDestinations.length} destination(s) matched article niche.`);

  if (matchedDestinations.length === 0) {
    console.log('[syndicate] No destinations match this article category. Exiting.');
    return;
  }

  // 4. Filter out destinations that already successfully syndicated this post
  const candidateDestinations = [];
  for (const dest of matchedDestinations) {
    const { data: existingLogs } = await supabase
      .from('syndication_logs')
      .select('id, status')
      .eq('post_id', String(post.id))
      .eq('destination_id', dest.id)
      .eq('status', 'success');

    if (existingLogs && existingLogs.length > 0) {
      console.log(`[syndicate] [SKIP] "${dest.name}" (${dest.platform}) already syndicated post ${post.slug}.`);
    } else {
      candidateDestinations.push(dest);
    }
  }

  if (candidateDestinations.length === 0) {
    console.log('[syndicate] All matched destinations have already syndicated this article. Nothing to dispatch.');
    return;
  }

  console.log(`[syndicate] Dispatching to ${candidateDestinations.length} destination(s) in parallel...`);

  // 5. Dispatch in parallel with Promise.allSettled()
  const dispatchPromises = candidateDestinations.map(async dest => {
    const config = dest.config || {};
    try {
      switch (dest.platform) {
        case 'discord':
          await dispatchDiscord(post, postUrl, config);
          break;
        case 'flipboard':
          await dispatchFlipboard(post, postUrl, config);
          break;
        case 'telegram':
          await dispatchTelegram(post, postUrl, config);
          break;
        case 'bluesky':
          await dispatchBluesky(post, postUrl, config);
          break;
        case 'mastodon':
          await dispatchMastodon(post, postUrl, config);
          break;
        case 'medium':
          await dispatchMedium(post, postUrl, config);
          break;
        case 'tumblr':
          await dispatchTumblr(post, postUrl, config);
          break;
        case 'substack':
          await dispatchSubstack(post, postUrl, config);
          break;
        default:
          throw new Error(`Unsupported platform: ${dest.platform}`);
      }

      console.log(`[syndicate] ✓ SUCCESS: Dispatched to "${dest.name}" (${dest.platform})`);

      // Log success
      await supabase.from('syndication_logs').insert({
        post_id: String(post.id),
        post_slug: post.slug,
        destination_id: dest.id,
        platform: dest.platform,
        status: 'success',
        error_message: null,
      });

      return { dest, status: 'success' };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[syndicate] ✗ FAILED: "${dest.name}" (${dest.platform}) - ${errMsg}`);

      // Log failure
      await supabase.from('syndication_logs').insert({
        post_id: String(post.id),
        post_slug: post.slug,
        destination_id: dest.id,
        platform: dest.platform,
        status: 'failed',
        error_message: errMsg,
      });

      return { dest, status: 'failed', error: errMsg };
    }
  });

  const results = await Promise.allSettled(dispatchPromises);
  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.status === 'success').length;
  const failed = results.length - succeeded;

  console.log(`[syndicate] Syndication batch completed: ${succeeded} succeeded, ${failed} failed.`);
}

run().catch(err => {
  console.error('[syndicate] Fatal error during syndication run:', err);
  process.exit(1);
});

