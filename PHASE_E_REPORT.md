# PHASE E REPORT

Branch: `arena/1d438dc4-lixxonstudio`. Nothing merged, deployed, or applied. Every new migration is a file only.
Base for this phase: Phase D close-out `7fc9f37`. Freeze: `src/buddy/phaseEFreeze.test.ts`.

## Commits

| Slice | Commit | What |
|---|---|---|
| 1 | `84b05e4` | Owner push: flush, claim before send, one attempt path, pending migration file |
| 2 | `50daea2` | Unnamed imperative swap goes to Executioner; refusal clause widened |
| 3 | `2d48751` | Living minds: per-mind done and stopped rows; failed or empty day may retry the same day |
| 4 | `5abd549` | Video look screen with three bounded, saved values |
| 5 | `b272ba7` | Carts policy migration file (not applied); dead costume checked; test |
| fix | `5c713ff` | Flush reads no claim column before the pending migration (see below) |
| 6 | `2a293b3` | Freeze and this report |
| 6b | next commit on the branch (see `git log`) | Freeze: the delete gap is pinned as a behaviour check; this report corrected with the final numbers |

HEAD when this report was written was `2a293b3`. A report cannot name the commit that contains it, so the final HEAD is the last commit on `arena/1d438dc4-lixxonstudio` (`git rev-parse HEAD`).

## Decisions

1. **Swap with no mind named goes to Executioner.** No "Which mind?" prompt for swaps. Questions are never filed.
2. **Non-swap unnamed orders still ask "Which mind?".** This is a decision for the owner. It was not stated in the spec. It is kept as is, and it is pinned in the freeze.
3. **A `sent` row is never pushed again.** The flush skips it, and it is checked a second time before any send.
4. **A failed or empty living-mind day may retry the same local day. A done row must not retry.** A killed mind with a stopped row today is skipped.
5. **The browser push stays as best effort, and is not the only path.** `minds-control-notify` still pushes at once. The server flush runs in `buddy-night-clock` and at the start of the day run, so closed-tab cases are covered.
6. **Video look: keep the library, no full editor.** The screen has three bounded values (saved through the existing template RPC with activate). It says on the page, permanently, that the daily video does not use the look yet.
7. **The carts anon-UPDATE fix is a new migration file only, and it is not applied.**
8. **Phase E adds no brain, no door, and no order kind.** Cerebras and DeepSeek stay skipped.

## One-send guarantee needs the pending migration applied

`supabase/migrations/20261019010000_push_note_pending.sql` adds `pending` to the `push_note` check and adds `push_claimed_at`. It is **not applied**.

- Until it is applied, a push claim cannot be written. The claim write errors, and the attempt still sends. This matches the behaviour before Phase E, so there is no regression. But two attempts running at once can both send. The one-send guarantee does **not** hold across concurrent attempts until the migration is applied.
- Once applied, a fresh `pending` claim (under 10 minutes) is skipped, and a stale one is taken over only by compare-and-set on the claim time read.

### Bug found and fixed in this phase (`5c713ff`)

Slice 1 selected `push_claimed_at` in every notable read. Before the migration is applied, that column does not exist, so every read would fail. That would have broken owner pushes that work today. The fix:

- The shared select no longer includes `push_claimed_at`.
- Claim times are read only for rows already marked `pending`, which only exists after the migration is applied.
- A failed claim-time read counts the row as fresh. It is skipped this time, and never sent twice.
- Tests: `src/__tests__/notablePushAdapter.test.ts` (six tests, fake client).

## Freeze re-pointing

- `src/buddy/phaseDFreeze.test.ts` source checks for the push path now read the shared helper `notablePush.ts` and the one attempt path `attemptRow` in `notablePushServer.ts`. They used to read the old call sites. The Phase D freeze still passes.
- `src/__tests__/notablePushOwner.test.ts` and `notablePushWiring.test.ts` read the shared module for the same reason.
- `src/__tests__/buddyPhase3Freeze.test.ts` and `src/__tests__/phase7Freeze.test.ts` expected `notifyOwnerDevices(` in the day run file. They now expect the day run to call `attemptRow(`, and the shared server file to call `notifyOwnerDevices(`. The full suite found these two; they were fixed in this phase.

## Finding: a delete request is filed as an order (not fixed)

Checked by running the gate, not by reading it. `gateOrder('mind_work', 'Delete the old one')` returns `{ ok: true, kind: 'mind_work' }`. So the message is **filed as a mind order**. `refusedRequest` returns `false` for it, because the delete pattern needs a listed object noun (article, post, page, product, comment, draft, image, video, order) and "old one" is not on the list. "Delete that post" is refused, as it should be.

Deletes are outside the closed list, so this is a real gap in the Phase D order gate. Phase E does not reopen Phase D code, so it is **reported, not fixed**. The freeze test pins the current result (`src/buddy/phaseEFreeze.test.ts`), so a fix will show up as a test change. This is an owner decision: fix the gate, or accept it.

## Lint

ESLint on the 243 TypeScript and JavaScript files changed since the branch base `a128521` (the `main` commit this branch was cut from) exits 0: 0 errors, 5 warnings. The warnings are react-refresh warnings in `AdminConnections.tsx` and `NavigationContext.tsx`, which Phase E did not change. Three older test files from earlier phases had errors (`buddyRouter.test.ts` unused import, `doorWiring.test.ts` useless escapes, `notableSources.test.ts` unused parameter). They are fixed in this phase. The Phase D close-out did not catch them, because its lint list was narrower.

## Carts (slice 5)

- `20261004230000_security_hardening_v2.sql` already drops `abandoned_carts_anon_update` and `rl_ac_update`. Nothing re-creates them.
- The storefront writes carts only through the definer function `upsert_abandoned_cart`. The only UPDATE on the table in app code is the owner's `markRecovered`, which runs in the owner session.
- The new file `20261019000000_abandoned_carts_no_anon_update.sql` drops both names again. It is idempotent. It covers a database where `20261004230000` was never applied. It is **not applied**.
- Whether the live database still has the old policy is **unknown**. This needs checking against production.

## Dead costume (slice 5)

`AdminAI.tsx` and `AutomationDistribution.tsx` were removed in Phase C. Checked again in this phase: both files are absent, and `RetiredDistributionRedirect` in `AdminApp.tsx` is kept on purpose. `src/lib/automationDistribution.ts` and its test are kept on purpose (video template library).

## Video look is not read by the daily video

The saved look is stored only. The daily video, the pack video (`scripts/pack-video.mjs`) and the test render workflow (`.github/workflows/video-render-test.yml`) do not read it. The test render takes a template only from dispatch input `template_json`. The screen says this on the page.

An earlier, uncommitted attempt to make the pack video read the look was reverted by owner decision. It is not in this branch.

## Verification

Run on the tree of this report:

- Full vitest, `npx vitest run`: 168 files passed, 2220 tests passed, 6 skipped, 0 failed.
- A separate export of `2a293b3` (`git archive`), run the same way: 168 files, 2220 passed, 6 skipped. The committed slice 6 is green on its own.
- App typecheck `npx tsc --noEmit -p tsconfig.app.json`: exit 0.
- Edge typecheck `npx tsc --noEmit -p supabase/functions/tsconfig.json`: exit 0.
- ESLint on the 243 changed files: exit 0, 0 errors, 5 warnings (see Lint).
- Focused: `phaseEFreeze` 28 passed. `phaseESlice5` 8 passed. `notablePushAdapter` 6 passed. `videoLook` 18 and `videoLookScreen` 6 passed (slice 4).

Earlier in this phase, a full run had 2 failures (`buddyPhase3Freeze` and `phase7Freeze`). Both were source checks that still looked at the old call site. They were re-pointed (see Freeze re-pointing). I did not establish the exact cause of that first run.

### Uncommitted work found and reverted

Before the final checks, the workspace held uncommitted changes from an earlier pass that were not in the commits above. They removed the old Distribution channel model from `src/lib/automationDistribution.ts` and its test, made the pack video read the saved look, added a REVOKE to the carts migration, and rewrote the freeze test. Four tests failed in that tree. The owner decided: keep the library and its test, revert the pack wiring, and drop the REVOKE. The tree was reverted to HEAD. A backup is kept outside the repository at `/home/user/backup-phase-e/`. None of that work is on the branch.

Checks are source and fixture only. No live brain, door, push, Telegram, YouTube, Graph, or Web Push call was made. No database was touched. No real MP4 was probed (no FFmpeg in the sandbox). The pending migration is not applied, so the one-send guarantee is not yet proven against the live database.

## Go-live leftovers

- Apply `20261019010000_push_note_pending.sql` (the one-send guarantee depends on it).
- Apply `20261019000000_abandoned_carts_no_anon_update.sql`, after checking the live policy state.
- Apply `20261018000000_notable_week_change.sql` (from Phase D).
- Deploy `minds-control-notify` and the changed `buddy-night-clock` and `minds-run-placement` functions.
- Real VAPID push to a phone (Web Push), with the owner's device.
- Live brain calls, with real keys added through Vault in Keys.
- Living steps on real rows.
- Silent test-fixture render and a real MP4 audio probe (FFmpeg).
- Decide whether "Which mind?" should stay for non-swap unnamed orders (decision 2).
- Owner decision on the delete gap: `gateOrder` files "Delete the old one" as `mind_work` (see the finding above). Fix it in the Phase D gate, or accept it.
- Decide whether the saved video look should reach the daily video (a later phase, not this one).
- Confirm Gemini TTS free-tier terms on Google's pricing page before telling the owner.

## Eyes-only leftovers

- Visual check of the Video look screen and the Buddy screens in a browser.
- Check that no Nigeria, Naira or Lagos text appears on any screen (the Video look screen is covered by a test).

## Nothing merged, deployed, or applied

Nothing was merged, no PR was opened, nothing was deployed, and no migration was applied. Phase F was not started.
