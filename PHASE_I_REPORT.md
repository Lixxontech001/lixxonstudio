# PHASE I report

Branch `arena/13aab908-lixxonstudio`. Base `main` at `1142b566b243af70721240e388b21ed66f0bf8ad` (the PR #45 merge). `main` was fetched again before this report and has not moved. Every commit below is on the session branch only; the branch is 14 ahead of `main` with the freeze and this report.

**I SOLID.** Every Phase I rule is in the tree with a test, Pass A proves the ten things the spec names on its own, Pass B found and fixed the two gaps it turned up and Pass A was re-run green afterwards, and Pass C re-read the spec against the source. Nothing is half done.

**Nothing merged, deployed, or applied.** No pull request is open. No migration has been applied to any database: the four Phase I migration files exist and are **not applied**. No deploy has run; the deploy workflow only runs from `main` and was not triggered. No key was pasted, logged, or written to a file. No live LLM, door, push, article, product or payment call was made; tests use fixtures, fake ports and fake HTTP. Takeover default is `false` and was not turned on. The four gated channels (Instagram, TikTok, Facebook, Pinterest) stay posted by hand and are not doors; the sixteen free doors are unchanged. All money is USD. No country, city, timezone or local-currency name is shown on any screen. **The cron file was not applied: the 08:00 clock exists as a file only.**

## Commits in Phase I

| Slice | Commit | What | Tests |
|---|---|---|---|
| 1 | `921ac34` | The 08:00 morning clock, on only when Takeover is On: `_shared/morningClock.ts`, the `minds-morning-clock` function, and the cron migration file (not applied) | `mindsMorningClock.test.ts`, `internalCall.test.ts` |
| 2 | `cc66633` | The morning pipeline: Analyst → Strategist → CEO → Executioner through `_shared/mindPipeline.ts` and `_shared/internalCall.ts`, the Auditor before every live change, one allowed fix after a block | `mindPipeline.test.ts`, `auditorOneFix.test.ts`, `livingMindRetry.test.ts`, `doorWiring.test.ts`, `rssDoors.test.ts` |
| 3 | `56e4bef` | Every act told four ways: one log row, one notable (which buzzes), one briefing line, one night line (`_shared/mindActs.ts`), and the push-skip line that never claims a send | `mindActs.test.ts`, `notablePushWiring.test.ts`, `notableSources.test.ts`, `notableSourcesWiring.test.ts` |
| 4 | `264d309`, `f0ab5d6` | Memory (facts + last telling + this chat, and a spike already told is Quiet), the four captions drafted in chat (saved to a pack only while Takeover is On, four stay four), and a product that looks dead (no paid order this week and the seven days before, never day one, never deleted) | `mindMemory.test.ts`, `chatCaptions.test.ts`, `deadProducts.test.ts`, `buddyBriefingSlice2.test.ts` |
| 5 | `926fef9` | The archive drip to the sixteen auto doors (three a day, stamped before the send), the rival pages the owner saves in his own words (public https only, ten read a day, an honest change line or nothing), and one US dollar price change a day with the Auditor first | `competitors.test.ts`, `priceChanges.test.ts`, `priceRun.test.ts`, `slice5Wiring.test.ts`, `doorPosts`/`runDoors` drip cases, `scripts/minds-autonomy-assertions.sql` |
| 6 | this commit | `src/buddy/phaseIFreeze.test.ts` (Pass A, Pass B regressions, Pass C) and this report | the freeze itself |

## Pass A — the ten proofs the spec asks for

All ten run in `src/buddy/phaseIFreeze.test.ts` (43 tests) through the real functions with fake ports: no network, no live brain, no live door, no live push, no database, no migration applied.

| # | What the spec asks | How it is proved |
|---|---|---|
| 1 | Takeover Off → no door post, no price write, no pack save from the run | `runDoors`, `runPriceChange` and `runDayPacks` each return the gate's own line with **zero port calls**; the same for a Kill switch on strategist/executioner/auditor/all; `runDay` queues nothing and runs nothing; the owner-run entry point re-reads the gate and returns before the door, rival, price and pack steps |
| 2 | Takeover On → the scheduler would run | `morningRunDayDue` is 08:00–12:00 on the owner's day (07:00 UTC) and null outside it; a due tick with Takeover on queues the day and starts the pipeline; the same tick with Takeover off queues nothing and starts nothing; a tick outside the window reads nothing |
| 3 | An unnamed order still gets no "which mind" | every unnamed order form routes to a mind with `resolvesPending: false`; the phrase "which mind" appears in the chat path only inside the instruction that forbids it, and never as a question to the owner |
| 4 | The Auditor is asked before every live change | a blocked price never calls the apply port and comes back as `auditor_blocked` after exactly one repair ask; `auditPriceChange(` precedes `ports.apply(` on the page; the database door re-checks the gate itself before it writes, and the drip stamps only after `minds_assert_can_act()` |
| 5 | The notify helper runs on a price change and on a door post | `reportAct` writes the log row first and the notable second with the same detail, for `price_changed`, `door_posted` (including "from the archive") and `door_skipped`; a phone that cannot be reached leaves the log row written and reports `noticed: false`; every act kind buzzes; the run reports each act through the helper |
| 6 | The competitor fetch cap is ten | the plan takes ten, oldest read first, never a page read today; a run with twelve saved pages fetches and records exactly ten; Takeover off or a Kill fetches nothing; the table's own trigger refuses an eleventh page |
| 7 | No product is inserted by a mind | no mind-side file writes the shop; the run reads and prices only; the price migration updates and never inserts a product; an order to create one waits with "Creating a product is your job." |
| 8 | The four gated channels are not auto-sent | they are not doors at all (`isOpenDoor('instagram')` is false, 16 doors of 16); the door step only ever touches an open door; no gated channel host appears in the run |
| 9 | Spend never | a spend or ads order waits with `HELD_MONEY`; the never-list says Buddy does not spend; no mind-side file can reach a payment or ads provider |
| 10 | The cron/migration file exists and was not applied | `20261021000000_minds_morning_clock.sql` exists with the fifteen-minute schedule and the function it calls, says "NOT APPLIED to production", grants nothing to `anon` or `authenticated`; the three slice-5 migrations say the same; CI has no `db push`; the deploy workflow runs from `main` only and `arena/**` is not in it |

## Pass B — what verifying found, and the fix

Loop 1 was the only loop needed (three were allowed). Both findings were in the rival step, and both were about telling the truth when a read fails:

1. **An unreadable "read today" was treated as "nothing read today."** The step would have read pages that may already have been read that morning instead of saying it could not check. Fixed: the step now stops with `failed` and the line "The pages already read today could not be read, so no page was read this run. Nothing is claimed about any of them." — nothing guessed, nothing double-counted.
2. **A day where no rival page could be read was silent.** The step built its reasons but the run dropped them, so the owner learned nothing about a rival step that had tried and failed. Fixed: a day the step really ran now always writes its row — `done` when pages were read, `skipped` with the step's own reasons when none could be. Takeover off still writes nothing.

Both are pinned in the freeze (`Pass B` cases in the cap group) and Pass A was re-run green: 43/43.

## Pass C — the spec read against the source

- **No silent act.** Every act kind the run writes goes through `reportAct` or `recordNotable`; the six act kinds each write a log row and a notable, and all six are in the buzz list. A door that does not go out is told per door with its own reason; a pack that is blocked is told as blocked; an Auditor block is told with the fix and the stop.
- **No "which mind".** The question and its route are gone from Phase H; the freeze re-checks that no owner-facing line asks it, in the chat path and in the run's copy.
- **No product created by a mind.** `HELD_CREATE`, the never-list, and the price migration's `UPDATE`-only rule are pinned; `deadProducts.ts` cannot delete or write.
- **No spend.** The money lane holds spend and ads; the never-list says so; no payment or ads provider is reachable from any mind-side file.
- **Also re-read:** there is no WhatsApp door; the door connection tests only read and say "Nothing was posted."; the only writer of the Takeover row is the owner's own controls store through its owner-only policy; the owner still writes the articles and makes the products.

## Gates (run on the tree for this report)

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` | exit 0. **193 files, 2,745 tests passed, 7 skipped** (104 s) |
| Freeze files | `npx vitest run` over the 16 `*Freeze*` files | exit 0. 16 files, 463 tests passed (Phase I freeze: 43) |
| Typecheck, app | `npx tsc --noEmit -p tsconfig.app.json` | exit 0 |
| Typecheck, functions | `npx tsc --noEmit -p supabase/functions/tsconfig.json` | exit 0 |
| Typecheck, api | `npx tsc --noEmit -p api/tsconfig.json` | exit 0 |
| Lint, whole repo | `npm run lint` | exit 0. 0 errors, 30 warnings, all pre-existing |
| Build | `npm run build` | exit 0 |
| Bundle size budget | `node scripts/size-budget.mjs` | exit 0, every row within budget |
| Public asset budget | `node scripts/public-size-budget.mjs` | exit 0, every public file ≤ 250,000 bytes |
| Database harness | `python3 scripts/db-test.py` | exit 0. **109 migrations applied, assertions passed**, including `scripts/minds-autonomy-assertions.sql` |
| CI | GitHub Actions `CI` on `926fef9` | success (build job: audit, tsc ×3, lint, tests, build, both budgets, the database job) |

The database harness applies migrations to a throwaway local Postgres in `~/.cache/lixxon-pgtest` only. That is not production, and nothing in CI or the deploy workflow applies them anywhere else.

## What two weeks of Takeover On would actually do

Each morning at 08:00 (and only then), with Takeover on and no Kill: the day's run is queued, the Analyst, Strategist and CEO think from the facts, the memory and the owner's chat, the Executioner makes the day's packs, the free doors get one article each (or an older one, three a day, when nothing new was published), up to ten saved rival pages are read and any real change is told, and at most one US dollar price may move. It **tries** to make a morning company; it does not promise thousands of orders, and every act it takes is told four ways. The owner still writes the articles and makes the products.

## Known gaps and open risks

1. **An owner's price ask in the chat is filed and held, never run from the chat.** The lane holds it with the real rule, and the day's run is where a price may change. The owner re-asks nothing; the waiting list keeps it with its reason.
2. **Rival reads depend on the page being fetchable.** A page that cannot be reached is not recorded, so it is tried again on a later run that day; a whole day of failures is now told as a skip with the reasons.
3. **The competitor list has no Admin screen.** The owner sees and saves the pages in the chat, and a change is told through the briefing and the night report. A read-only screen would be the next tidy-up, not a Phase I rule.
4. **The drip's three-a-day cap is shared** with the placement step, by design: it is the same `post_drip_days` rule, so a morning that places products on three articles leaves no drip budget that day.
5. **Left from Phase H, unchanged:** the Check screen's DB-written `detail`/`fix`, the old "Admin Panel Guide" block on `AdminSettings.tsx`, the Flutterwave split (live `FLW_SECRET_KEY`/`FLW_WEBHOOK_HASH` vs the test-only `flutterwave_secret_key`), and the `css` budget sitting exactly on its tolerance edge (15.95 kB of 15.95 kB) — Phase I added no CSS.
