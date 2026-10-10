# PHASE C REPORT: honesty and dead costume

Branch: `arena/1d438dc4-lixxonstudio`
Start of Phase C: `543a777` (Phase B freeze).
Phase C commits, in order: slice 1 `8eb688d`, slice 2 `7193e92`, slice 3 `5ab8d2c`, slice 4 `96880f8`, slice 5 `5e51d06`, slice 6 is this commit (see `git log -1`).

Nothing was merged to `main`. No pull request was opened. Nothing was deployed. No production migration was applied. Takeover stays off by default. No brain, door, or order kind was added.

## Workspace note (read first)

When Phase C started, the local branch was at `a128521`, not `543a777`, and the working tree held 248 changes from an older checkout. Origin had `543a777` with every Phase B commit pushed. Before touching anything, I:

1. Saved the working tree to `/tmp/lixxon-worktree-backup.tar` and to `stash@{0}` (`phase C pre-sync backup of worktree at a128521`). Nothing was dropped.
2. Fast-forwarded the local branch to `origin/arena/1d438dc4-lixxonstudio` (`543a777`). This is a merge-only step. No rebase, no force.
3. Ran `npm ci`, because `node_modules` was missing.

The stash can be deleted once you have looked at it. It is not needed for Phase C.

## Files deleted

- `src/admin/pages/AdminAI.tsx`: the old 22-tab Admin AI page. Nothing in the app imported it. It was reached only from its own tests.
- `src/admin/pages/AutomationDistribution.tsx`: the dead Distribution page. The address already redirected to Minds.
- Tests for those two pages: `src/__tests__/adminAiAgentStatus.test.tsx`, `adminAiAgents.test.tsx`, `adminAiQueueGovernance.test.tsx`, `adminAiQueueReschedule.test.tsx`, `automationDistributionPage.test.tsx`, `videoTemplatePanel.test.tsx`.
- Vite chunk rule for the deleted page (`vite.config.ts`). The rule for the shared lib stays.

**One loss to decide on.** `AutomationDistribution.tsx` also held the video-template editor. Its three RPCs (`automation_video_templates`, `automation_save_video_template`, `automation_activate_video_template`) had no route or screen after Phase 9, so the editor was already unreachable. Its code is in git at `543a777` if you want it back on a new screen. The database functions and the template default are unchanged.

Kept on purpose:
- `RetiredDistributionRedirect` in `AdminApp.tsx`. `/admin/automation/distribution` still goes to Minds.
- `src/lib/automationDistribution.ts`. Tests still use it. It no longer shows on any screen.

## Executioner line (verbatim)

From `src/buddy/minds/mindRoster.ts`:

> Prepares packs and the free-door send. Publishes nothing while Takeover is off. Never posts the four you post by hand.

## Clock copy (verbatim examples)

The clock still runs on Africa/Lagos in code (`LAGOS_TIME_ZONE`, the 08:00 job, `timeZone: 'Africa/Lagos'`). Only the words on screen changed. Dates use `en-GB`, never `en-NG`.

- Run Monitor: `Daily schedule: 08:00 on your studio clock. View safe run steps, ...`
- Run Monitor switch: `08:00 studio-clock daily schedule`
- Run Monitor, next tick: `It will be picked up by the next 08:00 studio-clock run.`
- Calendar, date label: `Proposed date and time (studio clock)`
- Calendar, save error: `Choose a valid future date and time on your studio clock.`
- Calendar, reschedule: `... on your studio clock? Its time stays the same.`
- Intake, time label: `5 Oct 2026, 08:00 (studio clock)`
- Health row: `Daily studio-clock schedule`

## WhatsApp: hidden, not gone

- The Keys page and the key-list parser drop WhatsApp rows, whatever the catalogue holds. The filter is one list: `supabase/functions/_shared/notOfferedKeys.ts`.
- The keys function never tests WhatsApp. The WhatsApp Graph call is removed, and a WhatsApp name returns `invalid` with no provider request.
- The Keys help sentence for WhatsApp is removed. Connections never listed WhatsApp.
- Still true until the migration is applied: the catalogue rows are enabled in the database. Migration `20261018010000_retire_old_sender_keys.sql` (Phase B, not applied) turns them off. That is a go-live step.

## Google lines: what changed

In `supabase/functions/_shared/buddyThink.ts`, the four outcome lines now name Gemini, the one brain the probe checks:

- Was: `Google rejected the saved key. Replace it on the Brains page, under Automation in Admin.`
  Now: `Gemini, Buddy's first brain, rejected the saved key. Replace it on the Brains page, under Automation in Admin.`
- Was: `Google is limiting this key for now...` Now: `Gemini is limiting this key for now...`
- Was: `Google could not be reached just now...` Now: `Gemini could not be reached just now...`
- Was: `Google sent back nothing usable...` Now: `Gemini sent back nothing usable...`

The probe reply now says `"brain": "gemini"` on success and failure. The stale comments are fixed: the ask path goes through the brain chain (`askBrains`), and the one-brain comment says Gemini.

The all-failed line, shown when several brains were tried, names no single provider. It was already that way.

The pause line for an RSS door now says the feed ping is paused. It used to say Buddy would not post there. Example: `Paused the Flipboard door. Buddy will not ping your feed there until you resume it.` Normal doors are unchanged.

## Other changes in this phase

- Executioner job line (slice 2). The Minds, Brains, and Connections screens use the same taupe and charcoal look. Brains had grey classes; they are gone.
- Advisor, Social Shares: checked, not changed. Social Shares makes no publish, send, or insert call. Advisor is CMS site health and does not touch Buddy or Takeover.
- Advisor one-line note pointing to Buddy: optional, not added.

## Leftovers, not in this phase (for Phase D or go-live)

- The probe still checks Gemini only. Phase D should walk the brain chain there.
- Model-filed orders versus the closed list. Phase D.
- Whether notifications actually fire. Phase D.
- Minds, placement, the Auditor, and pack copy still say "Google" in their own lines (`mindCore.ts`, `mindGuards.ts`, `auditor.ts`, `productPlacement.ts`, `placementRun.ts`, `packCopy.ts`). Those paths call Gemini only, so the wording is accurate for now. Phase D should change them with the chain.
- `src/lib/automationDistribution.ts` still has WhatsApp share text and "WAT" labels. Only tests import it now. It could be deleted with its tests.
- The legacy distribution handler (`supabase/functions/automation-distribution`) and `distributionAdapters.ts` still contain WhatsApp send code, behind a 409 that refuses everything except Telegram.
- Admin scheduling screens still show the owner's 08:00 time as "studio clock" (decision: keep the 08:00 Africa/Lagos job; the words changed only).
- The video-template editor: decide whether to bring it back on a new screen (see above).
- Migrations named but not applied: `20261018000000_notable_week_change.sql` and `20261018010000_retire_old_sender_keys.sql`, plus the earlier unapplied migrations from Phases 2–9 and A.
- Go-live still waiting: merge, the owner's keys (added through Vault in Keys, never pasted in chat), connecting the doors, and a phone test of the notifications.

## Tests run

- Targeted, after each slice: the A/B freeze tests, the Phase 8 freeze, the Minds, Brains, Connections, keys, distribution, buddyThink, and calendar-adjacent tests, each slice's new tests.
- New in Phase C: `src/__tests__/phaseCSlice4.test.ts` (4 checks) and `src/__tests__/phaseCFreeze.test.ts` (30 checks).
- Full suite (final run): 150 files, 1965 passed, 6 skipped, exit 0.
- Type check (`tsc -p tsconfig.app.json`): exit 0.
- Lint on every file changed in Phase C: exit 0.

Tests use fake fetch and fake data only. No live key, Telegram, YouTube, Graph, Gemini, or other brain call was made.

## Hard locks, confirmed

- Nothing merged to `main`. No PR. No deploy. No production migration.
- No brain added. Cerebras and DeepSeek still `skip`. Eight brain slots, Gemini first.
- No door added. Sixteen auto doors and four gated channels, unchanged.
- Takeover default `false`.
- Closed order list and refusal line unchanged.
- $0. No paid brain. No card required.
- Videos still need audio. Owner writes articles. No replies to readers.
