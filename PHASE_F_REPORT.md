# PHASE F report

Branch `arena/1d438dc4-lixxonstudio`. Base `main` at `a128521230ab11c197e7d23d035ad7f973b216a7` (read again at report time; unchanged).

**Code HEAD for the numbers in this report: `698907c`.** This report is one commit after it. Run `git log -1` for the report's own sha.

**Nothing merged, deployed, or applied.** No pull request is open. No migration has been applied to any database. No deploy has run. No key was pasted, logged, or written to a file. No live LLM, door, push, Telegram, YouTube, Graph, or Web Push call was made. Tests use fake fetch and fake send. Takeover default is `false` and was not turned on. There is no Phase G.

## Commits in Phase F

| Slice | Commit | What |
|---|---|---|
| 1 | `199078e` | `PHASE_F_INVENTORY.md`: the lock walk (50 rows) |
| 2 | `dfd88ee` | Buddy how-to covers every open door (16) and every brain (8). Config comment updated |
| 3 | `d57b10d` | Day-run log row labelled by outcome (`doorLogAction` in `rssHub.ts`) |
| 4 | `57a6e37` | Test fixture documented; silent test render kept; clocks confirmed in config and source. No cron applied |
| 5 | `fb9a796` | `GO_LIVE.md` (ten owner steps). Explicit `verify_jwt = true` for `minds-run-placement` and `door-connection-test` |
| 6 | `3b1263b` | First freeze file and first report draft (superseded by this report) |
| 6 re-audit | `587fae7` | Freeze made behavioural. Delete gate fixed. Held-order copy, README, comments corrected. `mindRun.ts` removed. Inventory re-audit rows R1–R15 |
| 6 GO_LIVE | `698907c` | GO_LIVE checked against `config.toml`, routes and code. Corrections below |
| 6 report | this commit | `PHASE_F_REPORT.md` rewritten |

## What the first draft of this report got wrong

A second walk against the spec found these errors. All are fixed:

1. **"Delete the old one" was not refused.** The first draft called it a known gap. The never-list has no deletes, so it was a lock breach. Fixed in `supabase/functions/_shared/buddyOrderPolicy.ts`. "Delete / erase / trash" with no noun, or with "it", "that", "them", "the old one", is refused. The Phase E test that pinned the gap now expects the refusal.
2. **The 1–2 sentence product-line rule was called a gap. It is not.** `auditPlacement` in `productPlacement.ts` enforces it. The freeze now checks it by running the real function.
3. **`src/buddy/minds/mindRun.ts` was called "documented, not deleted".** It was an unwired client copy of the day run, used only by a test. Deleted. The four-mind order is tested in `src/__tests__/mindsWorkers.test.ts`.
4. **Owner-facing copy said channel posting "come[s] in a later phase".** Renamed `HELD_LATER_PHASE` → `HELD_NOT_FROM_CHAT` and reworded. The freeze fails on any owner-facing "later phase".
5. **A comment said "twelve auto doors" and that posting was not built** (`AdminConnections.tsx`). Corrected to sixteen doors, and to the true rule: the day run posts to a connected door only when Takeover is on.
6. **`src/buddy/README.md` had four stale lines.** `mindThink.ts` was "the one door to Gemini". The minds were "still Google only". The old distribution page was said to have WhatsApp, Facebook and Pinterest senders. The page was deleted in Phase C. Corrected.
7. **The lock count was 56 in one place.** It is 50 (B 22, M 12, A 4, D 7, V 5).
8. **GO_LIVE had five wrong places:** a "press Run in Minds" that does not exist (the run starts from Buddy, with Takeover on); page names that were not the real ones (see step 5); a `verify_jwt` note that said some functions use a default when all 20 have explicit entries; a claim about the push-claim migration that did not match its header; and `_types` missing from the list of non-function folders.
9. **The first draft listed a mutation check that had not been run,** and invented how-to and slice details. Both are removed. Only the checks below were run.

## Tiny fixes made in Phase F (complete list, from the commits)

- **Slice 2:** `HOWTO_DOORS` had ten doors. Telegram, Discord, Bluesky, Mastodon, Tumblr and Blogger were missing, so Buddy could not explain them. Added. The header now says "every open door". `supabase/config.toml` comment: the Buddy brain line now says "the brain chain (Gemini first, then the free brains)", not "Google Gemini". README lines corrected.
- **Slice 3:** the day-run log wrote "Posted to X" for failed and skipped rows. Now a sent row says "posted to"/"pinged", a failed row says "Could not post to"/"Could not ping", and a skipped row says "Skipped". `minds-run-placement/index.ts` uses `doorLogAction`.
- **Slice 4:** the test fixture is documented in `scripts/fixtures/README.md`. The comment in `scripts/render-video-test.mjs` explains the silent test render. The silent render is kept for tests only. Reader packs are never silent.
- **Slice 5:** explicit `verify_jwt = true` entries for `minds-run-placement` and `door-connection-test` (`supabase/config.toml`).
- **Re-audit (`587fae7`):** the delete gate (above); `HELD_NOT_FROM_CHAT` copy; `mindRun.ts` removed; `AdminConnections.tsx` comment; `src/buddy/README.md` lines; `phaseEFreeze.test.ts` delete finding flipped to a refusal, and its phase-boundary test reworded. `phaseFFreeze.test.ts`: 78 tests (the first freeze had 66).
- **GO_LIVE (`698907c`):** the corrections in the first-draft list, item 8.

No new feature, door, brain, order kind, or mind was added. Admin AI was not restored. No migration was applied.

## Inventory: each lock → pass

The 50 locks are in `PHASE_F_INVENTORY.md`. "Pass" means the test named here passes on `698907c`. Unless a file is named, the test is in `src/buddy/phaseFFreeze.test.ts`. The F tests are the 78 in that file. Other files are named in full.

### Buddy (B1–B22)

| # | Lock | Pinned by | Result |
|---|---|---|---|
| B1 | Only Buddy talks; no mind has a chat route | "only Buddy talks: no mind has a chat route or a chat box"; `buddyPhase3Freeze.test.ts` | pass |
| B2 | Asking about a mind → daily log, not a guess | "asking about a mind answers from the daily log, not a guess" | pass |
| B3 | Order → waiting / done / blocked lines | "order lines say waiting when Takeover is off, and nothing runs"; `phaseBFreeze.test.ts` ("every order line says waiting, done or blocked") | pass |
| B4 | Greeting + Continue | "greeting has Continue; new chat and past chats exist" | pass |
| B5 | Four looks: Noir Gold default, Ivory Silk, Velvet Opera, Porcelain | "four looks: Noir Gold default, Ivory Silk, Velvet Opera, Porcelain, in that order"; `phaseCFreeze.test.ts` | pass |
| B6 | Buddy look ignores magazine light/dark | "Buddy look ignores the magazine light and dark setting" | pass |
| B7 | Hear-Buddy exists, off unless the owner turns it on | "hear-Buddy exists and is off unless the owner turns it on" | pass |
| B8 | New chat + past chats | "greeting has Continue; new chat and past chats exist" | pass |
| B9 | Today's briefing is one thread; Night Reports separate | "today is one briefing thread; night reports are a separate path"; `phase7Freeze.test.ts`; `phase9Freeze.test.ts` | pass |
| B10 | Many sections, not one blob | "briefing has many sections, not one blob"; `phase8Freeze.test.ts` ("the briefing keeps its seven sections") | pass |
| B11 | Quiet only when every source was read and empty | "briefing is quiet only when every source was read and empty"; "the briefing reader passes every source…" | pass |
| B12 | Notable kinds = `BRIEFING_NOTABLE_KINDS`, including `door_failed` | "notable kinds are exactly the briefing list, and include door_failed"; `phase9Freeze.test.ts` ("a door_failed notable shows its sentence under Problems, not under What went out") | pass |
| B13 | Count-only: messages, comments, refunds, carts; never name, email or body | "messages, comments waiting, refunds and carts are counts only…"; `phaseDFreeze.test.ts` | pass |
| B14 | A "next move" line; "There is a message for you" | "a next-move line and 'There is a message for you' exist in the briefing" | pass |
| B15 | Chief-of-staff text: Takeover off = nothing changes; on = allowed work, said | "chief of staff: Takeover off means nothing changes…" | pass |
| B16 | Show-the-paragraph path; owner writes; Buddy does not rewrite | "show-the-paragraph path exists…"; `buddyPhase3Freeze.test.ts` | pass |
| B17 | Buddy never replies to readers | "Buddy never replies to readers; the refusal line names the never-list"; `phase9Freeze.test.ts` | pass |
| B18 | Never-list: no reader reply, no spend, no create, no full rewrite | "refuses the never-list requests in plain words"; `phase8Freeze.test.ts` | pass |
| B19 | Closed five order kinds; `REFUSAL_LINE`; questions not refused; delete refused | "the closed five order kinds, and nothing else"; "a question is answered as a question"; "'Delete the old one' and 'Erase it' are refused…"; `phaseBFreeze.test.ts` | pass |
| B20 | Unnamed swap → Executioner; named mind respected; Takeover off → wait | "an unnamed swap is filed for the Executioner…"; "with Takeover off, a mind kill or start is waiting…"; `phaseEFreeze.test.ts` | pass |
| B21 | Phone buzz kinds = briefing kinds + `job_finished`; url `/buddy`; missing VAPID = skip | "phone buzz kinds = briefing kinds plus job_finished"; "the push link goes to /buddy"; "missing VAPID is a skip…" | pass |
| B22 | Server flush so a closed Minds tab cannot drop a buzz | "the server flush exists, so a closed Minds tab cannot drop a buzz"; `phaseEFreeze.test.ts` | pass |

### Minds and Admin (M1–M12)

| # | Lock | Pinned by | Result |
|---|---|---|---|
| M1 | Five minds; Buddy is the sixth card and the only voice | "keys are analyst, strategist, ceo, executioner, auditor; Buddy is the sixth card…"; `phaseCFreeze.test.ts` | pass |
| M2 | Analyst: week vs week; floor so 0→1 is not a spike; cannot-see | "Analyst: week vs week, a floor so 0 to 1 is never a spike…"; `phaseBFreeze.test.ts` | pass |
| M3 | Strategist suggests, never publishes | "Strategist suggests and never publishes; CEO sorts waiting work"; `buddyPhase3Freeze.test.ts` | pass |
| M4 | CEO sorts waiting work | "Strategist suggests and never publishes; CEO sorts waiting work" | pass |
| M5 | Executioner packs and sends free doors only; nothing while Takeover is off; never the four hand doors | "Executioner packs and sends free doors only; nothing while Takeover is off; never the four hand doors" | pass |
| M6 | Auditor checks first; no other mind can switch it off; Buddy refuses "turn off the Auditor" | "Auditor checks before a change; no other mind can switch it off…"; `phase8Freeze.test.ts` | pass |
| M7 | Takeover default false; honest copy; Kill none / all / one | "Takeover default is false in the schema"; "kill options are none, all, and each of the five minds, and nothing else" | pass |
| M8 | No `AdminAI.tsx`; no 22-tab tower; Distribution → Minds; Video look is a small screen | "there is no AdminAI.tsx…"; "Distribution address goes to Minds"; "Video look is a small screen…" | pass |
| M9 | Daily log table and writer exist | "the daily log table and writer exist; the writer is the run path" | pass |
| M10 | Living minds use the brain chain; retry same day after failure; not if `done` | "living Analyst, Strategist and CEO are the three living minds"; "a living mind with a done row today is not run again"; "the minds and Buddy's probe walk the brain chain (askBrains)…" | pass |
| M11 | Advisor stays CMS health, not a mind | "Advisor stays CMS health, not a mind; Social Shares stay a read-only count with no send" | pass |
| M12 | Social Shares stay counts, no send | same test as M11 | pass |

### Articles, shop, money, voice (A1–A4)

| # | Lock | Pinned by | Result |
|---|---|---|---|
| A1 | Owner writes; cap three products; 1–2 sentence lines; drip old; digital first; no auto-create | "a pack carries at most three products"; "a product line is one or two sentences…"; "digital products lead the placement (digital first)"; "the owner writes articles: the placement never creates a product" | pass |
| A2 | USD; no Naira on reader copy; no Nigeria, Lagos or WAT on screen; clock stays Africa/Lagos in code | "USD: NGN is hidden from display…"; "no Nigeria, Lagos, WAT or Naira on any screen string…"; "the clock stays Africa/Lagos in code…" | pass |
| A3 | Top countries US, UK, CA, AU, IE, NZ, SG | "top countries for pack times are US, UK, CA, AU, IE, NZ, SG" | pass |
| A4 | $0; no paid brain; Cerebras and DeepSeek skipped | "$0: no paid brain is tried; Cerebras and DeepSeek are skipped"; `phaseAFreeze.test.ts` | pass |

### Doors (D1–D7)

| # | Lock | Pinned by | Result |
|---|---|---|---|
| D1 | Gated four: Instagram, TikTok, Facebook, Pinterest; caption, time, image, video, link; Buddy never presses Post; "I posted this" | "the gated four are not auto doors…"; "the gated pack carries caption, time, image, video and link, and Buddy never presses Post"; `buddyPhase4Freeze.test.ts` | pass |
| D2 | Auto 16, exact list, all open | "the 16 auto doors are exactly these, all open" | pass |
| D3 | RSS four: ping the hub; honest skip; no fake login | "the RSS four are ping-hub doors with no login field…"; `phase8Freeze.test.ts`; `src/__tests__/rssDoors.test.ts` | pass |
| D4 | Skip when media missing: YouTube/Vimeo video, podcast audio, Pixelfed image | "skip when required media is missing…"; `phase6Freeze.test.ts`; `phase7Freeze.test.ts` | pass |
| D5 | Connections: door details; secrets never echoed; test does not publish | "connections show door details and a status with no saved value in it"; "the connection test does not publish: its only POSTs are a sign-in and a token refresh"; `phaseAFreeze.test.ts` | pass |
| D6 | How-to: each open door and each brain; a skipped brain says so | "the how-to covers every open door, and every brain…"; `src/__tests__/buddyHowTo.test.ts` | pass |
| D7 | No WhatsApp, Feedly, X or 21st door | "no WhatsApp, Feedly, X or 21st door in the door registry, the posting code, or the how-to" | pass |

### Video, night, brains (V1–V5)

| # | Lock | Pinned by | Result |
|---|---|---|---|
| V1 | Pack 1080×1920; captions; audio (no `-an`); espeak fallback | "the pack is 1080 x 1920, with captions and a voice track"; "packs are never silent…"; "voice falls back to a local espeak"; `buddyPhase4Freeze.test.ts` | pass |
| V2 | Night writer and night clock in `config.toml`; night is not morning | "night writer and night clock are in config.toml, and night is not morning" | pass |
| V3 | Eight slots, try six, skip two, Gemini first; probe = `askBrains`; status = any tryable; 429 → next | "eight slots: try six, skip two, Gemini first"; "the probe is askBrains, and status counts any tryable brain"; 429 → next: `phaseAFreeze.test.ts` ("429 from Gemini: the next saved key (Groq) answers") | pass |
| V4 | No GitHub, Bytez or Mistral workhorse | "no GitHub, Bytez or Mistral workhorse brain" | pass |
| V5 | 08:00 Lagos clock in code; scheduler in config; minds cron stays a comment | "the 08:00 Lagos daily clock is in code…"; "the minds daily-run cron line stays a comment…" | pass |

## Mutation check

Run once, in slice 6. `PLACEMENT_MAX_SENTENCES` changed from 2 to 3 in `productPlacement.ts`. The freeze failed, as it should. The file was restored with `git checkout`. No other mutation was run. The freeze is a set of tests and checks, not proof of every rule.

## Code leftovers

Two items remain. Both are kept on purpose. Neither is an unfinished feature.

1. **`src/lib/automationDistribution.ts`: WhatsApp share helper entries.** These are link-builder entries in the video-template library. They are not a door, no screen shows them, and only a test uses them. The owner decided in Phase E to keep the library. Removing the entries would change the library, which the owner has not asked for.
2. **`supabase/functions/automation-distribution/`: a legacy function that still deploys.** Checked against the lock. No WhatsApp send. Facebook and Pinterest have no send path (`check` is read-only). `send_telegram` is owner-started. `test_newsletter` emails only the owner's confirmed address. It is listed in GO_LIVE step 4. Removing a deployed function is an owner deploy decision.

## Go-live leftovers

Only the steps in `GO_LIVE.md`. The agent does not do steps 2–4, and does not do steps 5–10 either. Open decisions A–F and the eyes-only checks are in `GO_LIVE.md` and are not repeated here.

1. Review this branch against `main`.
2. Merge, when you say so.
3. Apply the unapplied migrations, in filename order. The repository marks 38 files as not applied, and 65 earlier files need a check on production. `supabase migration list` shows which are applied.
4. Deploy the 20 edge functions. Each has an explicit `verify_jwt` entry in `supabase/config.toml`, and GO_LIVE's table matches it.
5. Keys: paste them only in the app, on Automation keys, Brains, or Connections.
6. Register your phone for push, from `/admin/settings`, after saving the VAPID values on Automation keys.
7. Connect only the doors you actually have, on Connections. A door is connected only when every field is saved. Test checks the connection and publishes nothing.
8. Open `/buddy`, press Continue, and read the briefing.
9. Flipboard, Google News, Microsoft Start and SmartNews: give the hub your `/rss.xml`. Any submit step is yours.
10. Takeover stays off until you are ready. Turn it on in Minds.

## Verification (on `698907c`)

| Check | Result |
|---|---|
| `npx vitest run` (full suite) | 170 files passed. 2305 tests passed, 6 skipped, 0 failed (2311 total). Exit 0 |
| `npx vitest run Freeze` (freeze suites, A–F) | 13 files passed. 367 tests passed. Of these, `phaseFFreeze.test.ts` has 78 and the rest are A–E |
| `npx tsc --noEmit -p tsconfig.app.json` | exit 0 |
| `npx tsc --noEmit -p supabase/functions/tsconfig.json` | exit 0 |
| `npx eslint .` | 0 errors, 30 warnings, exit 0 |

On the 30 ESLint warnings: none is an error. Three are in `src/admin/pages/AdminConnections.tsx` ("fast refresh only works when a file only exports components"). That file was added on this branch, not inherited from `main`. The fix would be to move its exported constants into a separate file. That is a refactor, so it is named here and not done.

The full diff from `main` is 321 files. That covers all of Phases A–F on this branch, not Phase F alone.

**Nothing merged, deployed, or applied.**
