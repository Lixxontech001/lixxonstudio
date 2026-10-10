# PHASE D REPORT: the remaining wiring halves

Branch: `arena/1d438dc4-lixxonstudio`. Base of the branch: `a128521` (`main`).
This report replaces the earlier Phase D report. That report was written against a leftover list rebuilt from `PHASE_C_REPORT.md`, not against the owner's spec, and it overstated what was verified. The commits from that earlier list (`7a6cb1d` to `0f3821c`) remain in history. This report covers only the spec's six slices.

**Nothing was merged to `main`. No pull request was opened. Nothing was deployed. No production migration was applied.**
Takeover stays off by default. No brain, door, order kind, or channel was added. No live LLM, live door, or live push call was made. Every model reply, brain call, push send and database step in the new tests is a fake.

HEAD before the report commit: `10433a0` (slice 5). The slice 6 commit is the last one pushed; its sha is given in the final message of this phase.

## Slices (spec commit messages)

| # | Commit message | Commit | What it does |
|---|---|---|---|
| 1 | Phase D slice 1: probe walks the brain chain | `7a6cb1d` (earlier; re-verified, no code change this phase) | The probe uses `askBrains`, the same chain as ask. |
| 2 | Phase D slice 2: every filed order hits the closed list | `4d0c169` | One gate for every filed order, from the model path and the router. |
| 3 | Phase D slice 3: Buddy status is any tryable brain | `9963255` | `configured` is true when any tryable brain is saved. |
| 4 | Phase D slice 4: notables attempt one owner push | `ab92ea8` | Briefing kinds buzz the owner's phone. Missing VAPID is an honest skip. |
| 5 | Phase D slice 5: swap, briefing sources, living mind steps | `10433a0` | Swap says Done with names. Briefing counts three queues. The three living minds run on the day run. |
| 6 | Phase D slice 6: freeze and PHASE D REPORT; nothing merged | the slice 6 commit | Freeze moved to the spec path, 22 checks. This report. |

## Required answers

- **Probe chain, Gemini then Groq, NVIDIA, Cloudflare, OpenRouter, Hugging Face; Cerebras and DeepSeek skipped: YES.** `tryableBrains()` returns exactly those six, in that order. The probe uses `askBrains` and does not require Gemini (`buddyProbeChain.test.ts`, `brainChain.test.ts`, freeze slice 1).
- **Order gate on the model path: YES.** Every model order passes `gateModelOrder`. Only `mind_work` is filed from a model. An off-list kind, or an outside request, gets `REFUSAL_LINE` and nothing is saved. A question is answered and never filed, with no refusal line. The router path passes `routeFilingGate` inside `answerRouted`, so a pending outside request is refused there too (`buddyFilingGate.test.ts`, 10 checks). `NOT_ON_LIST_LINE` is removed. `BUDDY_ANSWER_RULES` says only the five kinds become orders.
- **Push call site and skip without VAPID: YES.** The call site is `recordNotable` in `supabase/functions/minds-run-placement/index.ts`. It writes the notable row, checks `shouldBuzz`, and calls `notifyOwnerDevices`, which calls the existing `sendPushNotification`. With VAPID missing the status is `not_configured`. No device is read and nothing is sent. The owner gets one daily-log line with the same help copy the Keys page uses (`notablePushOwner.test.ts`, 9 checks, fake fetch and fake send only).
- **Swap tests: YES.** `swapApplyPath.test.ts`, 12 checks. The swap files as `product_line_apply` and is laned as a product line. Takeover on: the run applies it, and the owner reads "Done." with the product and article names. Takeover off: the day run plans nothing, the chat says "Takeover is off, so nothing has changed.", and the order stays waiting. The cap of three and digital-first hold for a swap. No second path was added.
- **Briefing extra sources: YES, count only.**
  - Comments awaiting approval: `comments` where `is_approved = false`.
  - Refunds: `refund_requests` where `status = 'pending'`.
  - Abandoned carts: `abandoned_carts` where `recovered = false`.

  Quiet when zero. "Cannot be read" when a read fails. Each read selects only a head count. No name, email, body or cart item is read (`buddyBriefingQueues.test.ts`, 8 checks).
- **Day-run functions no longer stubs: the Analyst, the Strategist and the CEO.** The day run (`minds-run-placement`, when no order is named) calls them through `runLivingMinds`. Each thinks once through the brain chain, with the facts and the waiting orders in its prompt, and writes one `minds_daily_log` row. The morning briefing reads those rows under "The five minds". They run once per local day. Takeover off returns early in the run, before the steps. Kill is checked before the steps and again for each mind. The server copy is `_shared/buddyLivingMinds.ts`; the `src` originals are unchanged. `livingMindSteps.test.ts` (15 checks) includes parity checks: the rules and roles, the action names, the reply parser, the prompt builder and the failure wording match the `src` versions on the same fixtures. The Executioner and the Auditor are not part of these steps.
- **Freeze path: `src/buddy/phaseDFreeze.test.ts`.** This is the spec's path. The file was moved from `src/__tests__/` with `git mv`. Its 22 source and fixture checks have one group per slice, plus the carried checks.

## Decisions made in this phase

1. **The buzz list follows the briefing kinds.** `BUZZ_KINDS` is now every `BRIEFING_NOTABLE_KINDS` entry, plus `job_finished`. Six kinds that did not buzz before now do: `takeover_changed`, `kill_changed`, `week_up`, `week_down`, `door_failed`, `order_blocked`. Tests that asserted the old list were updated in slice 4: `notablePush.test.ts`, `notablePushWiring.test.ts` and `phase7Freeze.test.ts`. The `phase7Freeze` change swapped a `takeover_changed` example for `article_changed`, which still does not buzz.
2. **Migration `20261018000000_notable_week_change.sql` changed in a comment only** (slice 4), to say the week kinds buzz. No SQL changed. The kind list it sets already allows every briefing kind.
3. **`job_finished` keeps buzzing.** It is not a briefing kind. Dropping it would silently lose a phone alert the owner already gets. Owner decision (see leftovers).
4. **The living minds run once per local day, on a run with no order named.** A failed read of today's rows skips them, so a flaky read never runs them twice.
5. **The server copy of the mind steps is a duplicate, guarded by parity tests.** The Edge Function cannot import `src/buddy/minds`.
6. **One notable writer.** Every notable, from the day run and the placement run, goes through `recordNotable`, which is the one push call site. The night report writes no notables: `mindsNightReport` and `nightReportRun` only read `minds_notable_events` for the morning summary (`mindsNightReport`, `nightReportRun`, and "night report writes no notables" in `notablePushOwner.test.ts`). So no night-only writer exists to route. The spec's "night notables use the same helper" is met by the one writer, not by a separate night path.

## Checks run (final, on the code before this report)

- Full suite: **159 files passed. 2074 tests: 2068 passed, 6 skipped, 0 failed.**
- App typecheck (`npm run typecheck`): exit 0.
- Edge-function typecheck (`npx tsc --noEmit -p supabase/functions/tsconfig.json`): exit 0.
- ESLint on every changed or new test file in this phase, and on `src/buddy/minds/mindRun.ts`: exit 0.
- Slice 1 re-verified by its existing tests (`buddyProbeChain.test.ts`, `brainChain.test.ts`), which pass in the full run.

## Go-live leftovers (not this phase)

1. **Live brains.** No real call was made. Real Gemini 429 behaviour and real free-tier limits on Groq, NVIDIA, Cloudflare, OpenRouter and Hugging Face are unverified. Each living mind is one brain call per day run.
2. **Living minds are once a day.** If today's first attempt fails (rate limit, no key), that day's rows say so and nothing retries until tomorrow. Owner to accept or change.
3. **Phone push.** Real VAPID keys, real device registration and real delivery are unverified. Confirm that `push_record_delivery` (`supabase/migrations/20261006190000_web_push_delivery.sql`) and the subscriptions migration (`20261006180000_web_push_subscriptions.sql`) are applied on the live database.
4. **Three kinds need a server hook to push.** `takeover_changed` and `kill_changed` are written by a database function (`20261015020000_minds_controls_change_source.sql`). `order_blocked` is written by a database function (`20261009230000_minds_apply_placement.sql`). Neither goes through the day-run writer, so neither pushes. The buzz rule is right, but these rows need a server hook to push.
5. **Migrations.** None added in this phase. The notable kind list (`20261018000000_notable_week_change.sql`) already allows every briefing kind. It must be applied on the live database before the new kinds can be written there. Not applied here.
6. **`job_finished`** buzzes beyond the briefing list. Owner decision.
7. **Swap without a named mind** asks "which mind?" as before. Owner decision whether a swap should default to the Executioner.
8. **`abandoned_carts` anonymous update policy.** `20261003120000_security_hardening.sql` (around line 391) allows anonymous `UPDATE` on `abandoned_carts`. This predates the phase and was not changed here. The later hardening drops the old anonymous select policy, so anonymous reads are closed. Review the update policy before go-live.
9. **Video-template editor.** `src/lib/automationDistribution.ts` is kept until the owner decides.

## Eyes-only leftovers (the owner checks by looking)

1. The morning briefing card shows the new count lines ("N refund requests are waiting…", etc.) and the "The five minds" lines.
2. The status Buddy reports now says a brain is saved if any tryable brain is saved.
3. The "Done." line from a swap appears in the day run's returned detail. Check that the screen showing a run's result displays it.
4. Notification wording and vibration on the phone.

## Not touched in this phase

- Luxury "owner has not sat in Buddy" and the Flipboard hub: eyes or go-live, not this phase.
- Social Shares remain a read-only count. Advisor remains CMS health, not a mind chat.
- Gated 4 remain gated. The 16 automatic doors remain 16. No WhatsApp door. No 21st door.
- No "Nigeria" text on any screen. Lagos appears only as a timezone name in code.
- No fake daily-log rows. Every row comes from a real step, or from a real skip.

Nothing merged, deployed, or applied.
