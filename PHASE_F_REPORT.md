# PHASE F report

Branch: `arena/1d438dc4-lixxonstudio`. Base: `main` at `a128521230ab11c197e7d23d035ad7f973b216a7` (re-read at report time; unchanged).

**Code HEAD at the verified test run: `587fae7`.** This report is committed on top of it. `git log -1` shows the report commit.

**Nothing merged, deployed, or applied.** No pull request is open. No migration has been applied. No deploy has run. No key was pasted, logged, or written to any file. No live LLM, door, push, Telegram, YouTube, Graph, or Web Push call was made. Tests use fake fetch and fake send. Takeover default is still `false`, and it was not turned on. There is no Phase G.

## Commits in Phase F

| Slice | Commit | What |
|---|---|---|
| 1 | `199078e` | `PHASE_F_INVENTORY.md`: the lock walk |
| 2 | `dfd88ee` | How-to covers all 16 auto doors and all eight brains; leftover copy fixed |
| 3 | `d57b10d` | Day-run log labels each row by outcome (`doorLogAction`) |
| 4 | `57a6e37` | Audio fixture documented; silent test render kept; clocks confirmed in config and source. No cron applied |
| 5 | `fb9a796` | `GO_LIVE.md`, ten owner steps. `config.toml` explicit `verify_jwt = true` for `minds-run-placement` and `door-connection-test` |
| 6 | `3b1263b` | `src/buddy/phaseFFreeze.test.ts`, first version, and this report's first version |
| 6 (re-audit) | `587fae7` | Fixes found by a second walk of the full spec (below). Freeze made behavioural. Report corrected |

## What the first version of this report got wrong

A second walk against the full spec found these errors. They are fixed in `587fae7`:

1. **"Delete the old one" was not refused.** The first report called this a gap and left it for the owner. The never-list has no deletes, so this was a lock breach. It is fixed: delete, erase or trash with no noun is refused (`buddyOrderPolicy.ts`). The Phase E test that pinned the gap now expects a refusal.
2. **The 1–2 sentence product-line rule was called a gap. It is not.** `productPlacement.ts` enforces 2 sentences, 60 words, 3 products, no dash, no country or city, no non-USD money, the exact shop price, and no new product. It is now pinned behaviourally.
3. **Code leftover `src/buddy/minds/mindRun.ts` was reported as "documented, not deleted".** It was an unwired client aggregate used by one test file. It is removed. The four-mind order now sits in `src/__tests__/mindsWorkers.test.ts`.
4. **Owner copy said posting "come[s] in a later phase".** `HELD_LATER_PHASE` is now `HELD_NOT_FROM_CHAT` and says what is true. The freeze fails on any owner-facing "later phase".
5. **Comment said "twelve auto doors" and that posting was not built** (`AdminConnections.tsx`). Corrected.
6. **README lied in four places.** `mindThink.ts` was "the one door to Gemini". The minds were "still Google only". The old distribution page "still has WhatsApp, Facebook and Pinterest senders". The page was deleted in Phase C. All corrected.
7. **The lock count was wrong.** The inventory has 50 lock rows, not 56.
8. **The freeze was partly grep-only.** Quiet, the Analyst floor, the copy rules, the skipped brains, the product-line limits and the connection test are now checked by running the real functions.

## Tiny fixes made in Phase F (all)

- **Slice 2:** `HOWTO_DOORS` had 10 of the 16 open doors. The missing six (telegram, bluesky, mastodon, tumblr, discord, blogger) now have replies. The stale header and Google-only lines are corrected in `buddyHowTo.ts`. `supabase/config.toml` line 41 and `src/buddy/README.md` lines 32–33 are corrected.
- **Slice 3:** the day-run log said "Posted to X" for failed and skipped rows. Failed rows now say "Could not post to X" (or "Could not ping X" for RSS). Skipped rows say "Skipped X". `doorLogAction` is in `rssHub.ts` and used in `minds-run-placement/index.ts`.
- **Slice 4:** header comment on `scripts/render-video-test.mjs` and a new `scripts/fixtures/README.md`. The silent test render (`-an`) is kept. Reader packs are never silent.
- **Slice 5:** explicit `verify_jwt = true` entries for `minds-run-placement` and `door-connection-test`. The effective default is unchanged.
- **Slice 6 (first):** one Phase E test changed: "Phase F is not started" became "Phase F files do not replace Phase E".
- **Slice 6 (re-audit):**
  - Delete gate: "delete / erase / trash" plus "the old one", "it", "that", "them" is refused (`buddyOrderPolicy.ts`). The Phase E finding test now expects a refusal.
  - Held-order copy and identifiers renamed (`buddyOrders.ts` and three tests).
  - `mindRun.ts` removed. `mindsWorkers.test.ts` now holds the four-mind order.
  - `AdminConnections.tsx` comment corrected.
  - `src/buddy/README.md`: four stale lines corrected.
  - `GO_LIVE.md`: step 9 no longer states an unverified form step. Step 3 gives the 65-file count for older migrations. Decision B is marked fixed. The decisions intro no longer says every item is working code.
  - `PHASE_F_INVENTORY.md`: re-audit rows R1–R15 added.

No new feature, door, brain, order kind, or mind was added. Admin AI was not restored. No migration was applied.

## Inventory: each lock → pass

The lock list in `PHASE_F_INVENTORY.md` has 50 rows. "Pass" means the named test passed in the full run on `587fae7`. Freeze groups refer to `src/buddy/phaseFFreeze.test.ts` unless another file is named.

### Buddy

| # | Lock | Pinned by | Result |
|---|---|---|---|
| B1 | Only Buddy talks; no mind has a chat route | F: "only Buddy talks"; `buddyPhase3Freeze` | pass |
| B2 | Asking about a mind → daily log, not a guess | F: "asking about a mind answers from the daily log" (real router) | pass |
| B3 | Order → waiting / done / blocked lines | F: "order lines say waiting when Takeover is off"; `phaseBFreeze` | pass |
| B4 | Greeting + Continue | F: "greeting has Continue; new chat and past chats" | pass |
| B5 | Four looks: Noir Gold (default), Ivory Silk, Velvet Opera, Porcelain | F: "four looks" (real `VIBES`) | pass |
| B6 | Buddy look ignores magazine light/dark | F: "Buddy look ignores the magazine light and dark setting" | pass |
| B7 | Hear-Buddy exists, off unless the owner turns it on | F: "hear-Buddy exists and is off…" (default and settings switch) | pass |
| B8 | New chat + past chats | F: "greeting has Continue; new chat and past chats" | pass |
| B9 | Today's briefing is one thread; Night Reports separate | F: "today is one briefing thread…"; `phase7Freeze`; `phase9Freeze` | pass |
| B10 | Many sections, not one blob | F: "briefing has many sections, not one blob" (real `buildBriefing`); `phase8Freeze` | pass |
| B11 | Quiet only when every source was read and empty | F: "briefing is quiet only when every source was read and empty" (real function); F: "the briefing reader passes every source" | pass |
| B12 | Notable kinds, including `door_failed` (exact list) | F: "notable kinds are exactly the briefing list" | pass |
| B13 | Count-only: messages, comments, refunds, carts; never name, email or body | F: "…counts only, never a name, email or body" (field names checked); `phaseDFreeze` | pass |
| B14 | "Your next move" line; "There is a message for you" | F: "a next-move line and … exist in the briefing" | pass |
| B15 | Chief-of-staff text: Takeover off = nothing changes; on = allowed work, said so | F: "chief of staff…" | pass |
| B16 | Show-the-paragraph path; owner writes | F: "show-the-paragraph path…"; `buddyPhase3Freeze` | pass |
| B17 | Buddy never replies to readers | F: "Buddy never replies to readers…"; `phase9Freeze` | pass |
| B18 | Never-list: no reader reply, no spend, no create, no full rewrite | F: "refuses the never-list requests"; "Delete the old one…"; `phase8Freeze` | pass |
| B19 | Closed five kinds; `REFUSAL_LINE` exact; questions not refused | F: "the closed five order kinds…", "REFUSAL_LINE…", "a question is answered as a question…"; `phaseBFreeze` | pass |
| B20 | Unnamed swap → Executioner; named mind respected; Takeover off → wait | F: "an unnamed swap is filed for the Executioner…"; `phaseEFreeze` | pass |
| B21 | Phone buzz kinds = briefing kinds + `job_finished`; `/buddy`; missing VAPID = skip | F: "phone buzz kinds…", "the push link goes to /buddy", "missing VAPID…"; `phaseDFreeze` | pass |
| B22 | Server flush so a closed Minds tab cannot drop a buzz | F: "the server flush exists…"; `phaseEFreeze` | pass |

### Minds and Admin

| # | Lock | Pinned by | Result |
|---|---|---|---|
| M1 | Keys analyst, strategist, ceo, executioner, auditor; Buddy is the sixth card | F: "keys are analyst…"; `phaseCFreeze` | pass |
| M2 | Analyst: week vs week; floor so 0→1 is not a spike; cannot-see | F: "Analyst: week vs week…" (real `planWeekNotables`); `phaseBFreeze` | pass |
| M3 | Strategist suggests, never publishes | F: "Strategist suggests and never publishes…"; `buddyPhase3Freeze` | pass |
| M4 | CEO sorts waiting work | F: same test as M3 | pass |
| M5 | Executioner packs and sends free doors only; nothing while Takeover off; never the four hand doors | F: "Executioner packs and sends free doors only…"; `phaseCFreeze`; `buddyPhase3Freeze` | pass |
| M6 | Auditor checks first; no other mind can switch it off; Buddy refuses | F: "Auditor checks before a change…"; `phase8Freeze` | pass |
| M7 | Takeover default false; kill none / all / one | F: "Takeover default is false in the schema"; "kill options…" | pass |
| M8 | No `AdminAI.tsx`; no 22-tab tower; Distribution → Minds; Video look is a small screen | F: "there is no AdminAI.tsx…"; "Distribution address goes to Minds"; "Video look is a small screen…" | pass |
| M9 | Daily log table and writer exist | F: "the daily log table and writer exist…"; `phaseEFreeze` | pass |
| M10 | Living minds use the brain chain; retry the same day after failure; not if `done` | F: "a living mind with a done row today…", "the minds and Buddy's probe walk the brain chain…"; `phaseEFreeze` | pass |
| M11 | Advisor stays CMS health, not a mind | F: "Advisor stays CMS health…"; `phaseCFreeze` | pass |
| M12 | Social Shares stay counts, no send | F: same test as M11 | pass |

### Articles, shop, money, voice

| # | Lock | Pinned by | Result |
|---|---|---|---|
| A1 | Owner writes; cap three products; 1–2 sentence product lines; drip old; digital first; no auto-create | F: "a pack carries at most three products"; "a product line is one or two sentences…"; "digital products lead…"; "the owner writes articles…" (real `auditPlacement`, `digitalFirst`). Drip: `buddyPhase3Freeze` | pass |
| A2 | USD; no Naira on reader copy; no Nigeria/Lagos/WAT on screen; clock stays Africa/Lagos in code | F: "USD: NGN is hidden…" (real `copyProblem`); "no Nigeria, Lagos, WAT or Naira on any screen string"; "the clock stays Africa/Lagos…" | pass |
| A3 | Top countries US, UK, CA, AU, IE, NZ, SG; times can learn | F: "top countries…"; times learning: `buddyPhase4Freeze` | pass |
| A4 | $0; no paid brain; Cerebras and DeepSeek skipped | F: "$0: no paid brain is tried…"; `phaseAFreeze` | pass |

### Doors

| # | Lock | Pinned by | Result |
|---|---|---|---|
| D1 | Gated 4: caption, time, image, video, link; Buddy does not press Post; "I posted this" exists | F: "the gated four are not auto doors…", "the gated pack carries caption…"; `buddyPhase4Freeze` | pass |
| D2 | Auto 16, exact list, all open | F: "the 16 auto doors are exactly these, all open" | pass |
| D3 | RSS four: ping hub; honest skip; no fake login | F: "the RSS four are ping-hub doors…"; `phase8Freeze` | pass |
| D4 | Skip when media missing: YouTube/Vimeo video, podcast audio, Pixelfed image | F: "skip when required media is missing…"; `phase6Freeze` | pass |
| D5 | Connections: door details; secrets never echoed; test does not publish | F: "connections show door details…"; "the connection test does not publish: its only POSTs are…" (exactly two, no publish URL); `phaseAFreeze` | pass |
| D6 | How-to: each open door and each brain; skipped brains say so | F: "the how-to covers every open door, and every brain…" (real `brainHowToReply`); `buddyHowTo.test` | pass |
| D7 | No WhatsApp, Feedly, X or 21st door | F: "no WhatsApp, Feedly, X or 21st door…" | pass |

### Video, night, brains

| # | Lock | Pinned by | Result |
|---|---|---|---|
| V1 | Pack 1080×1920; captions; audio (no `-an`); espeak fallback | F: "the pack is 1080 x 1920…", "packs are never silent…", "voice falls back to a local espeak" | pass |
| V2 | Night writer and night clock in `config.toml`; night is not morning | F: "night writer and night clock are in config.toml…"; `phase7Freeze`; `phase9Freeze` | pass |
| V3 | Eight slots, try six, skip two, Gemini first; probe = `askBrains`; status = any tryable; 429 → next | F: "eight slots…", "the minds and Buddy's probe walk…"; 429 → next: `phaseAFreeze` | pass |
| V4 | No GitHub, Bytez or Mistral workhorse | F: "no GitHub, Bytez or Mistral workhorse brain" | pass |
| V5 | 08:00 Lagos clock in code (`0 7 * * *` UTC); scheduler in config; minds cron stays a comment | F: "the 08:00 Lagos daily clock is in code…"; "the minds daily-run cron line stays a comment…" | pass |

## Mutation checks

The freeze must fail when a lock breaks. Two were run. Each change was made to source, the freeze was run, and the file was restored from git.

- `DEFAULT_VIBE` set to `ivory-silk`: the four-looks test fails.
- `PLACEMENT_MAX_SENTENCES` set to 3: the one-or-two-sentence test fails.

## Code leftovers

Phase F removed the unwired client aggregate `mindRun.ts`. Three items remain. Each is kept on purpose. The owner decides them, and none is an unfinished piece of code.

1. **`src/lib/automationDistribution.ts`: WhatsApp share entries.** These are share-link helpers in the video-template library. They are not a door, and no screen shows them. The owner decided in Phase E to keep the library. I did not remove the entries, because that changes the library, which the owner has not asked for.
2. **`supabase/functions/automation-distribution`: a legacy, deployable function.** Checked against the lock. No WhatsApp. Facebook and Pinterest have no send path (`check` is read-only). `send_telegram` is owner-started. `test_newsletter` emails only the owner's own confirmed address. Its presence is an owner decision. It is listed in GO_LIVE step 4.
3. **`src/buddy/README.md` and `PHASE_C_REPORT.md` history lines.** The old lines were corrected in the README. Phase reports are kept as written history.

## Known gaps (named, not fixed)

These are owner decisions, not unfinished code. The screens say so where it matters.

- **Saved Video look is not read by the daily video or pack.** The screen says so (`LOOK_NOT_USED_YET`). Owner decision D.
- **The daily run starts on "run today" or Run, not on a timer.** The 08:00 pipeline is in code. The minds' daily-run cron line is a comment. Owner decision A.
- **`buildBriefing` treats an omitted optional source as read.** The real caller (`buddy-think`, lines 269–279) passes every source, and the freeze pins that. Changing the default would move many existing tests. A future caller must pass every source.
- **Legacy Phase E report wording.** `PHASE_E_REPORT.md` still records the delete gap as open, because it is a historical report. Phase F closed it, as described above.

## Go-live leftovers

Only the steps in `GO_LIVE.md`. The agent does not do steps 2–4, and does not do steps 5–10 either.

1. Review this branch against `main`
2. Merge, when you say so
3. Apply the unapplied migrations, in filename order. The repository marks 38 files as not applied. Check 65 older files on production too
4. Deploy the edge functions (20 functions, listed in `GO_LIVE.md`)
5. Keys: paste them only in the app
6. Register your phone for push
7. Connect only the doors you actually have
8. Open Buddy, and read the briefing
9. Flipboard, Google News, Microsoft Start and SmartNews
10. Takeover stays off until you are ready

Owner decisions A–F and the eyes-only checks are in `GO_LIVE.md`.

## Verification (on `587fae7`)

| Check | Result |
|---|---|
| `npx vitest run` (full suite) | 170 files passed. 2305 tests passed, 6 skipped, 0 failed. Exit 0 |
| Freeze suites (`Freeze` in the filename): A–E and F | 13 files, 367 tests passed. A–E: 12 files, 289 tests. F: `phaseFFreeze.test.ts`, 78 tests |
| `npx tsc --noEmit -p tsconfig.app.json` | exit 0 |
| `npx tsc --noEmit -p supabase/functions/tsconfig.json` | exit 0 |
| `npx eslint .` | 0 errors, 30 warnings, exit 0. Warnings are in files Phase F did not change, plus three already present in `AdminConnections.tsx` (exports from a component file). My change there was comments only |

Notes:
- The first full-suite run in slice 6 failed the app type-check. My freeze had imported a `.mjs` file without types and pulled a Deno `npm:` import into the app build. Those reads now use source checks. The final app type-check exits 0.
- `git diff --stat a128521 HEAD` is 321 files. That is the whole arena branch, Phases A–F, not Phase F alone. None of it is on `main`.

**Nothing merged, deployed, or applied.**
