# PHASE D REPORT: the brains, the orders, the phone

Branch: `arena/1d438dc4-lixxonstudio`
Start of Phase D: `adfd366` (Phase C slice 6).
Phase D commits, in order: slice 1 `7a6cb1d`, slice 2 `6cdf9b1`, slice 3 `a7cf686`, slice 4 `c3e0f8c`, slice 5 `b667e81`, slice 6 is this commit (see `git log -1`).

Nothing was merged to `main`. No pull request was opened. Nothing was deployed. No migration was applied. Takeover stays off by default. No brain, door, or order kind was added.

## Slices

### 1. The probe walks the brain chain (`7a6cb1d`)

- The Buddy probe used to check Gemini only. It now uses the same chain as a chat answer (`askBrains`). Any brain with a saved key is enough.
- A successful probe names the brain that answered (`brain`, `model`).
- The stored probe status belongs to the Google key (`gemini_api_key`). It is written only when Gemini is the brain that answered, or when Gemini was the only brain tried. A Groq answer never overwrites the Google key's status.
- Tests: `src/__tests__/buddyProbeChain.test.ts` (Groq only, Gemini 429 then Groq, Gemini alone, none saved, every brain failing, Gemini rejected).
- One Phase C freeze pattern was updated to the new probe shape (`brain: answer.brain`). The freeze's intent is kept: the probe says which brain answered.

### 2. Model-filed orders checked against the closed list (`6cdf9b1`)

- Before: a model's order was filed unless its text matched the refusal regex. Nothing checked the order against the closed list of five kinds.
- Now: the model labels each order with a `kind`. Only `mind_work` (a named mind asked to do work) is filed. The other four kinds come only from the owner's own words and fixed rules. A model order with no kind, or with any other kind, is not filed. The owner gets one plain line: "Buddy can only file work for a named mind from here. Nothing was filed or changed."
- The refusal regex still runs first.
- Tests: `src/__tests__/buddyOrderKind.test.ts`. Three existing order fixtures now name `kind: "mind_work"`.

### 3. Notifications fire from the day run (`a7cf686`)

Three faults were found while checking whether a notable event buzzes the phone:

1. **Gone devices were never dropped.** `markGone` in the day run wrote `revoked_at` directly. The table requires a revoked row to have no endpoint or keys, so the update was refused. Its error was ignored, and the device was retried forever. It now goes through `push_record_delivery`, the same record function the push handler uses.
2. **Sent pushes left no status.** The Settings page showed no last delivery. A sent device is now recorded as `sent` through the same function.
3. **The placement step could throw.** On a site-read failure, `runAgainstSite` returned `reply(req, …)`, but `req` is not in scope there. The day run threw instead of holding. It now returns the held outcome. This was also the one type error left in the edge functions.

Tests: `src/__tests__/notablePush.test.ts` (sent and gone paths, and a failing status write), `src/__tests__/notablePushWiring.test.ts` (source checks).

**Not verified live:** an actual notification on a real phone. This sandbox cannot reach push services. The day run also calls `push_record_delivery`, which lives in `20261006180000_web_push_subscriptions.sql`. Confirm that migration is applied on the live database.

### 4. The minds walk the brain chain, and the wording says brain (`c3e0f8c`)

- The minds' one door (`makeMindThink`) used to call Gemini only. It now walks the same chain as Buddy's chat: the first saved brain that answers wins, and a brain with no saved key is skipped. Keys are read on the server through the Vault path and are never passed to a mind.
- Owner-facing lines no longer say Google: the no-key line is now "Cannot think: no brain key saved", the Auditor's fix points to the Brains page, and the failure details are brain-neutral.
- Tests: `src/__tests__/mindThinkAdapter.test.ts` (Groq only, Gemini rate limited then Groq, every brain failing with no key text). Copy pins in the minds, placement and pack tests were updated.
- Historical log rows in some fixtures still read "Cannot think: no Google key". Those are old rows, so their tests were left alone.

### 5. WhatsApp is gone from the distribution code (`b667e81`)

- Removed WhatsApp from the distribution handler's channel list and key maps, from the adapters' readback check and its channel list, and from the alert label. A WhatsApp request is now refused without any provider call.
- The WhatsApp key names stay on the not-offered list, so old rows stay hidden.
- Kept `src/lib/automationDistribution.ts`. Its test still uses the video-template parsing, and whether the video-template editor comes back is the owner's call (see below).
- Test: a WhatsApp check is refused with no provider call (`distributionHandler.test.ts`).

### 6. Report and freeze

- `src/__tests__/phaseDFreeze.test.ts`: 13 source checks covering slices 1–5.

## Checks run

- Full suite (final run): 153 files, 1998 passed, 6 skipped, exit 0.
- App type check (`npm run typecheck`): exit 0.
- Edge-function type check (`supabase/functions/tsconfig.json`): clean. The `minds-run-placement` error from earlier in Phase D is gone; it was the bug in slice 3.
- Lint on every file changed in Phase D: exit 0.

## Decisions to know about

- A model may file only `mind_work` orders (slice 2). Other kinds stay with the owner's words and fixed rules.
- The stored probe status is the Google key's status only (slice 1).
- A sent push is recorded per device, the same way the push handler records it (slice 3).

## Still waiting on the owner

- **Migrations not applied.** `20261018000000_notable_week_change.sql` and `20261018010000_retire_old_sender_keys.sql`, plus the earlier unapplied ones from Phases 2–9 and A. The day run's push fix needs `20261006180000_web_push_subscriptions.sql` applied. The UI hides WhatsApp key rows; the database still accepts WhatsApp key saves until `20261018010000` is applied. Do not report that as done.
- **Video-template editor.** Decide whether to bring it back on a new screen. Its code is in git at `543a777`. `src/lib/automationDistribution.ts` stays until then.
- **Stash.** `stash@{0}` ("phase C pre-sync backup of worktree at a128521") can be deleted once you have looked at it.
- **Live checks.** A real notification on a phone. One live brain call per brain with a real key. Groq's model list changes without notice.
- **Go-live.** Still waiting: merge, the owner's keys (added through Vault in Keys, never pasted in chat), connecting the doors, and a phone test of the notifications.

## Not done in Phase D

- Did not add a brain, door, or order kind.
- Did not touch the Medium, Cerebras, DeepSeek or other provider decisions from Phase A.
- Did not change the 08:00 Africa/Lagos job or the clock copy.
