# PHASE F report

Branch: `arena/1d438dc4-lixxonstudio`. Base: `main` at `a128521230ab11c197e7d23d035ad7f973b216a7` (unchanged).
Branch tip before this report commit: `fb9a796`. This report is committed on top of it; `git log -1` shows the final sha.

**Nothing merged, deployed, or applied.** No pull request is open. No migration has been applied. No deploy has run. No key was pasted, logged, or written to any file. No live LLM, door, push, Telegram, YouTube, Graph, or Web Push call was made. Tests use fake fetch and fake send. Takeover default is still `false`, and it was not turned on.

## Commits in Phase F

| Slice | Commit | What |
|---|---|---|
| 1 | `199078e` | `PHASE_F_INVENTORY.md`: the lock walk, 50 lock rows, findings X1–X6 |
| 2 | `dfd88ee` | How-to covers all 16 auto doors and all eight brains |
| 3 | `d57b10d` | Day-run log labels each row by outcome (`doorLogAction`) |
| 4 | `57a6e37` | Audio fixture documented, silent test render kept, clocks confirmed in config and source. No cron applied |
| 5 | `fb9a796` | `GO_LIVE.md`, ten owner steps. `config.toml` explicit `verify_jwt = true` for `minds-run-placement` and `door-connection-test` |
| 6 | this commit | `src/buddy/phaseFFreeze.test.ts` (66 tests), this report, and one Phase E freeze test updated (see below) |

## Tiny fixes made in Phase F

- **Slice 2:** `HOWTO_DOORS` had 10 of the 16 open doors. Six were missing (telegram, bluesky, mastodon, tumblr, discord, blogger). They are added with replies. The stale "six doors" header and Google-only lines were corrected in `supabase/functions/_shared/buddyHowTo.ts`. Fixed `supabase/config.toml` line 41 and `src/buddy/README.md` lines 32–33, which described the old single Gemini call.
- **Slice 3:** the day-run log wrote "Posted to X" for failed and skipped rows. It now writes "Could not post to X" (or "Could not ping X" for RSS) and "Skipped X" (`doorLogAction` in `supabase/functions/_shared/rssHub.ts`, used at ~line 561 of `minds-run-placement/index.ts`).
- **Slice 4:** a header comment in `scripts/render-video-test.mjs`, and a new `scripts/fixtures/README.md`. The silent test render (`-an`) is kept on purpose. Reader packs are never silent.
- **Slice 5:** explicit `verify_jwt = true` entries for `minds-run-placement` and `door-connection-test`. The effective default is unchanged.
- **Slice 6:** one Phase E test changed. `phaseEFreeze.test.ts` had "Phase F is not started: no Phase F report or freeze file exists". That was true during Phase E and is no longer true. It now reads "Phase F files do not replace Phase E: the Phase E freeze and report keep their own names". This keeps the boundary the test was protecting. No Phase E behaviour changed.

No new feature, door, brain, order kind, or mind was added in Phase F. Admin AI was not restored.

## Inventory: each lock → pass

The lock list in `PHASE_F_INVENTORY.md` has 50 rows. (An earlier note said 56. That was wrong.) "Pass" means the named test passed in the full run on the final tree (170 files, 2293 passed, 0 failed). Freeze groups refer to `src/buddy/phaseFFreeze.test.ts` unless another file is named.

### Buddy

| # | Lock | Pinned by | Result |
|---|---|---|---|
| B1 | Only Buddy talks; no mind has a chat route | F: "only Buddy talks"; `buddyPhase3Freeze` | pass |
| B2 | Asking about a mind → daily log, not a guess | F: "asking about a mind answers from the daily log" | pass |
| B3 | Order → waiting / done / blocked lines | F: "order lines show waiting, done or blocked"; `phaseBFreeze` | pass |
| B4 | Greeting + Continue | F: "greeting has Continue; new chat and past chats" | pass |
| B5 | Four looks: Noir Gold (default), Ivory Silk, Velvet Opera, Porcelain | F: "four looks" (mutation-checked, see below) | pass |
| B6 | Buddy look ignores magazine light/dark | F: "Buddy look ignores the magazine light and dark setting" | pass |
| B7 | Hear-Buddy exists, off unless the owner turns it on | F: "hear-Buddy exists and is off…" | pass |
| B8 | New chat + past chats | F: "greeting has Continue; new chat and past chats" | pass |
| B9 | Today's briefing is one thread; Night Reports are separate | F: "today is one briefing thread…"; `phase7Freeze`; `phase9Freeze` | pass |
| B10 | Briefing has many sections | `phase8Freeze` (seven sections) | pass |
| B11 | Quiet only when every source was read and empty | F: "the briefing is quiet only when…" | pass |
| B12 | Notable kinds, including `door_failed` (exact list) | F: "the briefing notable kinds…" | pass |
| B13 | Count-only messages, comments, refunds, carts | F: "messages, comments, refunds and carts are counts only"; `phaseDFreeze` | pass |
| B14 | "Your next move" line | F: "the briefing has a next-move line…" | pass |
| B15 | Chief-of-staff text: Takeover off = nothing changes; on = allowed work, said so | F: "chief of staff…" | pass |
| B16 | Show-the-paragraph path; owner writes | F: "show-the-paragraph path…"; `buddyPhase3Freeze` | pass |
| B17 | "There is a message for you"; Buddy never replies to readers | F: "Buddy never replies to readers…"; `phase9Freeze` | pass |
| B18 | Never-list: no reader reply, no spend, no create, no full rewrite | F: "refuses the never-list requests"; `phase8Freeze` | pass |
| B19 | Closed five kinds; `REFUSAL_LINE` exact; questions not refused | F: "the closed five order kinds…", "REFUSAL_LINE…", "a question about a held kind…"; `phaseBFreeze` | pass |
| B20 | Unnamed swap → Executioner; named mind respected; Takeover off → wait | F: "an unnamed swap is filed…"; "with Takeover off…"; `phaseEFreeze` | pass |
| B21 | Phone buzz kinds = briefing kinds + `job_finished`; `/buddy`; missing VAPID = skip | F: "phone buzz kinds…", "the push link goes to /buddy", "missing VAPID…"; `phaseDFreeze` | pass |
| B22 | Server flush so a closed Minds tab cannot drop a buzz | F: "the server flush exists…"; `phaseEFreeze` | pass |

### Minds and Admin

| # | Lock | Pinned by | Result |
|---|---|---|---|
| M1 | Keys analyst, strategist, ceo, executioner, auditor; Buddy is the sixth card | F: "keys are analyst…"; `phaseCFreeze` | pass |
| M2 | Analyst: week vs week; floor so 0→1 is not a spike; or cannot-see | F: "Analyst: week vs week…"; `phaseBFreeze` | pass |
| M3 | Strategist suggests, never publishes | F: "Strategist suggests and never publishes…"; `buddyPhase3Freeze` | pass |
| M4 | CEO sorts waiting work | F: same test as M3 | pass |
| M5 | Executioner packs and sends free doors only; nothing while Takeover is off; never the four hand doors | F: "Executioner packs and sends free doors only…"; `phaseCFreeze`; `buddyPhase3Freeze` | pass |
| M6 | Auditor checks before a change; no other mind can switch it off; Buddy refuses | F: "Auditor checks before a change…"; `phase8Freeze` | pass |
| M7 | Takeover default false; kill none / all / one | F: "Takeover default is false in the schema"; "kill options…" | pass |
| M8 | No `AdminAI.tsx`; no 22-tab tower; Distribution → Minds; Video look is a small screen | F: "there is no AdminAI.tsx…"; "Distribution address goes to Minds"; "Video look is a small screen" | pass |
| M9 | Daily log table and writer exist | F: "the daily log table and writer exist…"; `phaseEFreeze` | pass |
| M10 | Living Analyst/Strategist/CEO use the brain chain; retry same local day after failure; not if `done` | F: "a living mind with a done row today…"; `phaseEFreeze` | pass |
| M11 | Advisor stays CMS health, not a mind | F: "Advisor stays CMS health…"; `phaseCFreeze` | pass |
| M12 | Social Shares stay counts, no send | F: same test as M11 | pass |

### Articles, shop, money, voice

| # | Lock | Pinned by | Result |
|---|---|---|---|
| A1 | Owner writes; cap three products; drip old; digital first; no auto-create | F: "product cap is three…"; `buddyPhase3Freeze`; `phaseBFreeze`. **The 1–2 sentence product-line rule is not pinned; see Known gaps.** | pass (partial, see gap) |
| A2 | USD; no Naira on reader copy; no Nigeria / Lagos / WAT on screen; clock stays Africa/Lagos in code | F: "USD: NGN is hidden…"; "no Naira, Nigeria, Lagos or WAT…"; "the clock stays Africa/Lagos…" | pass |
| A3 | Top countries US, UK, CA, AU, IE, NZ, SG | F: "top countries are…" | pass |
| A4 | $0; no paid brain; Cerebras and DeepSeek skipped | F: "eight slots…"; `phaseAFreeze` | pass |

### Doors

| # | Lock | Pinned by | Result |
|---|---|---|---|
| D1 | Gated four: instagram, tiktok, facebook, pinterest; Buddy does not press Post; "I posted this" exists | F: "the gated four are gated…"; `buddyPhase4Freeze` | pass |
| D2 | Auto 16, exact list | F: "the 16 auto doors are exactly these…" | pass |
| D3 | RSS four: ping hub, honest skip, no fake login | F: "the RSS four are ping-hub doors…"; `phase8Freeze` | pass |
| D4 | Skip when media missing: YouTube/Vimeo video, podcast audio, Pixelfed image | F: "skips when required media is missing…"; `phase6Freeze` | pass |
| D5 | Connections show details; secrets never echoed; test does not publish | F: "connections show door details…"; "the connection test does not publish"; `phaseAFreeze` | pass |
| D6 | How-to covers every open door and every brain | F: "the how-to covers every open door and every brain"; `buddyHowTo.test` | pass (fixed in slice 2) |
| D7 | No WhatsApp, Feedly, X, or 21st door | F: "no WhatsApp, Feedly, X or 21st door…" | pass |

### Video, night, brains

| # | Lock | Pinned by | Result |
|---|---|---|---|
| V1 | Pack 1080×1920; captions; audio (no `-an`); espeak fallback | F: "the pack is 1080 x 1920…"; "packs are never silent…"; "voice falls back to a local espeak" | pass |
| V2 | Night writer and night clock in `config.toml`; night is not morning | F: "night writer and night clock are in config.toml…"; `phase7Freeze`; `phase9Freeze` | pass |
| V3 | Eight slots, try six, skip two, Gemini first; probe = `askBrains`; status = any tryable; 429 → next | F: "eight slots…"; "the probe is askBrains…"; "brain status…" | pass |
| V4 | No GitHub, Bytez, or Mistral workhorse | F: "no GitHub, Bytez or Mistral workhorse brain" | pass |
| V5 | 08:00 Lagos daily clock in code (`0 7 * * *` UTC); scheduler in config; minds cron stays commented | F: "the 08:00 Lagos daily clock is in code…"; "the minds daily-run cron line stays a comment…" | pass |

### Freeze checks not in the lock list

- No stub markers (`not implemented`, `stub`) in `supabase/functions`, `src/buddy`, or `src/admin`.
- The day-run log writes through `doorLogAction`.
- No `PHASE_G_REPORT.md` and no `phaseGFreeze` file exist. There is no Phase G.
- `GO_LIVE.md` exists and says the agent does not merge or deploy.

## Mutation check

To confirm the freeze fails when a lock breaks, I changed `DEFAULT_VIBE` in `src/buddy/buddyVibes.ts` from `noir-gold` to `ivory-silk`. The freeze failed on the four-looks test (65 passed, 1 failed). I then restored the file from git, and it is no longer modified.

## Code leftovers

Two items remain in code. Both are kept on purpose.

- `src/buddy/minds/mindRun.ts`: `runAllMinds` is an unwired client mirror of the day run. It is not a day-run step and makes no network call. It is labelled as unwired. Not deleted.
- `src/lib/automationDistribution.ts`: the library and its test are kept by owner decision. It still has a WhatsApp share helper. That is library-only, not a door, not on any screen, and covered by test only.

## Known gaps (not fixed in Phase F)

1. **"Delete the old one" passes the order gate.** `gateOrder('mind_work', "Delete the old one")` returns `{ ok: true, kind: 'mind_work' }`. `refusedRequest("Delete that post")` returns true, so the gap is in the Phase D gate. This is pinned as a known gap in the freeze so it stays visible. If the gate is fixed, that test must be flipped. The owner decides (GO_LIVE owner decision B).
2. **1–2 sentence product lines are not enforced in code.** No sentence or length limit was found for product lines. Adding one would change what the owner can type, so it is not a tiny fix. It is an owner copy rule and is not pinned.
3. **Daily run is owner-started.** The 08:00 pipeline is in code. The `minds_daily_run` cron line is a comment. The run starts when the owner says "run today" or presses Run (owner decision A). The `daily` trigger branch in `runDay.ts` is not reachable from code.
4. **Saved Video look is not read by the daily video or pack yet.** Pack video keeps its built-in look (owner decision D).

## Go-live leftovers

Only the steps in `GO_LIVE.md`. The agent does not do steps 2–4, and does not do steps 5–10 either.

1. Review this branch against `main`
2. Merge, when you say so
3. Apply the unapplied migrations, in filename order (38 files, listed in `GO_LIVE.md`)
4. Deploy the edge functions (20 functions)
5. Keys: paste them only in the app
6. Register your phone for push
7. Connect only the doors you actually have
8. Open Buddy and read the briefing
9. Flipboard, Google News, Microsoft Start and SmartNews
10. Takeover stays off until you are ready

Owner decisions A–F and the eyes-only checks are in `GO_LIVE.md`.

## Verification (final tree, after the last change)

| Check | Result |
|---|---|
| `npx vitest run` (full suite) | 170 files passed. 2293 tests passed, 6 skipped, 0 failed. Exit 0 |
| Freeze suites (`Freeze` in filename): A–E and F | 13 files, 355 tests passed. A–E: 12 files, 289 tests. F: `phaseFFreeze.test.ts`, 66 tests |
| `npx tsc --noEmit -p tsconfig.app.json` | exit 0 |
| `npx tsc --noEmit -p supabase/functions/tsconfig.json` | exit 0 |
| `npx eslint .` | 0 errors, 30 warnings, exit 0. None of the 30 are in files changed in Phase F |

Notes on the verification:
- The first full-suite run failed the app type-check. My new freeze file imported a `.mjs` file without types and pulled a Deno `npm:` import into the app build. I fixed that by reading those values from source. The final app type-check exits 0.
- The ESLint warnings are in pre-existing files (`AdminEditorKit.tsx`, `ui.tsx`, `AdminConnections.tsx`, and others). Phase F did not touch them.
- The scope against `main` is the whole arena branch (Phases A–F), not Phase F alone. `git diff --stat a128521 HEAD` shows 309 files. Nothing from that branch is on `main`.

**Nothing merged, deployed, or applied.**
