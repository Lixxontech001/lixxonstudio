# Buddy

This folder is Buddy. Buddy is the only one who talks to the owner.

- Buddy is a private chat for the owner. Other minds (Analyst, Strategist, CEO, Executioner, Auditor) do not get a chat here. They work behind the scenes in later phases.
- All new Buddy screens and Buddy-only browser code go in this folder. Do not add Buddy chat screens under `src/admin/pages`.
- Buddy sits at `/buddy`. It is behind the same owner sign-in, Admin role and MFA as the Admin area. Installing Buddy as an app grants no access.
- Buddy never posts, never edits articles, never sends email or push, and never turns on takeover.

## What is here now (phase 1, slices 1 to 5)

| File | What it does |
| --- | --- |
| `BuddyEntry.tsx` | Decides what `/buddy` shows: the greeting, then the chat. `/buddy/controls` is not a screen any more; it moves the owner to `/buddy`. |
| `BuddyAccessGate.tsx` | The owner gate for Buddy: sign-in, Admin role, then the verified code (MFA). |
| `BuddyGreeting.tsx` | The greeting: a short gold line, a time-of-day word, and a Continue button that appears after about 9.5 seconds (at once with reduced motion). |
| `BuddyChat.tsx` | The chat: today's briefing first, then the message list, composer, New chat, a Chats drawer for past chats, and a Reports button. |
| `BuddyBriefingCard.tsx` | One morning briefing as titled sections. A quiet day shows "Quiet since you left." |
| `BuddyReports.tsx` | The Reports door: a list of night reports, or "No night reports yet." No composer. |
| `buddyChatStore.ts` | Browser side of chats, briefings and reports. Only this owner's rows are readable (row-level security). |
| `buddyDate.ts`, `buddyMotion.ts` | Today's date on this device, the time-of-day word, and the greeting timing. |
| `BuddySettings.tsx` | Buddy settings: pick one of four looks (previews at once, kept only on Save) and the optional read-aloud switch (off by default). |
| `buddyVibes.ts` | The four looks: Noir Gold (default), Ivory Silk, Velvet Opera, Porcelain. Unknown values fall back to Noir Gold. |
| `buddySettingsStore.ts` | Saves and reloads the look and the read-aloud switch on the owner's row. |
| `buddySpeech.ts` | Read-aloud through the browser's own voice. Only Buddy's replies and the briefing are read, and only when switched on. |
| `buddy.css` | Buddy's look. Scoped to `.buddy-app`. Four looks: Noir Gold (default), Ivory Silk, Velvet Opera, Porcelain. |
| `buddyThinkResult.ts` | Reads the answers from the think function. Anything malformed is dropped. |
| `buddyPaths.ts` | The `/buddy/controls` path check (the old address, which now redirects). |

Server side:

- `supabase/functions/buddy-think/index.ts`: the owner check, the Google key read from Vault, the rate limit, and the chat storage through the owner's own session.
- `supabase/functions/_shared/buddyThink.ts`: the rules for `status`, `probe`, `ask` and `briefing`, and the one Gemini call. Buddy thinks with `gemini-3.8-flash`.
- `supabase/functions/_shared/buddyBriefing.ts`: the briefing rules. A day is "quiet" only when every source was read and none had anything real (paid orders, new articles, failed automation steps). Article views are shown but do not make a day busy.
- `supabase/migrations/20261009110000_buddy_chats.sql`: the `buddy_chats` and `buddy_messages` tables. Each owner sees only their own rows.
- `supabase/migrations/20261009120000_buddy_briefing_reports.sql`: briefing threads (one per owner per day), the "last seen" time, and the `buddy_reports` table (read only).
- `supabase/functions/_shared/buddySiteFacts.ts`: the read-only site list Buddy sees with each question (published article titles, active shop products with USD prices). Article bodies are never read.
- `supabase/migrations/20261009130000_buddy_settings.sql`: the look and read-aloud columns on the owner's row. "Last seen" now starts empty, so saving settings does not count as having looked.
- The Google key is the existing `gemini_api_key` entry in Admin, under Automation keys (labelled "Google key"). It is written once and never sent back to the browser.

## What is not here

- The old typed-command screen (typed commands, draft list) was removed in Phase 2, slice 1. Its sign-in gate now lives in `BuddyAccessGate.tsx`.
- Phase 2 slice 3 adds the records the minds will use. All four migrations are additive and not applied: `20261009150000_buddy_orders.sql` (the owner's orders: waiting, done, blocked), `20261009160000_minds_daily_log.sql` (every mind action; the browser can read it but never write it), `20261009170000_minds_notable_events.sql` (things worth attention, with a trigger that records Takeover and Kill changes), and `20261009180000_buddy_night_report_writer.sql` (one night report per owner per day).
- `supabase/functions/_shared/mindsNightReport.ts` builds the night report from the day's log, orders and events, and saves it to Reports. A night with no action says so plainly. A failed read writes nothing. Nothing calls it yet: there is no schedule.
- Phase 2 slice 4 adds the five minds as code, under `minds/`. Each mind gets only two doors: one way to think, and one way to write its log row. There is no database, site, email or spending door, so a mind cannot write `posts.content`, publish, send, create products, change prices, or speak to a customer as the owner.
  - `mindGuards.ts`: the only kinds of step a mind may propose (`note`, `suggest`, `sort`, `prepare`), and the rule that the Auditor and minds cannot switch each other off.
  - `mindCore.ts`: the shared path. Kill first, then one thinking call, then a log row. With no key the row reads "Cannot think: no Google key".
  - `analyst.ts`, `strategist.ts`, `ceo.ts`: one thinking call each.
  - `executioner.ts`: does nothing while Takeover is off. With Takeover on, each plan goes to the Auditor. An allowed plan is still held, because no site writer is connected.
  - `auditor.ts`: allow or block, with a plain fix. Blocks when stopped, when the kind is not allowed, when there is no key, and when unsure.
  - `mindRun.ts`: one pass over the four thinking minds in order. Nothing calls it yet; there is no schedule.
  - `mindsLogStore.ts`: reads the newest log row per mind for the Minds cards.
  - `supabase/functions/_shared/mindThink.ts`: the server's one door to Gemini. It uses the existing `callGemini` and key path, makes no call without a key, and never returns the key.
- Phase 2 slice 5 teaches Buddy to take orders. `supabase/functions/_shared/buddyRouter.ts` sorts each message with plain rules, so no key is needed.
  - An order that names a mind (Analyst, Strategist, CEO, Executioner or Auditor) is saved to `buddy_orders` as waiting. It is never saved as done.
  - An order that names no mind gets one question: which mind. The next short reply that names one mind files the order. If the owner moves on instead, the order is saved as waiting with no mind.
  - A question about a mind ("What did the Analyst do?") is answered from the newest rows of `minds_daily_log`. An empty log says so. A failed read says so and changes nothing.
  - An order that mentions publishing, sending, spending, prices, refunds or deleting is still saved as waiting, and Buddy says those parts wait for the owner.
  - The briefing section "The five minds" reads the same log. A day with a waiting order is not called quiet.
  - Phase 3 slice 1: "Do the new article" is now an order, not a question. Polite openers such as "please" and "could you" are read past. Questions ("?", "what", "do you") are never filed as orders.
  - With a Google key saved, a statement the rules cannot place gets one Gemini judgement (order, ask which mind, or chat). Clear orders (a named mind plus an action word) are decided by the rules with no call. Without a key, the rules decide.
  - `supabase/functions/_shared/buddyOrders.ts` reads the waiting orders, oldest first, and sorts each into a lane. Product lines on articles are the only lane this phase runs. Channels and video, prices and spending, and creating a product each wait with a plain reason.
  - No mind acts on an order yet. The owner still cannot open a chat with any mind.
- Phase 3 slice 2 adds the records for placing products on articles. All four migrations are additive and not applied.
  - `20261009190000_post_product_slots.sql`: which shop products sit on which article. A database rule keeps it to 3 live products per article. A swap removes one row and adds another.
  - `20261009200000_post_product_edits.sql`: one row per applied edit, with the exact paragraph before and after, the paragraph checksum, the products on the article, and the Auditor's allow. The owner can read his own rows for "Show the paragraph".
  - `20261009210000_post_drip_days.sql`: one row per article touched on an owner day. A database rule allows at most 3 different articles a day. Touching the same article again the same day is fine.
  - `20261009220000_minds_gap_notes.sql`: notes that say the shop needs a product for an angle. A note never creates a product. The owner can only mark it seen.
  - All four are owner-only to read and closed to the browser for writing. Nothing public or anonymous can read them.
  - `supabase/functions/_shared/postEdits.ts` holds the same numbers in code (cap 3, 3 articles a day, 2 sentences), plus the SHA-256 paragraph checksum. An edit whose paragraph has changed since the plan is refused.
- Phase 3 slice 3 adds the Strategist's placement plan and the Auditor's check on it. Nothing here writes to an article.
  - `supabase/functions/_shared/productPlacement.ts` makes one plan for one article: one plain paragraph (one line of the article body), one to three active shop products, and one or two sentences. One Gemini call through the existing door (`makeMindThink`). With no key, the plan says "Cannot think: no Google key." and nothing is planned.
  - The Auditor allows the plan only when every check passes. It blocks: more than three products, a product not in the shop, a place that is not a plain paragraph, more than two sentences or more than 60 words, dashes, Nigeria or Naira or Lagos, non-US money, a price that is not the shop price, a cure or medical promise, an invented personal test, a sentence already in the article, text that does not name the product, and markup. Each block carries a plain-English fix.
  - Gemini is asked to prefer digital products when they fit equally well. Digital is a preference, not a rule, so a single affiliate product is allowed.
  - Tests: `src/__tests__/productPlacement.test.ts`, with a skincare article and four shop products.
- Phase 3 slice 4 is the Executioner's apply. It changes one paragraph on one article, and only when Takeover is on, Kill does not stop the run, and the Auditor allows.
  - `supabase/functions/_shared/placementRun.ts` runs one waiting product-line order: best-fit articles first (at most 2 per run), the drip limit (3 articles a day), a swap when the article is at 3 products (only inside the same paragraph), and a gap note when the shop has no product that fits. It never creates a product.
  - `supabase/functions/minds-run-placement/index.ts` is the owner-only entry point (not deployed). It hands the run its doors and reports back in plain words. Nothing runs on a timer yet.
  - `supabase/migrations/20261009230000_minds_apply_placement.sql` holds the two atomic functions: one applies a paragraph edit (text, slots, drip, applied-edit record, log, notable event, order done), and one records a gap. Both refuse when Takeover is off or Kill stops the run, and both refuse a changed paragraph by checksum. Not applied.
  - Tests: `src/__tests__/placementRun.test.ts` (fake doors, including the hash test that only the sentences changed) and `src/__tests__/mindsApplyPlacementDb.test.ts` (the real migrations in an in-process Postgres).
  - Fixed in the Phase 2 orders migration: a duplicate constraint name that Postgres would have refused (`buddy_orders_blocked_reason_rule`).
- Phase 3 slice 5 is Buddy's report of the applies, and the gap notes.
  - The morning briefing's "What went out" section now lists each article change in chief-of-staff words ("I added X to \"Title\". One paragraph changed."). Product gaps appear under "Your jobs". A day with a change or an open gap is not quiet. The "Money & readers" section still uses only paid orders and article views that were read.
  - The Changes screen (`src/buddy/BuddyChanges.tsx`, opened from the Buddy page) lists the recent changes. "Show the paragraph" shows only that one paragraph, before and after. "Got it" marks a gap seen, the only field the owner can change. There is no text box for any mind.
  - Tests: `buddyChanges.test.ts`, `buddyBriefingChanges.test.ts`, `buddyChangesScreen.test.tsx`.
  - Tests run the real migrations in an in-process Postgres (`@electric-sql/pglite`, a free test-only dependency) in `src/__tests__/postEditsDb.test.ts`.
  - `src/__tests__/setup.ts` now skips its browser polyfills in plain Node tests. Browser tests are unchanged.
- Phase 2 freeze checks live in `src/__tests__/buddyPhase2Freeze.test.ts`: Takeover off by default, Kill round-trips, `/admin/ai` is the Minds watch, `/buddy/controls` redirects, and the magazine addresses are unchanged. The briefing no longer says "Takeover is off", because the switch can be turned on; it now says no mind has sent anything out.
- The old Admin AI screen (22 tabs) is still in `src/admin/pages/AdminAI.tsx`, but nothing routes to it any more. The owner's screen at `/admin/ai` is the Minds watch in `src/admin/pages/AdminMinds.tsx`.
- `minds/mindRoster.ts` lists the five minds and the Kill options. `minds/mindsControlsStore.ts` saves the Takeover and Kill settings to the one-row `minds_controls` table (migration `20261009140000_minds_controls.sql`, not applied). Takeover is off by default, and nothing reads these settings yet.
- Buddy cannot change the site. It only reads published article titles and active shop products, and never article bodies (see `supabase/functions/_shared/buddySiteFacts.ts`).
- Night reports are not written by anything yet. The Reports door only lists them.
