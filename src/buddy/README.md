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
- Phase 3 slice 6 is the freeze: `src/__tests__/buddyPhase3Freeze.test.ts`. It checks Takeover default off, Kill blocking every write, at most 3 products, the drip cap, the checksum refusal, no product create, reader copy with no dash, no country and US dollars only, only the chosen paragraph changing, the magazine rendering the applied sentence, and no mind chat.
  - Fixed in slice 6: with no Google key, the run now returns "Cannot think: no Google key." as the owner's words.
  - Tests run the real migrations in an in-process Postgres (`@electric-sql/pglite`, a free test-only dependency) in `src/__tests__/postEditsDb.test.ts`.
  - `src/__tests__/setup.ts` now skips its browser polyfills in plain Node tests. Browser tests are unchanged.
- Phase 2 freeze checks live in `src/__tests__/buddyPhase2Freeze.test.ts`: Takeover off by default, Kill round-trips, `/admin/ai` is the Minds watch, `/buddy/controls` redirects, and the magazine addresses are unchanged. The briefing no longer says "Takeover is off", because the switch can be turned on; it now says no mind has sent anything out.
- The old Admin AI screen (22 tabs) is still in `src/admin/pages/AdminAI.tsx`, but nothing routes to it any more. The owner's screen at `/admin/ai` is the Minds watch in `src/admin/pages/AdminMinds.tsx`.
- `minds/mindRoster.ts` lists the five minds and the Kill options. `minds/mindsControlsStore.ts` saves the Takeover and Kill settings to the one-row `minds_controls` table (migration `20261009140000_minds_controls.sql`, not applied). Takeover is off by default, and nothing reads these settings yet.
- Buddy cannot change the site. It only reads published article titles and active shop products, and never article bodies (see `supabase/functions/_shared/buddySiteFacts.ts`).
- Night reports are not written by anything yet. The Reports door only lists them.

## Phase 4 slice 1: starting a run

- "Run the products", "make today's posts", "run today" and "daily run" are filed as orders with no mind named (`buddyRouter.ts`, `run_day` route). They no longer get the "which mind?" question. Questions about a run stay chat.
- Orders in the `daily_run` lane (`buddyOrders.ts`) are runnable. A run request that also names a channel stays held. "Post it to instagram" stays held.
- `supabase/functions/_shared/runDay.ts` decides what runs. Takeover off, or a Kill on all, strategist, executioner or auditor: nothing runs, nothing is read, nothing is logged, and orders stay waiting. Otherwise the oldest runnable order runs, or the daily trigger queues today's order first.
- `minds-run-placement` accepts an optional `order_id`, the owner's choice. The browser starts the run only when Buddy says Takeover is on (`run_start`).
- Migration `20261010090000_minds_daily_run.sql` (not applied): `minds_queue_daily_run`, service role only. It queues one daily order per owner per day, and returns null when Takeover is off, Kill blocks, or the caller is not the owner. The `cron.schedule` line stays commented. It applies at Phase 6 merge.
- Tests: `runDay.test.ts`, `buddyRunDayRouting.test.ts`, `buddyThink.test.ts` (run requests), `mindsDailyRunDb.test.ts` (PGlite), `buddyStartDayRun.test.ts`.
- Not built yet: packs, captions, time picker, video, and "I posted this". Those are later Phase 4 slices.

## Phase 4 slice 2: pack tables

- Migration `supabase/migrations/20261010100000_minds_packs.sql` (not applied): table `minds_packs`, one row per channel, local day and article. The four gated channels only: instagram, tiktok, facebook, pinterest.
- Writes go only through `minds_save_pack` (service role). It is refused when Takeover is off or when Kill stops the minds (the same check the placement door uses, `minds_assert_can_act`). A second save for the same channel, day and article replaces the row. A pack the owner marked posted is never replaced.
- Products on a pack: at most 3, no repeats, each one a live product slot on that article. The table also refuses a fourth product.
- Copy: no em or en dash, no Nigeria, Lagos, Naira, Abuja or WAT, and US dollars only. The database and `supabase/functions/_shared/packRules.ts` use the same rule.
- A ready pack needs an Auditor allow, a suggested time in UTC, and copy for its channel. A blocked pack needs a reason. A Pinterest pack uses a pin title and description.
- The owner can read his own packs. No signed-in user can write one directly.
- Tests: `mindsPacks.test.ts` (rules, and the migration text), `mindsPacksDb.test.ts` (PGlite: Takeover and Kill, the four channels, replace, the 3-product cap, slots, Auditor and copy, posted packs, who may read and write).
- Not built yet: the copy itself, the time picker, images and video, and "I posted this". Those are later slices.

## Phase 4 slice 3: copy and the time picker

- `supabase/functions/_shared/packCopy.ts` writes the four texts for one pack: a caption for Instagram, TikTok and Facebook, and a title and description for Pinterest. It uses one thinking call (`planPackCopy`). With no Google key the answer is "Cannot think: no Google key." and nothing is saved.
- The Auditor (`auditCopy`) blocks any channel whose text is empty, too long (captions 280 characters, Pinterest title 100, description 300), has a dash, a country name, non-US money, a health promise, a claim of a personal test, markup or a link, or names a product that is not in the shop. It also blocks any text that matches another text after case and punctuation are removed. Instagram equal to TikTok fails, and TikTok is the channel named.
- Products: digital products come first, and at most three are offered to the writer (`chooseProductsForCopy`).
- Article choice for a new pack (`choosePackArticle`): while any article has a live digital product, only those articles are considered. Physical-only articles wait until no digital article fits.
- Time picker: each channel offers a short list of top-country windows (`CHANNEL_WINDOWS`, `TIME_WINDOWS`). The first is the suggestion. Times are stored as UTC with a plain label, such as "Morning, US Eastern". The owner's clock is never used, and no label names Lagos, Nigeria or WAT.
- Nothing is saved yet. The save door (`minds_save_pack`) is used in a later slice. Nothing posts anything.
- Tests: `packCopy.test.ts` (no key, the four texts, the Auditor cases, products, article choice, time windows).

## Phase 4 slice 4: images and video

- Still pictures: only the article's own cover image (`articleImageFor` in `supabase/functions/_shared/packMedia.ts`). An https address or a site path is accepted. Plain http, `data:`, `javascript:`, protocol-relative, spaced or over-long values are refused. Nothing is looked up or invented in its place. No paid stock.
- Captions: `captionChunks` cuts the caption into up to three chunks. Each chunk is at most 60 characters, wrapped at 26 per line, so it reads as a short burned-in caption.
- Video plan: `planPackMedia` blocks a pack on the first missing thing, in this order: no article image ("No article image yet."), copy that cannot be used, then no MP4 ("video not made yet"). A pack is ready only when all three are present.
- Renderer: `scripts/pack-video.mjs` uses FFmpeg (libx264, ASS captions, no audio, no watermark). It makes a 1080 x 1920, 10 second, 30 fps MP4. It takes local files only, refuses a remote picture, a non-MP4 output, an output inside the repository, an existing output, more than three chunks, or a chunk over 60 characters. A failed render leaves no file.
- Proof: `src/__tests__/packVideo.test.ts` checks the refusals, the caption file and the FFmpeg arguments. Where FFmpeg is present, it also renders a real MP4 from a generated picture and probes it (1080 x 1920, about 10 seconds, no audio). It skips when FFmpeg is missing. `packMedia.test.ts` covers the picture rules, caption limits, and the blocked reasons.
- Not yet wired: no step fetches a remote cover image, so the renderer cannot run on a real article yet. A real pack stays blocked with "video not made yet". No public video address is made, and nothing is saved to `minds_packs` by this slice.
- Tests: `packMedia.test.ts`, `packVideo.test.ts`.

## Phase 4 slice 5: "Your jobs" and "I posted this"

- The Changes screen (`BuddyChanges.tsx`) has a new first section, "Your jobs". It shows the owner's packs from the last three days, newest first, read with his own session (`listPackJobs` in `src/buddy/buddyJobs.ts`). Row-level security decides what he sees.
- Each row shows the channel and article title, then one plain line: "Ready to post by hand." with the suggested time in UTC and the label, "Blocked: <reason>." or "Posted by you on <date>.". Products on the pack are named. A ready pack also shows its caption, or its pin title and description.
- The note under the heading says Buddy never posts. Only the four gated channels appear. A row with an unknown channel or status is dropped, not guessed.
- "I posted this" appears only on a ready pack. It calls `minds_mark_pack_posted` (migration `20261010110000_minds_pack_posted.sql`, not applied). That function marks one of the owner's own ready packs as posted by hand and returns true. It refuses a blocked pack, another owner's pack, an admin who is not the owner, and a signed-out visitor. A second mark does nothing. The AI never calls Meta, TikTok or Pinterest, and nothing is published.
- Takeover and Kill do not gate the mark, because it is the owner's own record, not a mind's write. A posted pack cannot be replaced by `minds_save_pack`.
- Briefing: the "Your jobs" section of the morning briefing now also lists packs that are ready or blocked (`packLines`, `briefingPacks` in `supabase/functions/_shared/buddyBriefing.ts`). At most three lines. A day with a ready or blocked pack is not "quiet". A failed read says "I cannot read your packs yet." The briefing still has seven sections. `buddy-think` reads the packs in `readBriefingFacts`, owner session.
- Tests: `buddyJobs.test.ts` (rows, wording, no dash or country, the database read and the mark), `buddyJobsScreen.test.tsx` (the screen in jsdom: rows, buttons, mark, failures), `buddyBriefingPacks.test.ts` (briefing lines, quiet rule, seven sections), `mindsPackPostedDb.test.ts` (PGlite: owner mark, repeat, blocked, other owner, non-owner, signed out, Takeover not gating, no direct write, no replace after posting).
- Not seen in a real browser: this sandbox has no browser to open the screen. The screen is checked in jsdom only. The Edge function is parse-checked only (no Deno here).
- No real pack exists yet, because no step saves one (the copy and pack save are later work). So "Your jobs" will show "No packs in the last three days." until a run saves a pack.

## Phase 4 slice 6: freeze and report

- `src/__tests__/buddyPhase4Freeze.test.ts` holds one check per Phase 4 promise: Takeover off by default, exactly four gated channels (no WhatsApp, no YouTube), the AI never calls a Meta, TikTok or Pinterest posting address, "I posted this" is the owner's own owner-only mark, the button shows only on a ready pack, the four captions are pairwise different, an Instagram-equals-TikTok fixture fails, no dash, country name, non-US money or cure claim in allowed copy, at most three products, publishing times in UTC with top-country labels only, "video not made yet" when there is no MP4, the renderer has no watermark and no audio, the pack writer checks Takeover and Kill and never replaces a posted pack, the daily timer's cron line stays commented out, every Phase 4 migration is in the expected list, "Your jobs" reads real rows, and `/buddy/controls` still redirects.
- Real render: `src/__tests__/packVideo.test.ts` renders a real 1080 x 1920 MP4 whenever `LIXXON_FFMPEG` points at an FFmpeg binary. It skips when none is set.
- Known and not changed in Phase 4: the old "Daily Distribution Kit" screen (`/admin/automation/distribution`), its sidebar link in `AdminLayout.tsx`, and the old `automation-distribution` Edge function were already on `main`. The Phase 4 minds and packs code does not import them, and the freeze checks that. The owner should decide whether to remove the sidebar link.
- Not in production: all Phase 4 migrations are unapplied. The Edge functions are not deployed. No live Gemini call has been made, and no real pack has been saved.

## Phase 5 slice 1: packs from a day run, article picture check, Distribution retired

- The day run (`minds-run-placement`) now makes packs after the placement step, only when Takeover is on and Kill is off. With Takeover off, nothing is read, fetched, written or logged. If the Google key is missing, the packs step is skipped, because placement has already said so.
- `runDayPacks` (`supabase/functions/_shared/dayPacks.ts`) makes one pack row per gated channel for the first article that can take one. It stops at one article per run. A day that already has packs does nothing, so a repeated run is safe.
- Picture check (`supabase/functions/_shared/articleImage.ts`): only the article's own cover picture is fetched, with an 8 second limit and a 5 MB cap. It must be a picture type. A missing or broken picture leaves the pack with no picture and a plain note. Nothing is invented in its place.
- Saving: each row goes through `minds_save_pack`, the same database door as before. The database still refuses it when Takeover is off or Kill stops the minds. A refused row stops the run and says how many were saved.
- Video stays blocked with "video not made yet" in this slice. Nothing renders a video on the live site yet, and no public video address is made.
- Local day: the owner's browser sends the local day, the same as the placement run. Public copy uses only the UTC windows and never names a country.
- Distribution retired: the sidebar link is gone, and `/admin/automation/distribution` opens Minds once (`RetiredDistributionRedirect` in `AdminApp.tsx`). The old page file stays in the repository, unused.
- Tests: `articleImage.test.ts` (picture rules, timeouts, sizes, types), `dayPacks.test.ts` (Takeover off, Kill, one article, no key, four rows, Auditor block on one channel, pairwise captions, clean copy), `dayPacksDb.test.ts` (real saves in PGlite, the database refusing with Takeover off or Kill on, a repeat run adds nothing), `adminRbac.test.ts` (no Distribution link, redirect in place).
- Not yet run in a live Edge function: Deno is not available here, so the function is parse-checked only. No migration was added in this slice.

## Phase 5 slice 2: Connections (the six doors' details, typed once)

- The six free doors are Telegram, Bluesky, Mastodon, Tumblr, Discord and Blogger. Their fields are listed once in `supabase/functions/_shared/doorRegistry.ts`. A door is "connected" only when every field is saved. That is not a live test, and nothing is posted.
- Migration `20261011090000_door_connections_catalog.sql` (not applied) adds 12 rows to the existing secret catalogue. Telegram's bot token and Tumblr's three existing keys are reused. The migration adds rows only. It makes no table and no function.
- Values are saved by the owner-only functions the Keys page already uses (`automation_secret_save`, `automation_secret_delete`, `automation_list_secrets`). They go to Vault. A saved value is never shown again. Tokens and webhooks are typed in hidden fields. Names and IDs are typed in plain fields.
- The page is `/admin/ai/connections` (`src/admin/pages/AdminConnections.tsx`). It is reached by a plain "Connections" link on the Minds page. It is not a tab. Only the owner can see it (`automation.keys`).
- The four gated channels are not doors. The page says they stay manual.
- Tests: `doorRegistry.test.ts` (six doors, no gated channel, every field is a real catalogue name, status rules, inherited names rejected), `doorConnectionsCatalogDb.test.ts` (migration in PGlite: rows present, once each, kinds match, safe to repeat, no table, no function, no Vault call), `adminConnections.test.tsx` (the page in jsdom: states, no value shown back, trimmed save, empty and failed saves, remove asks first, only the three owner functions), `connectionsRoute.test.ts` (route, permission, no tab, Minds link).
- Not yet: the connection test buttons. Telegram and Discord post from slice 3, Bluesky and Mastodon from slice 4, and Tumblr and Blogger from slice 5 (below).

## Phase 5 slice 3: the day run posts to Telegram and Discord

- The day run (`minds-run-placement`) now has a door step after the packs. It runs only when Takeover is on and Kill is off, the same gate as the rest of the run. With Takeover off nothing is read or sent. The door step runs even when Gemini has no key, because it needs no Gemini.
- Open doors in this build: Telegram and Discord (`OPEN_DOORS` in `supabase/functions/_shared/doorPosts.ts`). The other four doors are not built yet, so they are not posted to.
- A door posts only when every one of its fields is saved (`doorStatus` in `doorRegistry.ts`). A partly saved door is "not connected yet".
- Each door gets at most one post per local day, and each article goes to a door once, in any status. A failed post is recorded and is not retried. The next run can use the next fresh article.
- Only articles published in the last seven days are sent. The text is one plain line, "New on the blog: <title>", and the article link under it. A title with a dash, a country name, or non-US money is not sent (`copyProblem`, the same rule as packs).
- Order for each door: check it is connected, check today's cap, pick the article, reserve the post (`minds_reserve_door_post`, which the database refuses when Takeover is off or Kill stops the minds), send, then finish (`minds_finish_door_post`). The reserved row is "queued" until it is finished, so a crash in the middle leaves a visible row, not a silent repeat.
- The senders (`supabase/functions/_shared/doorAdapters.ts`): Telegram's bot route (`sendMessage` to the chat) and a Discord webhook (`?wait=true`, so the message id comes back). Each has a time limit. Reasons are plain and never include the token, the webhook address, or the provider's raw text. A webhook address is checked (https, a Discord host, the webhook path) before any request.
- Migration `20261011100000_door_posts.sql` (not applied): table `minds_door_posts`, owner-only read, unique per owner, door and article, a cap of one per door per local day in the reserve function, and the two functions for the service role only. No insert, update or delete for signed-in users.
- The day run's reply names what happened for each door, in plain words. Briefing "What went out" does not list door posts yet. That is a later slice.
- Tests: `doorPosts.test.ts` (open doors, the window, the picks, the text, copy refusals), `doorAdapters.test.ts` (request shape, refusals, timeouts, no secret in any reason), `runDoors.test.ts` (gates, connected checks, caps, failures, no secret in details or logs), `doorPostsDb.test.ts` (PGlite: reservation refusals, one per door per day, finish rules, owner-only read, service-role-only functions), `doorWiring.test.ts` (the day run calls the step in order, behind the gate, and the step never writes articles).
- Not tested live: no real Telegram or Discord message was sent. This sandbox cannot reach those services, and no token or webhook was used. The Edge function is parse-checked only (no Deno here). Nothing is deployed.

## Phase 5 slice 4: the day run posts to Bluesky and Mastodon

- Open doors are now Telegram, Discord, Bluesky and Mastodon (`OPEN_DOORS` in `supabase/functions/_shared/doorPosts.ts`). Tumblr and Blogger are not open yet. The four gated apps stay manual and are never posted to.
- Per-door text limits: Telegram 1000, Discord 1000, Bluesky 300 characters (counted by code points), Mastodon 500. The title is clipped to fit, and the link is always kept whole. If the link alone does not fit, the article is skipped with "the article link is too long for this door." Nothing is cut in the middle of a link.
- Bluesky (`sendBluesky`): sign in at `bsky.social` with the handle and an app password, then write one `app.bsky.feed.post` record. The link at the end of the text gets a link facet, so it is clickable. Other Bluesky hosts are not supported. A handle in the wrong form is refused before any request.
- Mastodon (`sendMastodon`): one status to `/api/v1/statuses` with the access token. The reserved row id is sent as the `Idempotency-Key`, so a repeat of the same post is not made twice. The server address must be https with no path, query, or user name.
- The send function now receives the reserved row id as its key for every door. Doors that do not use it ignore it.
- Not-connected doors are listed on one line: "Not connected yet: Telegram, Bluesky, Mastodon." Other messages are unchanged.
- Migration `20261011110000_door_posts_open_more.sql` (not applied) replaces `minds_reserve_door_post` so that it accepts Bluesky and Mastodon. Nothing else in the table or the rules changes. A test checks that the SQL list of open doors matches `OPEN_DOORS` in the code.
- Tests: `doorAdaptersBlueskyMastodon.test.ts` (sign-in and post steps, facets counted in bytes, handle and server checks, refusals with no password or token in any reason), and updates to `doorPosts.test.ts`, `runDoors.test.ts` (all four doors in order, each with its row id as the key, Bluesky length limit, Bluesky link-too-long skip), `doorPostsDb.test.ts` (the four doors accepted, the refused doors, SQL list equals `OPEN_DOORS`), and `doorWiring.test.ts` (four senders, Mastodon key).
- Not tested live: no Bluesky or Mastodon post was sent. This sandbox cannot reach those services, and no account or token was used. The Edge function is parse-checked only (no Deno here). Nothing is deployed.
- Known risk: a `finish` error can leave a row "queued", which blocks that door for the rest of that day. This is not fixed in this slice.

## Phase 5 slice 5: the day run posts to Tumblr and Blogger (all six free doors open)

- Open doors are now all six free doors: Telegram, Discord, Bluesky, Mastodon, Tumblr and Blogger (`OPEN_DOORS` in `supabase/functions/_shared/doorPosts.ts`). The four gated apps (Instagram, TikTok, Facebook, Pinterest) are still manual and are never posted to.
- Tumblr (`sendTumblr`): one published post on the blog, with a text block (the heading line) and a link block (the article address). The request is signed with OAuth 1.0a (HMAC-SHA1). The signing is checked against the published OAuth example. The four Tumblr keys are only used to sign; none is put in a reason or a log. A blog name may be written with or without `.tumblr.com`. The post id is read as text, because Tumblr ids are larger than JavaScript numbers can hold exactly.
- Blogger (`sendBlogger`): the refresh token is exchanged at Google's token address for an access token, then one post is made on the blog with the heading as the title and a link paragraph as the content. The title and link are escaped, so nothing in the post can add markup. The blog ID must be digits only.
- Both posts are public as soon as they are sent. Tumblr posts are published (not drafts). Blogger posts are published by default.
- Migration `20261011120000_door_posts_open_all.sql` (not applied) replaces `minds_reserve_door_post` so that it accepts all six doors. The table's own check already listed all six. A test checks that the SQL list matches `OPEN_DOORS` in the code.
- Tests: `doorAdaptersTumblrBlogger.test.ts` (the OAuth encoding and the published signature example, Tumblr request shape and refusals, the text split, Blogger token exchange, escaping, refusals, no secret in any reason). Updated: `doorPosts.test.ts`, `runDoors.test.ts` (all six doors in order, each with its row id as the key), `doorPostsDb.test.ts` (six doors accepted, other doors refused, SQL list equals `OPEN_DOORS`), `doorWiring.test.ts` (six senders).
- Not tested live: no Tumblr or Blogger post was sent, and no keys or tokens were used. This sandbox cannot reach those services. The Edge function is parse-checked only (no Deno here). Nothing is deployed.
- Known risk, as before: a `finish` error can leave a row "queued", which blocks that door for the rest of that day.

## Phase 5 slice 6: connection test buttons and the Phase 5 close-out

- Each door card on Connections has a "Test connection" button. It is enabled only when every field of that door is saved. It shows one plain line. The line comes from a fixed list of five words, never from the provider's reply.
- The test is read-only. Telegram reads the chat (`getChat`). Discord reads the webhook's own address without its query. Mastodon checks the account (`verify_credentials`). Tumblr reads the blog info (OAuth-signed GET). Blogger exchanges the refresh token and reads the blog record. Bluesky signs in only. Nothing is posted, and `minds_*` write functions are never called. A test in `doorConnectionTests.test.ts` records every request for all six doors and proves that no posting address is reached.
- The check runs in a new owner-only function, `door-connection-test`. It reads the saved values on the server through the internal Vault read. The browser sends only the door id. The function replies with the door, one status word and the fixed line. It never logs. It clears the values after each check. It is limited to 6 tests per owner per 10 minutes, with its own action name.
- Status words: connected (the door answered; nothing was posted), invalid (the door did not accept these details), not_connected (save every field first), rate_limited, unavailable.
- Shared helpers now exported from `doorAdapters.ts`: `normalizeBlueskyHandle` and `tumblrBlogName` (used by both the senders and the test), `oauthAuthorization` (OAuth 1.0a), `withTimeout`, `readJson`.
- Tests: `doorConnectionTests.test.ts` (17), `doorConnectionWiring.test.ts` (the function is owner-only, reads only through Vault, accepts only a door id, is rate limited, posts nothing, logs nothing, and replies with the fixed shape), and `adminConnections.test.tsx` (the button is disabled until saved, sends only the door id, shows only the fixed line, never shows an unknown status).
- Not tested live: no test was run against a real Telegram, Discord, Bluesky, Mastodon, Tumblr or Google account. This sandbox cannot reach them, and no keys were used. The new function is parse-checked only (no Deno here).

### PHASE 5 REPORT (close-out)

What Phase 5 built, by slice:
1. Slice 1: packs from a day run, the article picture check, the Distribution page and sidebar hidden.
2. Slice 2: the Connections page (one page, six doors), the door registry, the catalogue migration.
3. Slice 3: the day run posts to Telegram and Discord, with the door rules, the runner, and the first door table.
4. Slice 4: Bluesky and Mastodon.
5. Slice 5: Tumblr and Blogger. All six free doors are open.
6. Slice 6: the connection test buttons, and this report.

What is still not done, or not verified:
- No door has been tried live. The six senders and the six connection checks are tested only against fake answers.
- Nothing is deployed. The Edge functions `minds-run-placement`, `automation-keys` and `door-connection-test` are source only (parse-checked, not run on Deno).
- Migrations `20261011090000`, `20261011100000`, `20261011110000` and `20261011120000` are not applied. They ship at the Phase 6 merge, as the plan says.
- Known risk: a `finish` error can leave a door post "queued". That blocks the door for the rest of that local day. It is not fixed yet.
- Known gap: the Keys page also lists the twelve door fields. A tidy-up can come later.
- The four gated channels (Instagram, TikTok, Facebook, Pinterest) stay manual. No posting API is used for them.
- Takeover is still off by default. Nothing is turned on by this phase.

## Phase 6 slice 1: the save-failure fix, the Executioner kill path, and the Keys page

- **A failed save no longer stops the day's door step.** Before, a failed save after a successful post threw out of the whole step. The step then reported "Nothing was posted" (wrong), and the doors after it did not run that day. Now the save is tried three times (`FINISH_ATTEMPTS`, with short waits). If it still fails, that door is logged as failed ("posted, but the record could not be saved. Check the log.") and the other doors keep going. The post is counted as posted, because it went out.
- **The same door does not post again that day after a failed save.** The row stays queued, and the day cap counts it. This is deliberate: Telegram, Discord, Bluesky, Tumblr and Blogger cannot tell a repeat from a new post, so a second send could publish the article twice. The door posts again on the next local day, with the next article. This is a decision for the owner: a same-day retry of the save is not possible without also storing the post's reference on the row, which needs a database change.
- **Any error while sending or reserving is contained per door.** A send that throws is recorded as failed. A reservation that throws is skipped with "Nothing was posted", because nothing was sent. A failed log write is ignored, so it cannot hide a post that went out. A failed read of the saved values skips that door, and nothing is sent for it.
- **Kill on the Executioner stops the door step before any saved value is read.** This was already true (the gate in the runner); a test now proves it: no secret is read, nothing is reserved, nothing is sent.
- **The Keys page no longer lists the door details.** Those are typed once on Connections. The page filters out the door names (`keysWithoutDoorDetails` in `src/lib/automationKeys.ts`). The filter uses the same list as Connections, so the two cannot drift apart.
- **Not done in this slice:** a custom Bluesky server address. It needs a new field, a catalogue row and a database change, so it is left for later. Bluesky accounts still have to be on bsky.social.
- Tests: `runDoors.test.ts` now has 25 cases (new: save fails once then works; save fails every time; no same-day second send; next-day next article; send throws; reserve throws; read throws; Kill on the Executioner reads nothing). `automationKeys.test.ts` covers the Keys filter.
- Not tested live: no door was contacted. Nothing is deployed.

## Phase 6 slice 2: the twelve doors in the catalogue and the database

- **The door list is now twelve.** `DOOR_IDS` in `supabase/functions/_shared/doorRegistry.ts` lists the six from Phase 5, then Medium, YouTube, Pixelfed, WordPress.com, Podcast and Vimeo. The four gated channels (Instagram, TikTok, Facebook, Pinterest) are not doors and are not in the list.
- **Connections shows all twelve**, from the same list. Each door's details are typed once there.
- **YouTube reuses the three names from Phase 1** (`youtube_client_id`, `youtube_client_secret`, `youtube_refresh_token`). No second copy is made. The Keys page hides them, as it does for every door.
- **Medium is existing-token only.** Medium no longer issues new integration tokens and no longer allows new integrations. A door with a token already in hand can connect; no new token can be made. The official docs call the Medium API no longer supported. Medium's RSS feed is not the Medium door. Owner decision still needed on whether to keep this door at all.
- **Podcast has two plain details** (show title and show author), not a secret. They are still saved through the same Vault functions, so one save path serves every door. The feed itself is built in slice 4.
- **Pixelfed has no default server address.** The owner pastes one. Nothing defaults to any country.
- **New migrations, not applied:**
  - `20261011130000_door_catalog_twelve.sql` adds eight catalogue rows (Medium token, Pixelfed address and token, WordPress.com site and token, Vimeo token, Podcast title and author). It changes no existing row.
  - `20261011140000_door_posts_twelve.sql` widens the door-post table's check to all twelve doors. The reservation function still accepts only the six open doors. A door opens for posting in the slice that builds its send step.
- **Text limits** for the six new doors are set in `DOOR_TEXT_LIMIT`. They are defaults and each send slice confirms them. Pixelfed is 500.
- **The six new doors have no connection check yet.** Each answers "The test for this door is not built yet." and makes no request. Their checks come with their send slices.
- Tests: `doorRegistry.test.ts` (twelve doors, order, names), `doorConnectionTests.test.ts` (the six new doors return `not_built` with no request), `doorConnectionsCatalogDb.test.ts` (new rows on PGlite, safe to repeat), `doorPostsDb.test.ts` (the table accepts the twelve and no gated channel).
- Not done in this slice: no send step, no day-run change, no live test. Nothing is deployed, and no migration is applied to production.

## Phase 6 slice 3: Medium, WordPress.com and Pixelfed send

- **Three more doors post.** Nine doors are open now: the six from Phase 5, then Medium, WordPress.com and Pixelfed. YouTube, Vimeo and Podcast are not open yet (slice 4). The four gated channels are still manual.
- **Medium** posts one public story with a title and a link back. Its canonical link is the article. Medium no longer issues new integration tokens, so this works only with a token the owner already has. Medium's own docs say the API is no longer supported, so this door may close. If Medium refuses the token, the door says so and nothing is posted.
- **WordPress.com** posts one published post with the title and a link back to the article, never the full article. The site is a host name such as `lixxon.wordpress.com`. A pasted `https://` and a trailing slash are removed.
- **Pixelfed needs a picture.** The article's own cover image is fetched and checked (the same check the packs use: an image type, a size under 5 MB, and a fetch that works). The picture is uploaded, then one status with the picture and the link text is posted. An article with no cover is skipped, and the door looks for the newest article that has one. A picture that cannot be used skips the door before any post is reserved, so the day's post is not lost. Pixelfed's server address has no default; the owner pastes one.
- **Each door gets its own check on Connections.** Medium reads the account, WordPress.com reads the site, and Pixelfed checks the account on its server. None of them posts.
- **Database:** `20261011150000_door_posts_three_open.sql` opens the three doors in the reservation function. It is additive and not applied to production. Takeover off, Kill, one post per door per local day, and "no article twice on one door" all still hold.
- **Not verified live.** Nothing was sent to Medium, WordPress.com or Pixelfed (the sandbox cannot reach them). The Pixelfed status fields (`status`, `caption`, `media_ids`, `visibility`) follow Pixelfed's Mastodon-style API and are unconfirmed against a live server.
- Tests: `doorAdaptersSlice3.test.ts` (23 cases: each sender's refusals and success, no token in any reason, the three checks, the picture loader), `runDoors.test.ts` (nine doors; Pixelfed picture rules: no picture, bad picture, loader throws, picks an article that has a picture), `doorWiring.test.ts` (the day run calls the three new senders), `doorPostsDb.test.ts` (the nine doors are accepted, YouTube, Vimeo and Podcast are refused).
- Not done in this slice: YouTube, Vimeo and Podcast (slice 4), the day-run "What went out" view (slice 5), and the freeze (slice 6).

## Phase 6 slice 4: YouTube, Vimeo and Podcast

- **All twelve auto doors are open.** Nine were open after slice 3. YouTube, Vimeo and Podcast join the list in `20261011170000_door_posts_all_twelve_open.sql` (additive, not applied to production). The four gated channels are still manual.
- **A door that needs a file checks the file first.** `DOOR_MEDIA` in `doorPosts.ts` says which kind each door needs: Pixelfed a picture, YouTube and Vimeo a video, Podcast audio, the rest none. A missing or unreadable file skips that door for the day before any slot is reserved, so the day's post is not used up.
- **YouTube and Vimeo send only a real pack video.** No video means "YouTube: no video yet. Nothing was posted." (or Vimeo). The video is read from the `pack-videos` bucket using the `video_path` of a `ready` pack for that article and day. An empty file, a non-MP4 file, and a file over 100 MB are refused. Nothing is ever uploaded as an empty or made-up file.
  - **YouTube:** a refresh-token sign-in, then one resumable upload as a Short, public. Google only accepts the upload address on its own host. An unaudited Google project uploads as private; the door reports that as a note ("kept it private: the Google app is not yet approved for public uploads"), never as public. A YouTube upload uses about 1,600 of the project's daily quota units, roughly six uploads a day on the default quota.
  - **Vimeo:** create the video, then a resumable (tus) upload. The upload address must be on vimeo.com. The door checks that the whole file arrived (the offset must equal the size). Vimeo plan limits vary and the sources disagree, so no number is quoted here; a refusal says "check the upload limit on your Vimeo plan".
- **Podcast sends an episode, not a post.** The send writes one row to `podcast_episodes` (article id, title, description, article link, audio file name, size, and type). No audio file means "Podcast: audio not made yet. Nothing was posted." The audio is the `podcast-audio` bucket file named `{articleId}.mp3`; only `audio/mpeg` is accepted. The table allows one episode per article, a https link only, and an audio name of the expected form only.
- **The show feed is `/podcast.xml`.** `feeds/index.ts` builds it (`type=podcast`), and `api/feeds.ts` and `vercel.json` route to it. The show title, author and cover come from the saved settings on the server. Until all three are set and the cover is a secure link, the feed answers 404 "The podcast is not set up yet." Each episode is an item with a real enclosure (address, byte length, type). An episode with no audio is never listed. Apple Podcasts and Spotify read the feed only after the owner submits it; the app does not submit it. The category is Apple's "Health & Fitness" and the owner can change it.
- **Connections checks, read only.** YouTube signs in and reads the channel (`channels?mine=true`). Vimeo reads `/me`. The podcast cover is fetched and checked for a secure JPEG or PNG under 510 KB. None of them uploads or posts.
- **Podcast cover** is a new Connections field (`podcast_cover_url`), catalogue-only in `20261011160000_podcast_cover_catalog.sql`. The episode table and the two buckets are in `20261011180000_podcast_episodes.sql` (not applied to production). `pack-videos` is private. `podcast-audio` is public, so the feed can link to it.
- **Not wired yet, so these two doors skip in practice.** Nothing in the app saves a pack video to `pack-videos` or sets `video_path` yet: `scripts/pack-video.mjs` renders a local MP4 only. Nothing writes the episode audio to `podcast-audio` yet either. Until those steps exist, YouTube, Vimeo and Podcast will honestly skip with "no video yet" or "audio not made yet". Those steps are an open item for the owner's decision on how media gets made.
- **Not verified live.** No upload, sign-in, or feed fetch reached Google, Vimeo, or a podcast app (the sandbox cannot reach them). The feed was not read by Apple or Spotify. Nothing is deployed.
- Tests: `doorAdaptersSlice4.test.ts` (YouTube and Vimeo refusals, the host check, the sign-in never sent to the upload address, the private note, the read-only checks, the podcast cover rules), `podcastFeed.test.ts` (show readiness, the audio address, only episodes with audio, escaping, no em dash, no country names), `podcastEpisodesDb.test.ts` (PGlite: constraints; public read; no public or signed-in write), `runDoors.test.ts` (all twelve, the skip messages, the file kinds, the private note), `doorPosts.test.ts`, `doorPostsDb.test.ts`, `doorConnectionTests.test.ts` (all twelve checks built).
- Not done in this slice: the day run's "What went out" view and the Buddy how-to for the new six (slice 5), and the freeze (slice 6).

## Phase 6 slice 5: the day run, "What went out", and the how-to

- **The day run covers all twelve doors.** The door step reads `OPEN_DOORS` (twelve), and the send step has a branch for each. The four gated channels have no branch. `dayRunTwelve.test.ts` checks all three points.
- **"What went out" reads the real send log.** `buddy-think` now reads `minds_door_posts` (the owner's own rows, through the owner session) since the owner last looked, and passes it to the briefing as `doors`.
  - A posted row is one line: `Posted to {Door}: "{Article}".` The door's own label is used.
  - A failed row says the door did not post the article, with the send log's plain note. A queued row says the door is still saving.
  - "No mind has sent anything out." appears only when no door post went out in that window.
  - A failed read is shown as "I cannot read the send log just now." It is never shown as nothing sent.
  - The day is not "quiet" when a door post exists or the log could not be read, so a failure is never hidden.
  - At most 8 door lines are shown.
- **The how-to for the six new doors.** Asking how to connect or set up Medium, YouTube, Pixelfed, WordPress.com, Podcast or Vimeo gets fixed steps from `buddyHowTo.ts`. The answer names the Connections page, the fields, and what each door needs (a real video, a real audio file, a picture for Pixelfed). It never asks for a secret in chat and never calls the model. A message that names two doors, or an order with no how-to word, is not treated as a question.
- **Tests:** `buddyWentOut.test.ts` (the send log lines, the caps, failed and queued rows, the quiet rule, the unknown-door filter), `buddyHowTo.test.ts` (detection, routing, the replies), `dayRunTwelve.test.ts` (the twelve doors in the day run, no gated channel), and the existing Buddy suite (382 tests across the Buddy and day-run files pass).
- **Still open:** the send log shows only what the day run wrote. Nothing live has been sent to any door in this sandbox. The how-to replies are plain text. They do not check the owner's saved settings.
- Not done in this slice: the freeze and the PHASE 6 report (slice 6).

## Phase 6 slice 6: freeze

- **Frozen by `phase6Freeze.test.ts` (20 checks, source only):** exactly twelve auto doors, and the day run sends to those twelve and nothing else; the four gated channels and WhatsApp are not doors and have no posting path; takeover is off by default and no migration or seed turns it on; only an owner or founder admin can change Takeover or Kill; a Takeover or Kill refusal stops the door step before any read; a failed save is tried three times and then logged; one article goes to one door once; a missing video or audio skips with a plain reason before anything is reserved; Medium uses an existing token only; Pixelfed has no default server address; the podcast is a show feed at `/podcast.xml`; every Phase 6 migration says it is not applied to production and drops nothing; the door, podcast and briefing modules have no em dash and name no country, city or currency.
- **Not frozen by a test, and not verified live:** no live door, feed reader, or database was reached from the sandbox. Nothing is deployed. No migration is applied to production.
- **Open decisions for the owner:** Medium (existing token only, and Medium's docs say the API is no longer supported); the same-day rule after a failed save (a door that already sent is not sent again the same day); the podcast category (Health & Fitness, suggested); whether the owner's email appears in the feed (not included).
- **Known gap:** the crawler title in `supabase/functions/feeds/index.ts` (the prerender page title) contains an em dash. It was there before Phase 6 and was left unchanged, since it is site brand copy.
- **Phase 7 has not started.**

## Phase 7 slice 1: inherit, same-day retry, podcast settings

- **Same-day retry after a failed save (owner decision).** A post that went out but whose record could not be saved is kept as `queued` with `pending_status = posted`. The door step tries the save three times. If all three fail, the door is not locked until tomorrow: a later run the same day saves that record again. The post is never sent a second time. If the send failed and its record could not be saved, the failure is saved on a later run. If the state of the earlier send is unknown, nothing is sent again that day and the log says so. Migration `20261011190000_door_post_retry.sql` adds the column and the function. It is not applied to production.
- **Podcast.** The category is Health & Fitness. The owner's email is never in `/podcast.xml`: an author or title with an `@` is refused, so the feed is not served until the owner enters a public name. The Connections label for the show author says so.
- **Feed title.** The crawler title in `supabase/functions/feeds/index.ts` now uses a colon, not an em dash. The Phase 6 known gap is closed.
- **Tests.** `runDoors.test.ts` covers the fourth save try on the same day, a save that keeps failing, unknown earlier state, a failed send saved on a later run, and the next day. `doorPostsDb.test.ts` runs the new function against the migration in PGlite. `podcastFeed.test.ts` refuses an email address. `phase6Freeze.test.ts` now scans `feeds/index.ts` for em dashes.
- **Not done in this slice:** pack video and episode audio saving (slices 2 and 3), Web Push (slice 4), the night report (slice 5). Nothing is deployed and nothing is applied to production.

## Phase 7 slice 2: pack picture and video saved to storage

- **What is saved.** A still is a copy of the article's own cover image (the same check the packs already use: https or site path, a picture type, under 5 MB). It goes to the private `pack-stills` bucket at `owner/day/article.ext`. A video is a real MP4 made from that picture by `scripts/pack-video.mjs`. It goes to `pack-videos` at `owner/day/article.mp4`. Only those storage paths are stored. No public address is ever made up.
- **Where it runs.** `scripts/save-pack-media.mjs` is a runner for a machine that has FFmpeg. Run it once a day by hand, for example `node --experimental-strip-types scripts/save-pack-media.mjs --day 2026-10-10`, with `LIXXON_SUPABASE_URL` and `LIXXON_SERVICE_ROLE_KEY` set. Nothing runs on a schedule, and no production cron is attached. It never posts.
- **Database.** Migration `20261011200000_pack_media_saved.sql` adds `minds_packs.still_path`, creates `pack-stills`, and adds `minds_attach_pack_media` (service role only). The function accepts only paths in that owner's folder. A pack waiting for a video becomes `ready` only when the Auditor allowed it, and a pack the owner marked posted is never changed. Not applied to production.
- **Honest skips.** A picture that cannot be fetched, is not a picture, or is too large is skipped with a plain note, and nothing is uploaded or attached. A missing caption, a missing FFmpeg, a failed render, a file that is not an MP4, and a failed upload each leave the pack blocked with a plain reason.
- **YouTube and Vimeo.** The day run already sends them when `video_path` is set, and skips with "no video yet" when it is not. With a saved video they now have a real file to send. The day run is unchanged.
- **Tests.** `packMediaSave.test.ts` uses a 32 x 32 PNG and a one-second 64 x 64 MP4 from `src/__tests__/fixtures/pack-media/`. The two real-render tests run only when `LIXXON_FFMPEG` points to a working FFmpeg (they passed with a local binary). `mindsPacksDb.test.ts` runs the attach function against the migration.
- **Not done in this slice:** podcast audio (slice 3), Web Push (slice 4), the night report (slice 5). Nothing is deployed or applied to production. FFmpeg is not on this sandbox's PATH, so the real-render tests were run only with a local test binary.

## Phase 7 slice 3: podcast episode audio saved, and the feed lists only real files

- **Where the audio comes from.** The owner makes an MP3 for an article (or a tool on the owner's machine makes it). No paid voice service is used. The file is named `<article id>.mp3`.
- **How it is saved.** `scripts/save-podcast-audio.mjs --dir <folder>` checks each file and saves it to the public `podcast-audio` bucket under that name. A file is saved only when its name is an article id with `.mp3`, its bytes are an MP3 (an ID3 tag or an MPEG frame), the article exists, and no audio is saved for it yet. Audio that is already saved is never replaced. It never posts and never runs on a schedule. It needs `LIXXON_SUPABASE_URL` and `LIXXON_SERVICE_ROLE_KEY`, and it never prints them.
- **The episode.** When the day run finds that file, it writes one `podcast_episodes` row with the file's path, its real size and `audio/mpeg`. No file means the podcast door is skipped with "audio not made yet." Nothing is posted.
- **The feed.** `/podcast.xml` lists an episode only when it has a saved file and a real length. It has no enclosure for anything else. The show is Health & Fitness. The owner's email is never in the feed.
- **Tests.** `podcastAudioSave.test.ts` uses a one-second, 4.4 KB MP3 fixture in `src/__tests__/fixtures/podcast/`, and fake storage. It covers the name rules, the MP3 check, the article check, no replacement, storage failures, the day run's file name, and the feed's enclosures.
- **Not done here:** Web Push (slice 4), the night report (slice 5). Nothing is deployed, no production cron is attached, and no migration was added in this slice (the bucket and table are from slice 4 of Phase 6, still not applied to production).

## Phase 7 slice 4: notable events buzz the owner's phone

- **Which events buzz.** Doors posted, gated packs ready, a sale or product click, a new traffic kind, the Auditor stopping something, a door step that broke, and a mind finishing a real job. The list is `BUZZ_KINDS` in `supabase/functions/_shared/notablePush.ts`. Takeover, kill, order, article, and night-report events are written to the list but do not buzz. A heartbeat never buzzes and is not a notable kind.
- **Which events are written today.** `door_posted` (once per day run, when at least one door posted), `pack_ready` (once per day run, when a gated pack was saved as ready), `mind_failed` (the door step threw), and `auditor_blocked` (the Auditor stopped an edit). `sale`, `product_click`, `traffic_new_kind`, and `job_finished` are defined but nothing produces them yet, because the repo has no sales, click, or traffic table and no job-finished producer.
- **How it sends.** The day run writes the event, then calls the existing Web Push sender (`webPush.ts`) with the VAPID values already in Vault (`vapid_public_key`, `vapid_subject`, `vapid_private_key`). No second push vendor. Each confirmed device gets one short notification titled "Buddy", with a line of words, and a tap that opens `/buddy`. Buddy stays the only voice to the owner. The payload has no device, address, or key in it.
- **Statuses.** Each event records what the push did in `minds_notable_events.push_note`: `sent`, `no_device`, `not_configured`, `failed`, or `not_buzzing`. A `no_device` or `not_configured` result is also written once to the daily log with the plain words: "no device", or the register copy "To turn push on: enter your VAPID values, then open /admin/settings on your phone and tap Register this device." A push problem never fails the day run. A device the push service says is gone is turned off.
- **Database.** Migration `20261011210000_notable_push.sql` adds the new kinds to the table check, keeps every existing kind, and adds `push_note`. It is not applied to production.
- **Tests.** `notablePush.test.ts` uses fake sends only. It covers which kinds buzz, the payload, one send per device, gone devices, the no-device and no-keys states, and a send that throws. `notablePushWiring.test.ts` checks that the day run uses the helper, never sends a heartbeat, and never calls the provider directly. `mindsPacksDb.test.ts` checks the new kinds and the push note values on PGlite.
- **Not done here:** no real push was sent to any phone. The Edge functions are not deployed or run live. "Register this device" is on `/admin/settings` (checked in the code), not tested in a browser. The night report (slice 5) is not in this slice.

## Phase 7 slice 5: night report writer, honest skips, Medium closed

- **The night report.** `_shared/nightReportRun.ts` is the one place it is called from. `runNightReport(client, ownerId, day)` checks the day is a real calendar day, then reads only that owner's log, events and orders for the day and saves one report. The owner-only function `buddy-night-report` calls it, with the owner's session checked first. An empty night is still written, and it says that nothing ran. A failed read writes nothing. A second write for the same day is refused by the database.
- **Not on a timer.** `scripts/night-report-schedule.sql` holds the schedule only as comments. It is NOT APPLIED. A cron job has no owner session, so the owner check cannot pass from cron as written. That must be solved before the schedule is ever turned on.
- **Not in the morning briefing.** The briefing reads the day's log and events, never the night report. A test checks that `buddyBriefing.ts` does not mention the night report.
- **Honest skips in Problems.** A door step that did not run for a plain reason is written to the daily log as `skipped`: "no video yet", "audio not made yet", "no picture yet" (Pixelfed), or an article with no picture. The morning briefing's Problems section lists these lines (at most six), with blocked packs such as "video not made yet". An honest skip also stops the day from being called quiet. The words live in one list, `_shared/honestSkips.ts`.
- **Pixelfed.** With no picture, the skip now says "Pixelfed: no picture yet. Nothing was posted." It is logged and nothing is reserved.
- **Medium closed.** A "gone" answer (HTTP 410) from either Medium call marks the door closed. The day run says "Medium: this door is closed. Nothing was posted.", logs it as failed, and sends to Medium only once in that run. No scraping and no paid route. Medium's exact reply when it closes is not known, so any other error still says "did not take it". Each day the door is tried once more, which costs one or two requests.
- **Tests.** `nightReportRun.test.ts` uses a fake database client: an empty night, a busy night, a skipped-only night, another owner's rows, a failed read, a second write, and a bad day. `phase7Slice5.test.ts` covers the Medium answers, the honest-skip words, the Problems section, and the briefing's separation from the night report. Added cases in `runDoors.test.ts` check the logged skips and the closed door through the day run.
- **Not done here:** no timer is set. Nothing was deployed, no migration was added, and the Edge functions were not run live. The night report has not been opened in a browser.

## Phase 7 slice 6: freeze and PHASE 7 REPORT

- **Freeze.** `src/__tests__/phase7Freeze.test.ts` (27 checks). It calls the real functions with small local fixtures and fake senders, and reads the source only for wiring. It covers: takeover off by default; three same-day save tries and a fourth allowed, with nothing sent twice; the pack picture and video and the episode audio as real files in the owner folder; YouTube, Vimeo and Podcast skipping only when media is missing; the podcast as Health & Fitness, with no owner email and no enclosure for an episode without audio; notable events buzzing and quiet kinds not; the night report callable, with an honest empty night and a bad day refused before any read; no night report in the morning briefing; honest skip words; Medium's closed answer; the four gated channels sending nothing; no em or en dash in the feed crawler title; twelve auto doors.
- **Not merged, not deployed.** No pull request, no merge to `main`, no deploy, and no Phase 7 migration applied to production. Every Phase 7 migration says it is not applied.
- **Known gaps.** Sales, product clicks, new traffic kinds, and finished jobs now have producers (see the Phase 7 follow-up below). No live push has been sent to a phone. The night report has no timer, and a timer needs an owner session first. Medium's closed answer is assumed to be HTTP 410. The Edge functions are not deployed or run live, and Deno code is checked for syntax only.

## Phase 7 follow-up: notable events from the shop

- **What now produces the four kinds.** `sale` (a paid order in the last 48 hours), `product_click` (one summary per local day), `traffic_new_kind` (a click source with clicks today and none before today) and `job_finished` (a placement job that returned `applied`, so an article change really went live).
- **Written once.** Each event has a source key (`sale:<order>`, `clicks:<day>`, `traffic:<source>`, `job:<order>`). Migration `20261012000000_notable_sources.sql` adds the column and a unique index per owner. It is additive and not applied to production. Until it is applied, events are still written, just without a key.
- **Where it runs.** Only in the owner-started day run (`minds-run-placement`), after the free doors. It runs only when Takeover is on and Kill allows it. Nothing schedules it. A failed read is named in the result, and the rest still runs. A failure never fails the day run.
- **Limits, stated plainly.** The click count is as of the first day run that sees that day. A sale older than 48 hours is not announced. Sales only buzz on days the day run runs.
- **Tests.** `notableSources.test.ts` (rules, fake reads and writes), `notableSourcesWiring.test.ts` (reads never write; key sent only when present), `notableSourcesDb.test.ts` (the unique index in PGlite). No live push is sent.

## Phase 8 slice 3: chat can run the switches when Takeover is on

- Chat understands one pause, stop, or start request: a free door ("Pause the Telegram door"), one mind ("Stop the Analyst"), everything ("Stop everything"), or clearing the kill ("Start the CEO again"). Rules live in `supabase/functions/_shared/buddyControls.ts`.
- Takeover on: the change is made now, and one line is written to the daily log (mind `buddy`). Takeover off or unreadable: the request is saved as waiting and nothing changes. The held order never runs as an article change; the lane check holds every control request.
- Refused in chat: the Auditor (it stays on), a Takeover switch (the owner does that), and a mix of minds in one sentence.
- "Make the packs" is the same run-today request as "run today".
- A paused door is skipped by the day run's door step, and the run says "Paused by you: ...". The pause list is one new column, `minds_controls.paused_doors`, in `20261013000000_minds_paused_doors.sql` (NOT applied). Until that migration is applied, chat pause requests fail honestly, and the day run pauses nothing.
- Known copy gap: a kill set from chat shows the existing trigger line "Set by the owner in Minds." in the notable events. The daily-log line above it is the accurate record. Not changed here.
- Freeze check for this slice: `src/__tests__/buddyControls.test.ts` and the paused-door block in `runDoors.test.ts`.

## Phase 8 slice 4: the four RSS doors

- Flipboard, Google News, Microsoft Start and SmartNews are the four RSS doors. They need no secret. The site's `/rss.xml` is the door: it already lists every published article. Buddy pings Google's free WebSub hub (`https://pubsubhubbub.appspot.com/`) with a publish request for that feed. Rules and the ping live in `supabase/functions/_shared/rssHub.ts`.
- The feed now declares the hub in its channel (`feeds/index.ts`), so the hub knows where to fetch.
- Log lines say "RSS updated and pinged for Flipboard", never "posted". Skips for these doors say "Nothing was pinged." The day run's door notable counts real posts only, so a ping is not reported as a post.
- A door with no fields reads as Connected. Test connection says "Nothing to test here" for the RSS doors. The owner still adds the feed address in each service by hand; Buddy does not submit it.
- The four gated channels (Instagram, TikTok, Facebook, Pinterest) still have no door and no send.
- Database: `20261014000000_door_posts_rss_four.sql` widens the door-post check and the reserve function to sixteen doors. `20261013000000_minds_paused_doors.sql` (slice 3) now lists the four new ids too. Both are NOT applied.
- Freeze changes, stated plainly: the Phase 6, Phase 7, door registry, door-post, and day-run tests used to pin exactly twelve doors. They now check that the twelve earlier doors are all still open, and that the only additions are the four RSS doors. Some runDoors tests pause the RSS doors in their default input so their twelve-door counts still mean what they meant. Wording tests now match the new per-door template; the text for the twelve posting doors is unchanged.
- Not checked live: no ping has been sent to the real hub from this sandbox. The hub response (204 expected) is unverified until the first live run.

## Phase 8 slice 5: pack videos have sound

- Every pack video now has a voice track: 1080 x 1920, captions, AAC audio, and the voice padded or sped up (at most 1.2 times) to exactly ten seconds. Voice lengths over 12 seconds are refused, so the captions are never cut.
- Voice order (`scripts/pack-voice.mjs`): Gemini text-to-speech first, on the owner's existing Gemini key, the same `gemini_api_key` secret Buddy uses. The saver reads it through the service role and never prints it. The model is `gemini-3.8-flash-tts`, voice `Kore`. If that call is refused or fails, the local program is used: `espeak-ng` or `espeak` on the runner (free, installed with the OS package manager). `LIXXON_ESPEAK` can name a specific program. Nothing paid, and no stock music.
- Free-tier caveat for the owner: Google's pricing page lists Gemini TTS as "free of charge" on the free tier. Third-party write-ups say free-tier inputs may be used to improve Google's products and that free-tier limits are not published. The pricing page itself was not readable from the sandbox, so treat "free" as a claim to re-check on Google's page before relying on it.
- No sound, no video: if there is no voice (no key that works, no local program), the voice is too long, or the render has no audio, the MP4 is deleted and the owner sees "The video has no sound yet. No video was saved." Nothing is uploaded or attached.
- The saver (`scripts/save-pack-media.mjs`) refuses any MP4 that has no sound track (`checkVideo` reads the handler box for `soun`). There is no "silent on request" switch: the owner has not asked for one, so none is built.
- Tests: `packVoice.test.ts` (fake fetch, fake local program, key never echoed) and the updated `packVideo.test.ts`, `packMediaSave.test.ts`, `phase7Freeze.test.ts`, `buddyPhase4Freeze.test.ts`. The fixture `tiny-voiced.mp4` has a real AAC track; `tiny.mp4` stays silent and is refused.
- Not checked live: the Gemini call was not made from this sandbox (the Gemini host is not on its allowlist), and no local speech program is installed here. The first live run on the owner's runner is the real test.

## Phase 8 slice 6: freeze and report

- Freeze: `src/__tests__/phase8Freeze.test.ts` (32 checks). It calls the real functions where it can and reads source only for wiring. It covers: Takeover off by default and never set on by a Phase 8 migration; a run request and a pause request wait when Takeover is off; the Auditor cannot be switched off; Gemini model `gemini-3.8-flash`; no-key line; never-list blocks; sixteen auto doors, all open, including the four RSS doors; four gated channels are not doors; the RSS ping (fake hub) logs "pinged", never "posted"; a sale fixture gives one USD sale notable; an empty day gives none; a heartbeat never buzzes; voiced MP4 has an audio track and a silent one is refused; Gemini is tried before the local program; the briefing keeps its seven sections; no Instagram, TikTok, Facebook, Pinterest or WhatsApp sender in the day run or in Buddy; no paid voice or scheduling service in owner code; forbidden owner-copy words absent; no Nigeria, Naira, Lagos or em dash in new public text; the key is not printed.
- Known gaps, stated plainly:
  - A single door send failure does not write its own notable. The notable for doors counts real posts only (`door_posted`, RSS pings excluded). A whole door step that cannot run writes `mind_failed`.
  - The older Admin distribution code (`supabase/functions/automation-distribution`, `src/admin/pages/AutomationDistribution.tsx`) still has WhatsApp, Facebook and Pinterest senders from before Phase 8. Buddy and the day run do not import it. It is left as it was, for the owner to decide.
  - `scripts/video-template.mjs` has a code default named "Lagos daylight (default)". It is not shown as reader copy in the code checked. It should be renamed.
  - The briefing was not changed in Phase 8. Its seven sections were already in place.
- Not proven live: Gemini text-to-speech and the Buddy Gemini call (the host is not on the sandbox allowlist, and no key was tested here); the RSS hub's 204 reply; migrations `20261013000000` and `20261014000000` (not applied); a local speech program on the runner (none installed here).
- Full suite with FFmpeg enabled: 136 files, 1698 tests passed. Type check and lint pass on the new files.
- Nothing was merged, deployed, or applied to production. No pull request was opened.

## Phase 9 slice 1: inherit the Phase 8 notables

- The morning briefing now reads the Phase 8 notables from `minds_notable_events`, for the kinds `BRIEFING_NOTABLE_KINDS` lists. Sales, product clicks and new traffic show under "Money & readers". The door summary shows under "What went out". Blocked placements and orders show under "Your jobs". A failed door and a failed mind show under "Problems", and the next move says to look at them. A ready pack makes the next move "post it by hand". A notable makes the day not quiet. A failed notable read says so under Problems.
- A night report is never read by the briefing. Only the listed kinds are read.
- A door send that did not go out (outcome `failed`) writes one `door_failed` notable per door per day, from `doorFailNotices` in `runDoors.ts`. It does not buzz the phone. A post that went out but whose record did not save is not a failed send, and a skipped door is not one either.
- An RSS door that posted now reads "RSS updated and pinged for <label>" in the briefing, and a failed RSS ping reads "did not take the ping". Non-RSS doors keep "Posted to" and "did not post".
- Kill and Takeover changes made from chat now say "Stopped from chat." or "Started again from chat." The chat path writes `minds_controls.change_source = 'chat'`. The Minds screen writes `'minds'`, and the trigger reads it.
- The seeded video template is renamed to "Clear daylight (default)" in a new migration. The code default, the assertion script and its test use the same name. The applied seed migration was not edited.
- The legacy Distribution page is not an owner route. `/admin/automation/distribution` redirects to Minds, and the sidebar has no link. `AdminAI.tsx` is not imported by any route. The `automation-distribution` function still answers WhatsApp, Facebook and Pinterest requests with "manual-kit only", and Telegram and the owner's own newsletter test are still reachable by a direct request with an owner session. No screen calls them. This is left for the owner to decide.
- New migrations, all NOT applied: `20261015000000_notable_door_failed.sql` (kind check, keeps every earlier kind), `20261015010000_video_template_clear_name.sql` (seeded row rename), `20261015020000_minds_controls_change_source.sql` (column and trigger copy).
- Tests: `buddyNotables.test.ts` and `phase9Slice1.test.ts`. The Phase 7 freeze checks read the briefing source for the word "night", so the briefing comments avoid that word.
- Not proven live: the migrations are not applied. The edge functions (`buddy-think`, `minds-run-placement`) are not type-checked here because they use Deno imports. Their changes are small, and the pure modules they call are checked.

## Phase 9 slice 2: the night report on a clock

- The night report is written by a clock in code. `_shared/nightReportClock.ts` holds the time rules and `runNightClock`. A night is due from 23:30 on the owner's clock. Until 04:00 the night that just ended is still written, in case the 23:30 tick missed it. Outside those hours the clock reads and writes nothing.
- The clock writes through the same writer as the owner button (`runNightReport`, then `writeNightReport`). It runs for each owner (role `owner` only) and writes the night once. A second tick for the same night is refused by the database and counted as already written.
- An empty night is written honestly: "Nothing ran last night. No mind took an action." A failed read writes nothing, so a failure is never shown as a quiet night.
- The clock is `supabase/functions/buddy-night-clock`. It has no owner session. It checks the `x-internal-secret` header against `INTERNAL_FN_SECRET`, the same way the other scheduled functions do. `verify_jwt` is false for it, as for them.
- The schedule is `supabase/migrations/20261016000000_buddy_night_clock.sql`: every 30 minutes, through pg_cron and pg_net, with the Vault credentials. It is guarded, and it is NOT applied. The old note in `scripts/night-report-schedule.sql` now points here. That file still has no live cron line.
- The morning Continue never loads a night report. Continue calls the `briefing` action, which reads the day's rows and events. It never reads `buddy_reports`, and the reports list shows titles and dates only.
- Tests: `buddyNightClock.test.ts` (time rules, the clock and writer against an in-memory database, the schedule source, and the briefing path).
- Not proven live: the schedule is not applied, so no night has been written by the clock. Whether the Vault credentials exist in production is unknown until the owner applies the migration.

## Phase 9 slice 3: the reader message tap

- Buddy checks the reader form table (`contact_messages`) once per briefing. The read asks only for a count of rows since the owner last looked (`head: true`). It never reads a name, an address or the message text.
- A message adds one line under "Money & readers": "There is a message for you." For more than one, "There are N messages for you." A failed read says "I cannot read your messages yet." Any message makes the day not quiet. The next move says "Read the new reader message in Admin."
- Buddy never replies to a reader. Nothing in `buddy-think` writes to `contact_messages`, the email queue or any mail sender. The test `buddyReaderMessages.test.ts` checks that from source.
- Comments and the email queue were not used. Comments are public reader content, and the email queue is outbound. The reader form table already exists and already has an admin-only read policy, so no new flag or table was needed.
- Not proven live: the owner's session reading `contact_messages` through row-level security (the policy is the admin-all policy from the security migration), and the exact count on a real form.
