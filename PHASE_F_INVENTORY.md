# PHASE F inventory: every product lock

Read-only walk of the lock list at the start of Phase F (tip `2e987e1`, Phase E closed).

How to read the table:

- **Code** is the file(s) that implement the lock.
- **Tested** names the test file where the lock is already pinned, or `to freeze` when no existing test was found and the row is pinned in `src/buddy/phaseFFreeze.test.ts` (slice 6).
- **Status**: `ok` (code and test present), `fix` (a gap found, fixed in the slice shown), `ok, freeze` (code present, pinned in the F freeze).

## Buddy

| # | Lock | Code | Tested | Status |
|---|---|---|---|---|
| B1 | Only Buddy talks; no mind has a chat route | `src/buddy/BuddyChat.tsx`, `src/buddy/BuddyChanges.tsx` (no text box) | `buddyPhase3Freeze.test.ts` (no mind screen; Changes has no text box) | ok |
| B2 | Ask about a mind → daily log, not a guess | `supabase/functions/_shared/buddyRouter.ts` (`mind_log` route) | `to freeze` (router answers from the log) | ok, freeze |
| B3 | Pass an order → waiting / done / blocked lines | `buddyOrders.ts`, `buddyOrderPolicy.ts` | `phaseBFreeze.test.ts` ("every order line says waiting, done or blocked") | ok |
| B4 | Greeting + Continue | `src/buddy/BuddyGreeting.tsx`, `BuddyChat.tsx` (`continueFromGreeting`) | `to freeze` | ok, freeze |
| B5 | Four looks: Noir Gold default, Ivory Silk, Velvet Opera, Porcelain | `src/buddy/buddyVibes.ts` (`VIBES`, `DEFAULT_VIBE`) | `phaseCFreeze.test.ts` ("four looks and five background minds") | ok |
| B6 | Buddy look does not follow magazine light/dark | `src/buddy/buddy.css` (own `color-scheme`), `buddyVibes.ts` | `to freeze` (no theme import in Buddy files) | ok, freeze |
| B7 | Optional hear-Buddy, off unless the owner turns it on | `src/buddy/buddySettingsStore.ts` (`speakReplies: false`), `buddySpeech.ts` | `to freeze` | ok, freeze |
| B8 | New chat + past chats | `src/buddy/BuddyChat.tsx` (drawer "Past chats", "New chat") | `to freeze` (strings) | ok, freeze |
| B9 | Today's briefing is one thread; Night Reports are a different path | `buddyChatStore.ts`, `BuddyReports.tsx`, `buddy-night-report` | `phase7Freeze.test.ts` ("the report is not recycled into the morning briefing"); `phase9Freeze.test.ts` ("the morning briefing never calls the night writer") | ok |
| B10 | Briefing has many sections, not one blob | `supabase/functions/_shared/buddyBriefing.ts` (seven sections) | `phase8Freeze.test.ts` ("the briefing keeps its seven sections") | ok |
| B11 | Quiet only when every source was read and empty | `buddyBriefing.ts` (rule at line 2) | `to freeze` | ok, freeze |
| B12 | Notables of `BRIEFING_NOTABLE_KINDS`, including `door_failed` | `buddyBriefing.ts` (`BRIEFING_NOTABLE_KINDS`) | `phase9Freeze.test.ts` ("a door_failed notable shows under Problems") | ok |
| B13 | Count-only: messages, comments, refunds, carts; never name, email or body | `buddyBriefing.ts` (`COMMENTS_WORDING`, `REFUNDS_WORDING`, `CARTS_WORDING`) | `phaseDFreeze.test.ts` (counts, quiet at zero, "cannot be read"); `phase9Freeze.test.ts` (message is a count only) | ok |
| B14 | A "next move" line in briefing | `buddyBriefing.ts` (`Your next move`, `nextMove`) | `to freeze` | ok, freeze |
| B15 | Chief-of-staff system text: Takeover off = nothing changes; on = allowed work, tell the owner | `supabase/functions/_shared/buddyThink.ts` (line 51) | `to freeze` | ok, freeze |
| B16 | Show-the-paragraph path; owner writes, Buddy does not rewrite the article | `src/buddy/BuddyChanges.tsx` ("Show the paragraph"), `buddyPhase3Freeze` checksum rules | `buddyPhase3Freeze.test.ts` (changed paragraph refused by checksum; only the chosen paragraph changes) | ok |
| B17 | "There is a message for you"; Buddy never replies to readers | `buddyBriefing.ts`, `src/__tests__/buddyReaderMessages.test.ts` | `phase9Freeze.test.ts` ("one message says …"; count only) | ok |
| B18 | Never-list: no reply-to-readers, no spend, no create product, no full rewrite | `buddyOrders.ts` (`HELD_MONEY`, `HELD_CREATE`), `buddyOrderPolicy.ts` | `phase8Freeze.test.ts` (never-list; never creates a product) | ok |
| B19 | Control-by-talking is the closed five kinds; `REFUSAL_LINE` frozen; questions not refused | `buddyOrderPolicy.ts` (`ALLOWED_ORDERS`, `REFUSAL_LINE`, `gateOrder`) | `phaseBFreeze.test.ts`; `phaseBFreeze.test.ts` (closed list and refusal line); `phaseDFreeze.test.ts` (gate) | ok |
| B20 | Unnamed swap → Executioner; named mind respected; Takeover off → wait | `buddyRouter.ts`, `buddyOrderPolicy.ts`, `runDay.ts` (`TAKEOVER_OFF_DETAIL`) | `phaseEFreeze.test.ts` (slice 2); `phaseDFreeze.test.ts` (swap) | ok |
| B21 | Phone buzzes: briefing kinds + `job_finished`; url `/buddy`; missing VAPID = skip, not fake sent | `notablePush.ts` (`BUZZ_KINDS`, `NOTIFICATION_URL = "/buddy"`), `notablePushServer.ts`, `webPush.ts` | `phaseDFreeze.test.ts` (buzz kinds; missing VAPID skip); `phase7Freeze.test.ts` | ok |
| B22 | Server flush so a closed Minds tab cannot drop a buzz | `notablePushServer.ts`, `buddy-night-clock`, `minds-run-placement` | `phaseEFreeze.test.ts` (slice 1); `notablePushAdapter.test.ts` | ok |

## Six minds and Admin

| # | Lock | Code | Tested | Status |
|---|---|---|---|---|
| M1 | Five minds: analyst, strategist, ceo, executioner, auditor; Buddy is the sixth card and only voice | `src/buddy/minds/mindRoster.ts` (`MIND_KEYS`, `MINDS`), `src/admin/pages/AdminMinds.tsx` | `phaseCFreeze.test.ts`; `buddyPhase2Freeze.test.ts` (five minds roster) | ok |
| M2 | Analyst: week vs week, floor so 0→1 is not a spike, or cannot-see | `supabase/functions/_shared/buddyWeek.ts` | `phaseBFreeze.test.ts` (week against last week) | ok |
| M3 | Strategist suggests, does not publish | `src/buddy/minds/strategist.ts`, `buddyLivingMinds.ts` (`suggest` kind only) | `buddyPhase3Freeze.test.ts` (no send, no text of their own) | ok |
| M4 | CEO sorts waiting work | `buddyLivingMinds.ts` (`CEO_ROLE`, kind `sort`) | `to freeze` | ok, freeze |
| M5 | Executioner: packs + free-door send; nothing while Takeover off; never the four hand doors | `minds-run-placement/index.ts`, `runDoors.ts`, `dayPacks.ts`, `src/buddy/minds/executioner.ts` | `phaseCFreeze.test.ts` (job text); `buddyPhase3Freeze.test.ts` (Takeover off writes nothing); `phase6Freeze` (never a gated address) | ok |
| M6 | Auditor checks before a change; cannot be switched off by another mind; Buddy refuses "turn off the Auditor" | `src/buddy/minds/auditor.ts`, `mindGuards.ts` (`requestDisable`), `buddyControls.ts` (`AUDITOR_REFUSAL`) | `phase8Freeze.test.ts` (Auditor still refused) | ok |
| M7 | Takeover default false; on copy is honest; Kill none / all / one | `supabase/migrations` (minds controls default), `src/buddy/minds/mindRoster.ts` (`KILL_OPTIONS`), `AdminMinds.tsx` | `buddyPhase2Freeze.test.ts` (defaults; Kill round-trips); `phaseBFreeze.test.ts` (migration default) | ok |
| M8 | No `AdminAI.tsx`; no 22-tab tower; Distribution address → Minds; Video look is a small screen | `AdminApp.tsx` (`RetiredDistributionRedirect`), `src/admin/pages/AutomationVideoLook.tsx` | `phaseCFreeze.test.ts` (AdminAI gone; Distribution redirect); `phaseEFreeze.test.ts` (slice 4) | ok |
| M9 | Daily log table and writer exist | `supabase/migrations` (`minds_daily_log`), `minds-run-placement/index.ts` (`log`), `minds/mindsLogStore.ts` | `phaseEFreeze.test.ts` (slice 3 same-day rows) | ok |
| M10 | Living Analyst/Strategist/CEO think through the brain chain; retry same day after failure; not if `done` | `buddyLivingMinds.ts`, `mindThink.ts` (`askBrains`), `minds-run-placement` | `phaseEFreeze.test.ts` (slice 3); `phaseDFreeze.test.ts` (steps are not stubs) | ok |
| M11 | Advisor remains CMS health, not a mind | `src/admin/pages/AdminAdvisor.tsx` | `phaseCFreeze.test.ts` (Advisor is site health) | ok |
| M12 | Social Shares remain counts, no send | `src/admin/pages/AdminSocialShares*` | `phaseCFreeze.test.ts` (sends nothing) | ok |

## Articles, shop, money, voice

| # | Lock | Code | Tested | Status |
|---|---|---|---|---|
| A1 | Owner writes articles; cap three products; 1–2 sentence product lines; drip old; digital first; no auto-create; gap asks owner | `productPlacement.ts`, `buddyOrders.ts` (`HELD_CREATE`), `packRules.ts` (cap), drip in `buddyWeek`/placement | `buddyPhase3Freeze.test.ts` (cap, drip, no create); `phaseBFreeze.test.ts` (digital first) | ok (sentence count: freeze) |
| A2 | USD; no Naira on reader copy; no Nigeria / Lagos / WAT on screen strings; clock stays Africa/Lagos in code | `src/lib/money.ts` (`HIDDEN_DISPLAY_CURRENCIES = ['NGN']`), `packRules.ts`, `AutomationRuns.tsx` (studio clock label) | `phaseBFreeze.test.ts` (footer hides Naira); `phaseCFreeze.test.ts` (calendar, clock in code); `phase8Freeze.test.ts` | ok |
| A3 | Top countries for pack times: US, UK, CA, AU, IE, NZ, SG; times learn | `supabase/functions/_shared/packCopy.ts` (`TOP_COUNTRIES`, `TIME_WINDOWS`) | `buddyPhase4Freeze.test.ts` (every window is a top-country region) | ok |
| A4 | $0 and no paid brain in code | `brains.ts` (`skip` for Cerebras and DeepSeek) | `phaseAFreeze.test.ts`; `phaseCFreeze.test.ts` (Cerebras, DeepSeek skipped) | ok |

## Twenty doors

| # | Lock | Code | Tested | Status |
|---|---|---|---|---|
| D1 | Gated 4: instagram, tiktok, facebook, pinterest: caption, time, image, video, link; Buddy does not press Post; "I posted this" exists | `supabase/migrations/20261010100000_minds_packs.sql` (fields), `packRules.ts`, `buddyJobs.ts` | `buddyPhase4Freeze.test.ts` (four gated; "I posted this" owner-only) | ok |
| D2 | Auto 16 (telegram, discord, bluesky, mastodon, tumblr, blogger, medium, pixelfed, wordpress_com, youtube, vimeo, podcast, flipboard, google_news, microsoft_start, smartnews) | `doorRegistry.ts` (`DOOR_IDS`), `doorPosts.ts` (`OPEN_DOORS`) | `phase8Freeze.test.ts` (sixteen auto, all open); `phase9Freeze.test.ts` | ok |
| D3 | RSS four: ping hub, honest skip, no fake login | `rssHub.ts` (`WEBSUB_HUB`, `hubPingBody`), `doorRegistry.ts` (no fields for RSS doors) | `phase8Freeze.test.ts` (ping with fake hub); `src/__tests__/rssDoors.test.ts` | ok |
| D4 | Skip if required media missing; YouTube/Vimeo need video; podcast needs audio; Pixelfed needs image | `doorPosts.ts` (`DOOR_MEDIA`, `DOORS_NEED_PICTURE`), `runDoors.ts` | `phase6Freeze.test.ts` (missing video or audio skips before reserve); `phase7Freeze.test.ts` | ok |
| D5 | Connections: door details; secrets never echoed; test does not publish | `src/admin/pages/AdminConnections.tsx`, `doorConnectionTests.ts` (`not_built` for RSS), `automation-keys` | `phaseAFreeze.test.ts` (no key in a reply); `to freeze` (no sender in the test module) | ok, freeze |
| D6 | How-to: Buddy can answer how to connect each open door **and** each brain (skip brains say so) | `buddyHowTo.ts` (`HOWTO_DOORS`, `brainHowTo`) | `buddyHowTo.test.ts` (six new doors only) | **fix (slice 2): `HOWTO_DOORS` lists 10 of the 16 open doors; telegram, bluesky, mastodon, tumblr, discord, blogger are missing** |
| D7 | No WhatsApp door; no Feedly, X or 21st door | `doorRegistry.ts`; `notOfferedKeys.ts`; library `src/lib/automationDistribution.ts` keeps a dead WhatsApp share helper (not a door, not on a screen, tested only) | `phaseCFreeze.test.ts` (WhatsApp not on Keys/Connections); `phaseEFreeze.test.ts` (no whatsapp/feedly/21st in door files) | ok (report notes the dead helper) |

## Video, night, brains

| # | Lock | Code | Tested | Status |
|---|---|---|---|---|
| V1 | Production pack render 1080×1920, captions, audio (no `-an`), espeak fallback | `scripts/pack-video.mjs` (`PACK_VIDEO` 1080×1920, `buildFfmpegArgs`), `scripts/pack-voice.mjs` (espeak) | `buddyPhase4Freeze.test.ts` (renderer has a voice track, never silent); `phase8Freeze.test.ts` (voiced vs silent) | ok (the `-an` check: freeze) |
| V2 | Night writer and night clock exist in `config.toml`; night ≠ morning | `supabase/config.toml` (`buddy-night-report`, `buddy-night-clock`), `supabase/functions/buddy-night-report`, `buddy-night-clock`, migration `20261016000000_buddy_night_clock.sql` (`*/30`, not applied) | `phase7Freeze.test.ts`; `phase9Freeze.test.ts` | ok |
| V3 | Eight slots, try six, skip two, Gemini first; probe = `askBrains`; status = any tryable; 429 → next | `brains.ts`, `brainChain.ts`, `buddyThink.ts` | `phaseAFreeze.test.ts`; `phaseDFreeze.test.ts` (probe and status) | ok |
| V4 | No github / bytez / mistral workhorses | `brains.ts` | `phaseAFreeze.test.ts` | ok |
| V5 | Eight slots, the 08:00 scheduler in code (`config.toml` + source) | `supabase/config.toml` (`automation-scheduler`), migration `20261006100000` (`0 7 * * *` UTC = 08:00 Lagos), `20261010090000` (daily run, commented out) | `buddyPhase4Freeze.test.ts` (cron line stays commented in the minds migration) | ok, freeze (08:00 check) |

## Found while walking the lock (not in the lock list, but in scope of "stubs and comments")

| # | Finding | Where | Slice |
|---|---|---|---|
| X1 | Day-run log writes the action "Posted to <door>" for every outcome, including failed and skipped. That is a fake "posted" wording. | `supabase/functions/minds-run-placement/index.ts` (`log` in the door ports) | 3 |
| X2 | `supabase/config.toml` line 41: "Owner-only Buddy thinking (Google Gemini)". Buddy now thinks through the brain chain. | `supabase/config.toml` | 2 |
| X3 | `src/buddy/README.md` lines 32–33: "the one Gemini call. Buddy thinks with gemini-3.8-flash". Stale. The brain chain runs. | `src/buddy/README.md` | 2 |
| X4 | Silent MP4 test render (`scripts/render-video-test.mjs`, `-an`) has no README next to its fixture. | `scripts/fixtures/`, `scripts/render-video-test.mjs` | 4 |
| X5 | `runAllMinds` in `src/buddy/minds/mindRun.ts` is an unwired client mirror of the day run. It is not a day-run step and makes no network call. It is labelled as unwired already. | `src/buddy/minds/mindRun.ts` | 3 (documented, not deleted) |
| X6 | No `not implemented`, `TODO` or stub day-run step was found in product code (grep, slice 1). | whole `src`, `supabase/functions`, `scripts` | 3 (confirmed) |

## Re-audit after the first slice-6 report

A second walk against the full spec. Each row says what changed. "Pass" rows are pinned in `src/buddy/phaseFFreeze.test.ts` unless another file is named.

| # | Finding | Result |
|---|---|---|
| R1 | Lock B19 / Phase E delete finding: "Delete the old one" was filed as mind_work. The never-list has no deletes. | Fixed (tiny gate change in `buddyOrderPolicy.ts`: delete, erase or trash with no noun). The Phase E test that pinned the gap now expects a refusal. |
| R2 | Lock A1: "1–2 sentence product lines". The first report called this a gap. It is enforced in `productPlacement.ts` (2 sentences, 60 words, 3 products, dashes, country, non-USD money, exact shop price, and no new product). | Correction: not a gap. Now pinned behaviourally. |
| R3 | Code leftover: `src/buddy/minds/mindRun.ts` (`runAllMinds`), an unwired client aggregate used only by one test file. | Removed. The four-mind order now lives in `src/__tests__/mindsWorkers.test.ts`. |
| R4 | Copy lie: `HELD_LATER_PHASE` told the owner that channel posting "come[s] in a later phase". There is no later phase. | Reworded and renamed to `HELD_NOT_FROM_CHAT`. Freeze fails on any owner-facing "later phase". |
| R5 | Comment lie: `AdminConnections.tsx` said "twelve auto doors" and that posting was not built. | Corrected to sixteen doors and the true posting rule. |
| R6 | README lies: `mindThink.ts` called "the one door to Gemini"; minds "still Google only"; the old distribution page "still has WhatsApp, Facebook and Pinterest senders". | Corrected (`src/buddy/README.md`). |
| R7 | Legacy `supabase/functions/automation-distribution` (deployable, in GO_LIVE step 4). Checked: no WhatsApp; Facebook and Pinterest have no send path (`check` is read-only); `send_telegram` is owner-started; `test_newsletter` emails only the owner's own confirmed address. | Lock holds. Frozen. |
| R8 | Lock: Buddy entry points. Buddy has no Admin sidebar item. It is reached from the Minds page link (`/buddy`) and from the install panel (`PwaInstallPanel.tsx`). | Judged present, not added. Frozen. |
| R9 | Lock: Video look nav. Present in `AdminLayout.tsx` as "Video look". | Pass. |
| R10 | Owner decision D: the saved Video look is not read by the daily or pack video. The screen says so (`LOOK_NOT_USED_YET`). | Owner decision, not a code leftover. Honest copy is in place. |
| R11 | `buildBriefing` treats an omitted optional source as read. The one real caller (`buddy-think`, lines 269–279) passes every source. | Production path is safe. Frozen (the reader passes every source). Not changed: changing the default would move many existing tests. Future callers must pass every source. |
| R12 | Lock: hear-Buddy off by default, with a switch in settings. | Pass. Frozen (`DEFAULT_SETTINGS` and the settings switch). |
| R13 | Lock: gated pack fields (caption, time, image, video, link) and channel check. | Pass. Frozen against `20261010100000_minds_packs.sql`. |
| R14 | Lock: connection test does not publish. Its only POSTs are a Bluesky sign-in and a Blogger token refresh. | Pass. Frozen (exactly two POSTs, no publish URL). |
| R15 | Lock: how-to skipped brains say they are skipped. | Pass. Frozen for all eight brains. |
