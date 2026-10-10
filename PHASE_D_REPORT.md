# PHASE D REPORT: the remaining wiring halves

Branch: `arena/1d438dc4-lixxonstudio`. Base of the branch: `a128521` (`main`).
This report replaces the earlier Phase D report. That report was built from a leftover list rebuilt from `PHASE_C_REPORT.md`, not from the owner's spec, and it overstated what was verified. Its commits (`7a6cb1d` to `0f3821c`) remain in history.

**Nothing was merged to `main`. No pull request was opened. Nothing was deployed. No production migration was applied.**
Takeover stays off by default. No brain, door, order kind or channel was added. No live LLM, live door or live push call was made. Every model reply, brain call, push send and database step in the tests is a fake.

- HEAD before the gap-closing fix: `db48b15` (slice 6, first version of this report).
- HEAD after the fix: the commit whose message is `Phase D: close the push, readKey and filing gaps; report corrected`. Its sha is given in the final message of this phase.

## Slices (spec commit messages)

| # | Commit message | Commit | What it does |
|---|---|---|---|
| 1 | Phase D slice 1: probe walks the brain chain | `7a6cb1d` (re-verified; no code change this phase) | The probe uses `askBrains`, the same chain as ask. |
| 2 | Phase D slice 2: every filed order hits the closed list | `4d0c169` | One gate for every filed order, from the model path and the router. |
| 3 | Phase D slice 3: Buddy status is any tryable brain | `9963255` | `configured` is true when any tryable brain is saved. |
| 4 | Phase D slice 4: notables attempt one owner push | `ab92ea8` | Briefing kinds buzz the owner's phone. Missing VAPID is an honest skip. |
| 5 | Phase D slice 5: swap, briefing sources, living mind steps | `10433a0` | Swap says Done with names. Briefing counts three queues. The three living minds run on the day run. |
| 6 | Phase D slice 6: freeze and PHASE D REPORT; nothing merged | `db48b15` | Freeze moved to the spec path. First report. |
| fix | Phase D: close the push, readKey and filing gaps; report corrected | see above | Closes the three gaps below. |

## Gaps closed after the first report

1. **Push for the notables the database writes (spec item 4).** These kinds were never pushed before:
   - `takeover_changed` and `kill_changed` are written by a database trigger on `minds_controls`.
   - `order_blocked` is written by the database function `minds_record_gap`.

   Now each one attempts one owner push, through the same helper as the day run (`notifyOwnerDevices`, the same VAPID keys):
   - **Chat Kill and restart** (`buddy-think`, `applyControl`): after the owner's switch is saved, the push is attempted for the trigger's row. Door pause and resume do not buzz.
   - **Minds screen Takeover and Kill** (`src/buddy/minds/mindsControlsStore.ts`): after a successful save, the browser makes one best-effort call to the new function `minds-control-notify`. That function takes the caller from the JWT and attempts the push for the caller's own fresh rows. A failed or missing call never changes the saved result.
   - **Blocked order** (`minds-run-placement`, `recordGap`): after `minds_record_gap` succeeds, the push is attempted for the `order_blocked` row.

   The shared code is `supabase/functions/_shared/notablePushServer.ts`. A row is pushed only if it is fresh (within two minutes) and has no push note yet. A row that already has a push note is not pushed again. If the note itself cannot be written, a later call could push that row again. That is the one known double-push risk, and it is not guarded. A missing key or device is written to the daily log in plain words. The day run now uses the same device and key loaders (`ownerPushDeps`), so there is one push path.
   - **Limit:** the Minds screen push needs the browser to make the call. If the tab closes before the call, no push is attempted. The notable row still exists. Nothing is queued or retried.
2. **Dead Gemini-only dep (spec item 7).** `readKey` was still in `BuddyThinkDeps` and wired in `buddy-think`, with no caller. It is removed from the interface and from the handler. Test fixtures keep a helper that feeds `readSecret` for the Gemini key. The handler has no `readKey` dep.
3. **Two spec examples, by name** (`swapApplyPath.test.ts`): "put the sleep guide on the new article" is filed as `product_line_apply`. "refund the last customer" is refused by the model-order gate with `REFUSAL_LINE`.

## Required answers

- **Probe chain, Gemini then Groq, NVIDIA, Cloudflare, OpenRouter, Hugging Face; Cerebras and DeepSeek skipped: YES.** `tryableBrains()` returns exactly those six, in that order. The probe uses `askBrains`, does not require Gemini, and returns `NO_KEY_MESSAGE` when no brain is saved (`buddyProbeChain.test.ts`, `brainChain.test.ts`, freeze slice 1).
- **Order gate on the model path: YES.** Every model order passes `gateModelOrder`. Only `mind_work` can be filed from a model. An off-list kind or an outside request gets `REFUSAL_LINE` and nothing is saved. A question is answered, never filed, with no refusal line. The router path passes `routeFilingGate` inside `answerRouted`, so a pending outside request is refused there too (`buddyFilingGate.test.ts`, 10 checks). `BUDDY_ANSWER_RULES` says only the five kinds become orders.
- **Push: call sites and skip without VAPID: YES.**
  - Day run and placement: `recordNotable` in `minds-run-placement` → `notifyOwnerDevices(kind, title, ownerPushDeps(sb, owner))`.
  - Chat Kill: `buddy-think` → `pushNewestNotable("kill_changed", …)`.
  - Minds screen: `minds-control-notify` → `pushNewestNotable` for `takeover_changed` and `kill_changed`.
  - Blocked order: `minds-run-placement`, `recordGap` → `pushNewestNotable("order_blocked", …)`.

  With VAPID missing, the status is `not_configured`. No device is read and nothing is sent. The row records `not_configured`, and the owner gets one daily-log line with the Keys-page help copy. A failed send is recorded as `failed`, never as `sent`. All tests use fake sends (`notablePushOwner.test.ts` 9, `notablePushServer.test.ts` 18, `mindsControlNotify.test.ts` 4).
- **Swap tests: YES.** `swapApplyPath.test.ts`, 14 checks. The swap files as `product_line_apply` and is laned as a product line. Takeover on: the run applies it, and the owner reads "Done." with the product and article names. Takeover off: the day run plans nothing, the chat says "Takeover is off, so nothing has changed.", and the order stays waiting. The cap of three and digital-first hold for a swap. No second path was added.
- **Briefing extra sources: YES, count only.**
  - Comments awaiting approval: `comments` where `is_approved = false`.
  - Refunds: `refund_requests` where `status = 'pending'`.
  - Abandoned carts: `abandoned_carts` where `recovered = false`.

  Quiet when zero. "Cannot be read" when a read fails. Each read selects only a head count. No name, email, body or cart item is read. Messages stay "There is a message for you." (`buddyBriefingQueues.test.ts`, 8 checks).
- **Day-run functions no longer stubs: the Analyst, the Strategist and the CEO.** The day run (`minds-run-placement`, when no order is named) calls them through `runLivingMinds`. Each thinks once through the brain chain and writes one `minds_daily_log` row. The morning briefing reads those rows under "The five minds". They run once per local day. Takeover off returns early in the run, before the steps. Kill is checked before the steps and again for each mind. The analyst's prompt carries this-week and last-week counts (`readMindFacts`). The strategist's role is "suggest what to do next", not placement. The CEO's role is to put the waiting orders in order of priority. The server copy is `_shared/buddyLivingMinds.ts`. `livingMindSteps.test.ts` (15 checks) includes parity checks against the `src` versions. The Executioner and the Auditor are not part of these steps.
- **Freeze path: `src/buddy/phaseDFreeze.test.ts`**, moved from `src/__tests__/` with `git mv`. 27 checks, one group per slice, plus carried checks and the gap checks above.

## Decisions made in this phase

1. **The buzz list follows the briefing kinds.** `BUZZ_KINDS` is every `BRIEFING_NOTABLE_KINDS` entry plus `job_finished`. Six kinds that did not buzz before now do: `takeover_changed`, `kill_changed`, `week_up`, `week_down`, `door_failed`, `order_blocked`. The tests that asserted the old list were updated in slice 4 (`notablePush.test.ts`, `notablePushWiring.test.ts`, `phase7Freeze.test.ts`). The `phase7Freeze` change now uses `article_changed` as its non-buzzing example.
2. **Migration `20261018000000_notable_week_change.sql` changed in a comment only** (slice 4). No SQL changed. Its kind list already allows every briefing kind.
3. **`job_finished` keeps buzzing.** It is not a briefing kind. Owner decision.
4. **The living minds run once per local day, on a run with no order named.** A failed read of today's rows skips them, so a flaky read never runs them twice.
5. **The server copy of the mind steps is a duplicate, guarded by parity tests.** The Edge Function cannot import `src/buddy/minds`.
6. **One notable writer.** Every notable goes through `recordNotable` or `pushNewestNotable`, which use the same owner push deps. The night report writes no notables. It only reads them (`nightReportRun`, `mindsNightReport`). So there is no night-only writer to route. The spec's "night notables use the same helper" is met by the single path.
7. **The skip line uses a mind the daily log accepts.** The log accepts `buddy`, `analyst`, `strategist`, `ceo`, `executioner` and `auditor`. Owner-written Takeover and Kill rows are shown as `buddy` in the log.

## Checks run (final, on the code of this fix)

- Full suite: **161 files passed. 2103 tests: 2097 passed, 6 skipped, 0 failed.** Read from the JSON reporter.
- App typecheck (`npm run typecheck`): exit 0.
- Edge-function typecheck (`npx tsc --noEmit -p supabase/functions/tsconfig.json`): exit 0.
- ESLint on every changed or new source and test file: exit 0.
- Slice 1 re-verified by its existing tests (`buddyProbeChain.test.ts`, `brainChain.test.ts`), which pass in the full run.
- Video audio (spec lock): the production pack render keeps an AAC voice track. `packVideo.test.ts` asserts no `-an` and a voice track, and `buddyPhase4Freeze.test.ts` asserts the render source has no `-an`. The one silent render is the test fixture `scripts/render-video-test.mjs` (documented there as "intentionally silent", with alt text). It predates this branch and is used only by `videoAssetValidation.test.ts`. It is not a reader-facing video. Owner decision whether the fixture should also carry audio.

## Go-live leftovers (not this phase)

1. **Deploy and configure `minds-control-notify`.** It is added to `supabase/config.toml` with `verify_jwt = true`. Until it is deployed, Minds switches still save. The push is simply not attempted for them.
2. **Live brains.** No real call was made. Real Gemini 429 behaviour and real free-tier limits on Groq, NVIDIA, Cloudflare, OpenRouter and Hugging Face are unverified. Each living mind is one brain call per day run.
3. **Living minds are once a day.** If today's first attempt fails (rate limit, no key), that day's rows say so, and nothing retries until tomorrow. Owner to accept or change.
4. **Phone push.** Real VAPID keys, device registration and real delivery are unverified. Confirm that `push_record_delivery` (`supabase/migrations/20261006190000_web_push_delivery.sql`) and the subscriptions migration (`20261006180000_web_push_subscriptions.sql`) are applied on the live database.
5. **Minds push depends on the browser call.** See the limit under "Gaps closed". A closed tab after a save means no push for that save.
6. **Migrations.** None added in this phase. The notable kind list (`20261018000000_notable_week_change.sql`) already allows every briefing kind. It must be applied on the live database before the new kinds can be written there. Not applied here.
7. **`job_finished`** buzzes beyond the briefing list. Owner decision.
8. **Swap without a named mind** asks "which mind?" as before. Owner decision whether a swap should default to the Executioner.
9. **`abandoned_carts` anonymous update policy.** `20261003120000_security_hardening.sql` (around line 391) allows anonymous `UPDATE` on `abandoned_carts`. This predates the phase and was not changed here. The later hardening drops the old anonymous select policy, so anonymous reads are closed. Review the update policy before go-live.
10. **Video-template editor.** `src/lib/automationDistribution.ts` is kept until the owner decides.
11. **Silent test-fixture render** (`scripts/render-video-test.mjs`). Owner decision whether to add audio to the fixture.

## Eyes-only leftovers (the owner checks by looking)

1. The morning briefing card shows the new count lines ("N refund requests are waiting…", etc.) and "The five minds".
2. The status Buddy reports now says a brain is saved if any tryable brain is saved.
3. The "Done." line from a swap appears in the day run's returned detail. Check that the screen showing a run's result displays it.
4. Notification wording and vibration on the phone.
5. The Minds screen after a Takeover or Kill save shows nothing new. The push, when it works, appears on the phone.

## Not touched in this phase

- Luxury "owner has not sat in Buddy" and the Flipboard hub: eyes or go-live, not this phase.
- Social Shares remain a read-only count. Advisor remains CMS health (`AdminAdvisor.tsx`), not a mind chat.
- Gated 4 remain gated. The 16 automatic doors remain 16. No WhatsApp door. No 21st door.
- No `AdminAI.tsx` and no `admin_ai` UI route remain.
- No "Nigeria" text on any screen. Lagos appears only as a timezone name in code. The README describes the rule and the hidden currency in documentation only.

Nothing merged, deployed, or applied.
