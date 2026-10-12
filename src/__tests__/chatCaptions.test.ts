import { describe, expect, it, vi } from 'vitest';
import {
  DRAFT_NOTE,
  DRAFT_SAVE_OFF_LINE,
  DRAFT_SAVE_ON_LINE,
  DRAFT_SAVE_UNREADABLE_LINE,
  DRAFT_USED_DETAIL,
  NO_ARTICLE_DRAFT_LINE,
  captionAsk,
  draftCaptionsInChat,
  draftForArticle,
  draftFromPayload,
  draftLines,
  draftPayload,
  fourStayFour,
  fourTexts,
  pickCaptionSource,
  saveTellLine,
} from '../../supabase/functions/_shared/chatCaptions';
import type { PackCopy } from '../../supabase/functions/_shared/packCopy';
import type { ShopProduct } from '../../supabase/functions/_shared/productPlacement';
import { runDayPacks, type PackRow, type PackSource } from '../../supabase/functions/_shared/dayPacks';
import { handleBuddyThink, type BuddyThinkDeps } from '../../supabase/functions/_shared/buddyThink';

// Phase I slice 4: the four captions, drafted in the chat at any time. Four stay four, and a draft reaches a pack
// only when Takeover is on, because the pack step is the only thing that saves one.

const COPY: PackCopy = {
  instagram: 'A calm routine for skin that reacts to everything.',
  tiktok: 'Three steps, two minutes, no fuss.',
  facebook: 'If your skin is easily upset, start smaller than you think.',
  pinterest: { title: 'A calm skin routine', description: 'Simple steps for reactive skin, in order.' },
};

const SHOP: ShopProduct[] = [
  { id: 'p1', name: 'Calm Skin Guide', isDigital: true, priceUsd: 29 },
  { id: 'p2', name: 'Bright Kit', isDigital: false, priceUsd: 45 },
];

function replyFor(copy: PackCopy = COPY): string {
  return JSON.stringify(copy);
}

function thinkReturning(text: string) {
  return vi.fn(async () => ({ ok: true as const, text }));
}

describe('captionAsk: a caption order asks for a draft, a check does not', () => {
  it('reads the orders that ask for the four captions', () => {
    expect(captionAsk('Write the captions for the pack')).toBe(true);
    expect(captionAsk('Draft new captions for the article')).toBe(true);
    expect(captionAsk('Preview the captions')).toBe(true);
  });

  it('leaves a check or a plain question alone', () => {
    expect(captionAsk('Check the captions with the Auditor')).toBe(false);
    expect(captionAsk('Are the captions ready?')).toBe(false);
    expect(captionAsk('Read the article')).toBe(false);
  });
});

describe('fourStayFour: the four texts stay four', () => {
  it('keeps the four in channel order, Pinterest as title and description', () => {
    expect(fourTexts(COPY)).toEqual([
      COPY.instagram,
      COPY.tiktok,
      COPY.facebook,
      'A calm skin routine. Simple steps for reactive skin, in order.',
    ]);
    expect(fourStayFour(COPY)).toEqual({ ok: true, reason: '' });
  });

  it('refuses an empty one, and names it', () => {
    expect(fourStayFour({ ...COPY, tiktok: '   ' })).toEqual({ ok: false, reason: 'TikTok caption came back empty.' });
  });

  it('refuses two of the four that are the same words, and names the second', () => {
    const result = fourStayFour({ ...COPY, facebook: 'Three steps, two minutes, NO fuss!' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Facebook caption is the same words as TikTok caption.');
  });
});

describe('the draft lines and the tell line', () => {
  it('shows the four, says it is a draft, and says what Takeover means', () => {
    const lines = draftLines(COPY, 'How to Calm Reactive Skin', true);
    expect(lines[0]).toBe('Here are the four captions for "How to Calm Reactive Skin":');
    expect(lines[1]).toBe(`Instagram: ${COPY.instagram}`);
    expect(lines[4]).toBe('Pinterest: A calm skin routine. Simple steps for reactive skin, in order.');
    expect(lines[5]).toContain(DRAFT_NOTE);
    expect(lines[5]).toContain(DRAFT_SAVE_ON_LINE);
  });

  it('Takeover off says nothing was saved, and an unreadable switch says so too', () => {
    expect(saveTellLine(false)).toBe(DRAFT_SAVE_OFF_LINE);
    expect(saveTellLine(null)).toBe(DRAFT_SAVE_UNREADABLE_LINE);
    expect(DRAFT_SAVE_OFF_LINE).toContain('nothing was saved to a pack');
    expect(DRAFT_SAVE_ON_LINE).toContain('Nothing was posted for you.');
  });
});

describe('draftCaptionsInChat: the pack prompt and the pack Auditor, then talk only', () => {
  it('drafts the four, with Takeover off', async () => {
    const think = thinkReturning(replyFor());
    const draft = await draftCaptionsInChat({ articleTitle: 'How to Calm Reactive Skin', products: SHOP }, think, false);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.lines[1]).toContain('Instagram:');
    expect(draft.copy).toEqual(COPY);
    // The same prompt the day's packs use, and only the shop's own product names in it.
    const request = think.mock.calls[0][0];
    expect(request.system).toContain('Reply with JSON only');
    expect(request.prompt).toContain('Calm Skin Guide');
  });

  it('takes the Auditor block as an answer and saves nothing', async () => {
    const blocked = { ...COPY, instagram: 'This cream cures eczema for good.' };
    const draft = await draftCaptionsInChat({ articleTitle: 'Skin', products: SHOP }, thinkReturning(replyFor(blocked)), false);
    expect(draft.ok).toBe(false);
    if (draft.ok) return;
    expect(draft.line).toContain('The Auditor blocked this draft.');
    expect(draft.line).toContain('Nothing was saved.');
  });

  it('says so plainly when there is no article, or no key, or a reply that cannot be read', async () => {
    const noArticle = await draftCaptionsInChat(null, thinkReturning(replyFor()), false);
    expect(noArticle).toEqual({ ok: false, line: NO_ARTICLE_DRAFT_LINE });

    const noKey = await draftCaptionsInChat(
      { articleTitle: 'Skin', products: SHOP },
      vi.fn(async () => ({ ok: false as const, reason: 'no_key' as const })),
      false,
    );
    expect(noKey).toMatchObject({ ok: false });
    if (!noKey.ok) expect(noKey.line).toContain('no brain key saved');

    const unusable = await draftCaptionsInChat({ articleTitle: 'Skin', products: SHOP }, thinkReturning('not json at all'), false);
    expect(unusable).toMatchObject({ ok: false });
    if (!unusable.ok) expect(unusable.line).toContain('Nothing was saved.');
  });

  it('never shows a draft that is not four different texts', async () => {
    const doubled = { ...COPY, facebook: COPY.instagram };
    const draft = await draftCaptionsInChat({ articleTitle: 'Skin', products: SHOP }, thinkReturning(replyFor(doubled)), false);
    expect(draft).toMatchObject({ ok: false });
    if (!draft.ok) expect(draft.line).toContain('The draft was not usable');
  });
});

describe('the draft travels as a chat payload, and only a whole one is read back', () => {
  it('round trips the day, the article and the four texts', () => {
    const payload = draftPayload('2026-10-10', 'How to Calm Reactive Skin', COPY);
    expect(draftFromPayload(payload)).toEqual({ day: '2026-10-10', articleTitle: 'How to Calm Reactive Skin', copy: COPY });
  });

  it('refuses anything that is not one of Buddy s four-text drafts', () => {
    expect(draftFromPayload(null)).toBeNull();
    expect(draftFromPayload({ kind: 'other', day: '2026-10-10', article_title: 'x', copy: COPY })).toBeNull();
    expect(draftFromPayload({ kind: 'caption_draft', day: '', article_title: 'x', copy: COPY })).toBeNull();
    expect(draftFromPayload({ kind: 'caption_draft', day: '2026-10-10', article_title: 'x', copy: { instagram: 'a' } })).toBeNull();
    expect(draftFromPayload(draftPayload('2026-10-10', 'x', { ...COPY, tiktok: COPY.instagram }))).toBeNull();
  });
});

describe('pickCaptionSource: the article the packs would choose', () => {
  const articles = [
    { id: 'a1', title: 'Newest article', slug: 'newest-article' },
    { id: 'a2', title: 'Older article', slug: 'older-article' },
  ];

  it('picks an article with a live product and a clean address, digital first', () => {
    const source = pickCaptionSource(articles, [{ postId: 'a2', productId: 'p1' }], SHOP);
    expect(source).toEqual({ articleTitle: 'Older article', products: [SHOP[0]] });
  });

  it('is null when no article has a live product or a clean address', () => {
    expect(pickCaptionSource(articles, [], SHOP)).toBeNull();
    expect(pickCaptionSource([{ id: 'a1', title: 'Bad slug', slug: 'Not A Slug' }], [{ postId: 'a1', productId: 'p1' }], SHOP)).toBeNull();
  });
});

describe('draftForArticle: a draft is used for its own article, and still passes the Auditor', () => {
  it('matches the article whatever the punctuation, and audits the copy with these products', () => {
    const used = draftForArticle({ articleTitle: 'How to calm reactive skin', copy: COPY }, 'How to Calm Reactive Skin.', SHOP);
    expect(used?.copy).toEqual(COPY);
    expect(used?.verdict.verdict).toBe('allow');
  });

  it('is not used for another article, and a blocked copy comes back blocked', () => {
    expect(draftForArticle({ articleTitle: 'Other', copy: COPY }, 'How to Calm Reactive Skin', SHOP)).toBeNull();
    const blocked = { ...COPY, instagram: 'This cream cures eczema for good.' };
    expect(draftForArticle({ articleTitle: 'Skin', copy: blocked }, 'Skin', SHOP)?.verdict.verdict).toBe('block');
  });
});

describe('the pack step uses today s draft instead of thinking again', () => {
  const articles: PackSource[] = [
    { id: 'a1', title: 'How to Calm Reactive Skin', slug: 'how-to-calm-reactive-skin', coverImage: null, liveProductIds: ['p1'] },
  ];

  function ports() {
    const saved: PackRow[] = [];
    const think = thinkReturning(replyFor());
    const log = vi.fn(async () => {});
    return {
      saved,
      think,
      log,
      ports: {
        think,
        checkImage: async () => ({ ok: false as const, reason: 'no_cover' }),
        savePack: async (row: PackRow) => {
          saved.push(row);
          return { ok: true as const };
        },
        log,
      },
    };
  }

  function input(draftedCopy?: { articleTitle: string; copy: PackCopy } | null) {
    return { localDay: '2026-10-10', takeover: true, killScope: 'none' as const, articles, shop: SHOP, siteOrigin: 'https://lixxon.studio', alreadyMade: false, draftedCopy };
  }

  it('saves the owner s four captions and never asks a brain for new ones', async () => {
    const fake = ports();
    const result = await runDayPacks(input({ articleTitle: 'How to Calm Reactive Skin', copy: COPY }), fake.ports);
    expect(result.status).toBe('done');
    expect(result.saved).toBe(4);
    expect(fake.think).not.toHaveBeenCalled();
    expect(fake.saved.map((row) => row.caption ?? row.pinTitle)).toEqual([
      COPY.instagram,
      COPY.tiktok,
      COPY.facebook,
      COPY.pinterest.title,
    ]);
    expect(fake.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'done', detail: expect.stringContaining(DRAFT_USED_DETAIL) }));
  });

  it('ignores a draft written for another article', async () => {
    const fake = ports();
    const result = await runDayPacks(input({ articleTitle: 'A different article', copy: COPY }), fake.ports);
    expect(result.status).toBe('done');
    expect(fake.think).toHaveBeenCalledTimes(1);
  });

  it('Takeover off: no draft is saved and no brain is asked', async () => {
    const fake = ports();
    const result = await runDayPacks({ ...input({ articleTitle: 'How to Calm Reactive Skin', copy: COPY }), takeover: false }, fake.ports);
    expect(result.status).toBe('held');
    expect(result.saved).toBe(0);
    expect(fake.think).not.toHaveBeenCalled();
    expect(fake.saved).toEqual([]);
  });
});

describe('the chat order: the captions are drafted here and now, with Takeover off', () => {
  const NOW = new Date('2026-10-10T09:00:00Z');
  const CHAT = '8b2f6b1e-1f2a-4c3d-9e4f-5a6b7c8d9e0f';

  function chatStore(options: { draftOk?: boolean; takeover?: boolean } = {}) {
    const saved: Array<{ kind: string; content: string; payload: unknown }> = [];
    const draftCaptions = vi.fn(async (input: { takeover: boolean | null; day: string }) => {
      if (options.draftOk === false) return { ok: false as const, line: NO_ARTICLE_DRAFT_LINE };
      return {
        ok: true as const,
        articleTitle: 'How to Calm Reactive Skin',
        copy: COPY,
        lines: draftLines(COPY, 'How to Calm Reactive Skin', input.takeover),
      };
    });
    const deps: BuddyThinkDeps = {
      keyConfigured: async () => true,
      readSecret: async () => null,
      allowCall: async () => true,
      askGemini: vi.fn(),
      recordProbe: async () => {},
      loadChat: async () => ({ id: CHAT, title: null }),
      loadHistory: async () => [],
      saveMessage: async (_chatId, _role, kind, content, payload) => {
        saved.push({ kind, content, payload: payload ?? null });
        return true;
      },
      touchChat: async () => {},
      now: () => NOW,
      getSeenAt: async () => ({ ok: true as const, seenAt: null }),
      markSeen: async () => true,
      readBriefingFacts: async () => ({ articles: { ok: true, count: 0, titles: [] }, orders: { ok: true, paidCount: 0, usdTotal: 0 }, views: { ok: true, count: 0 }, failures: { ok: true, count: 0, codes: [] } }),
      readSiteFacts: async () => ({ articles: { ok: true, total: 0, items: [] }, products: { ok: true, total: 0, items: [] } }),
      findOrCreateBriefing: async () => ({ id: CHAT, created: false }),
      loadPendingOrder: async () => ({ ok: true as const, instruction: null }),
      saveOrder: async () => '66666666-6666-4666-8666-666666666666',
      readMindLog: async () => [],
      readTakeover: async () => options.takeover ?? false,
      readStateFacts: async () => ({ takeover: false, killScope: 'none', orders: { ok: true, total: 0, items: [] }, log: { ok: true, rows: [] }, doors: { ok: true, rows: [] }, notable: { ok: true, rows: [] } }),
      applyControl: async () => true,
      draftCaptions,
    };
    return { deps, saved, draftCaptions };
  }

  it('drafts the four captions in this chat and files the order as waiting', async () => {
    const store = chatStore();
    const result = await handleBuddyThink({ action: 'ask', message: 'Write the captions for the pack', chat_id: CHAT }, store.deps);
    const reply = String(result.body.reply);
    expect(reply).not.toMatch(/No mind was named|Executioner|Two minds fit this|Saved for|next run/i);
    expect(reply).toContain('Instagram: ');
    expect(reply).toContain('Pinterest: ');
    expect(reply).toContain(DRAFT_SAVE_OFF_LINE);
    expect(result.body.drafted).toBe(true);
    // The draft is saved with the reply, so today's pack step can find it. Nothing else is written here.
    expect(store.saved.at(-1)?.payload).toMatchObject({ kind: 'caption_draft', day: '2026-10-10', article_title: 'How to Calm Reactive Skin' });
  });

  it('Takeover on says the pack step may save them, and still posts nothing', async () => {
    const store = chatStore({ takeover: true });
    await handleBuddyThink({ action: 'ask', message: 'Draft the captions for the pack', chat_id: CHAT }, store.deps);
    const reply = String(store.saved.at(-1)?.content);
    expect(reply).toContain(DRAFT_SAVE_ON_LINE);
    expect(reply).not.toContain('posted for you' + ' now');
  });

  it('an order about captions that cannot be drafted keeps the order reply and says why', async () => {
    const store = chatStore({ draftOk: false });
    const result = await handleBuddyThink({ action: 'ask', message: 'Write the captions for the pack', chat_id: CHAT }, store.deps);
    expect(String(result.body.reply)).toContain(NO_ARTICLE_DRAFT_LINE);
    expect(store.saved.at(-1)?.payload).toBeNull();
  });

  it('an order that is not about captions never drafts anything', async () => {
    const store = chatStore();
    await handleBuddyThink({ action: 'ask', message: 'Read the numbers for this week', chat_id: CHAT }, store.deps);
    expect(store.draftCaptions).not.toHaveBeenCalled();
  });
});
