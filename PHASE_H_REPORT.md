# PHASE H report

Branch `arena/13aab908-lixxonstudio`. Base `main` at `1142b566b243af70721240e388b21ed66f0bf8ad` (the PR #45 merge). `main` was fetched again before this report and has not moved.

**H SOLID.** Every Phase H rule is in the tree with a test, the freeze passes on its own, and nothing is half done.

**Code HEAD for the gate numbers below: `dd7a670`, plus the freeze test and this report.** This report is the commit after it. Run `git log -1` for the report's own sha.

**Nothing merged, deployed, or applied.** No pull request is open. No migration has been applied to any database. `supabase/migrations/20261020000000_retire_dead_keys.sql` exists and is **not applied**. No deploy has run. No key was pasted, logged, or written to a file. No live LLM, door, push, Telegram, YouTube, Resend or Flutterwave call was made. Tests use fixtures, fake HTTP and fake send. Takeover default is `false` and was not turned on. No brain, door or order kind was added. The four gated channels (Instagram, TikTok, Facebook, Pinterest) stay posted by hand; the sixteen free doors are unchanged. All money is USD. No country, city, timezone or local-currency name is shown on any screen.

## Commits in Phase H

| Slice | Commit | What | Test |
|---|---|---|---|
| 1 | `20b66cf` | The Guide page at `/admin/guide`, one section per owner action with an anchor each, and the in-place line "Don't get it? Open the guide" on Brains, Keys and Connections. Back returns to the page and the field the owner came from | `guide.test.ts`, `guidePage.test.tsx`, `guideInPlace.test.tsx` |
| 2 | `34f9812` | The same line on Minds (Takeover, Kill), Video look, packs, "I posted this", the empty Buddy chat and the article product slots. The steps load only when the guide opens | `guideInPlace.test.tsx`, `guidePage.test.tsx` |
| 3 | `bef14ec` | Keys cleaned: OpenAI, Anthropic and the dead social rows are not offered, and the 21 names are refused by one list (`notOfferedKeys.ts`). A Saved key is never asked for again; saving over one says the old key is gone, and an empty save does nothing. The phone-alert line names Keys, the phone and Register this device | `keysCleaned.test.tsx`, `automationKeys*.test.*` |
| 4 | `94927b6` | Jargon off Admin: no Vault, RPC, OAuth, PostgreSQL, JWT, RLS, seq_scan, "Automation keys", "System Check", "AI providers" or "Editorial CMS". Nav labels are Keys, Check and Data. The Check screen keeps a plain label for every check the database can raise | `adminPlainEnglish.test.ts` |
| 5 | `134ff85` | Buddy never asks which mind. Unnamed orders are placed by plain rules; two fits show a table; the question and its route are deleted | `buddyNoAskWhichMind.test.ts` and the rewritten pins |
| — | `dd7a670` | CI repair, not slice work: the embedded-Postgres harness still saved a retired key name, which had turned the database job red on slices 3 and 4 | `python3 scripts/db-test.py` |
| 6 | this commit | `src/buddy/phaseHFreeze.test.ts`, the Phase F "no Phase H" pin flipped, and this report | the freeze itself |

## What each part now does

1. **The guide.** One address, `/admin/guide`, one section per owner action, in plain English, with an anchor each (`#gemini`, `#vapid`, `#takeover`, `#minds`, `#kill`, `#video-look`, `#packs`, `#i-posted-this`, `#buddy-chat`, `#product-slots`, `#connections`, and one per door). Every section is `short` (the one or two sentences shown beside the action), a title, and numbered steps. `guideGroups()` builds a section for every anchor, so a missing one fails the freeze. The steps live in a separate module that only loads when the guide opens (`admin-guide` is its own lazy chunk, 2.44 kB against an 8.00 kB limit). Back returns to `/admin/...` or `/buddy` only, taken from `?back=`, with a safe-path check; anything crafted falls back to Keys. The Gemini line is the owner's own wording, kept word for word: "Get a free key at aistudio.google.com. Paste once. It is never shown again. Test does not publish."
2. **In-place help everywhere it belongs.** Brains (one line per brain, from the same slot data), Keys (the page, the phone-alert pair, Save, Test, Delete), Connections (the page and each door), Minds (the page, Takeover, Kill), Video look, packs and "I posted this" in Buddy's Changes screen, the empty Buddy chat, and the article product slots (help only; no editor was added).
3. **Keys are honest.** The Keys page cannot show or accept a retired name: `NOT_OFFERED_KEY_NAMES` (21 names: WhatsApp 2, the dead thinking keys 3, the social rows 16) is read by the page, the list parser and the function. A row that is already Saved says it cannot be shown and does not need to be typed again; replacing one says "This replaces the key that is there. The old one is gone." behind a confirm; an empty box does nothing at all. Nothing is read from the hosting environment into the browser, and the free Discord, Telegram and podcast rows with a real job are kept. The phone alerts say: make the keys on Keys, open `/admin/settings` on the phone, then tap Register this device.
4. **Admin is plain.** Nav labels: Keys, Check, Data. The Data page's default query is now about articles, not table statistics. The Check screen maps all 30 check names the database can raise to plain labels, so an unmapped check cannot print a database sentence. Backups, Settings, Team & access, Run monitor and the payment steps no longer name the host, the environment file or the project settings.
5. **Buddy never asks which mind.** Rules, tried in order: numbers, figures, statistics, sales, revenue, views, reads, traffic, trends, counts, scores, a report, or any week or month → Analyst. Strategy, plans, positioning, competitors, rivals, dead products, "what to stop", "where to play" → Strategist. Sort, re-order, priority, rank, first, next up, triage → CEO. Packs, doors, captions, thumbnails, clips, videos, "run today", "today's run", product lines, "place the product", "post the pack" → Executioner. Check, audit, verify, review, inspect, confirm, prove, safety, mistakes, errors, broken → Auditor. The first fit takes the order; two fits show a small table of both minds and what each would do, and the table never asks a question. An order that fits no rule goes to the Executioner, the doer, so an order is never left without a mind (`DEFAULT_MIND`). A question stays a question ("How are sales?" → chat, answered from the real log when it names a mind). "run today" is the day run, not an order. A swap with no mind still goes to the Executioner. The never-list (reader replies, spending, shop products, whole rewrites) is refused with one line and nothing filed. An order left waiting by an older message still resolves when the owner names a mind. The question and its route (`ASK_WHICH_MIND_LINE`, `ask_which_mind`) are deleted, the answer rules forbid asking, and every rule verb also starts an order (the rule lists and the imperative regex were kept in step).
6. **This freeze.** `src/buddy/phaseHFreeze.test.ts` has one group per slice: the guide anchors, sections, links and Back; the Keys page and the retired names; the Admin nav and the engine-word scan over the text Admin shows; the routing table, the two-fit table, the questions, the day run, the swap and the never-list; Takeover off, sixteen doors, no WhatsApp, eight brains with Cerebras and DeepSeek skipped; and the report and freeze files. The Phase F pin that said "there is no Phase H" is flipped on purpose.

## Gates (run on the tree for this report)

Run in `/home/user/lixxonstudio`. The numbers come from the commands' own output and exit codes.

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` with `LIXXON_FFMPEG` set to a local ffmpeg | exit 0. 180 files, 2,486 tests passed, 0 skipped (109 s). The pack video ran its real render |
| Typecheck, app | `npx tsc --noEmit -p tsconfig.app.json` | exit 0 |
| Typecheck, functions | `npx tsc --noEmit -p supabase/functions/tsconfig.json` | exit 0 |
| Typecheck, api | `npx tsc --noEmit -p api/tsconfig.json` | exit 0 |
| Typecheck, node | `npx tsc --noEmit -p tsconfig.node.json` | exit 0 |
| Lint, whole repo | `npm run lint` | exit 0. 0 errors, 30 warnings, all pre-existing. Lint over the 54 Phase H files: 0 errors, 8 warnings, all in code Phase H did not change (`AdminAccess.tsx`, `AdminConnections.tsx` x3, `AdminDataExplorer.tsx` x2, `NavigationContext.tsx` x2) |
| Build | `npx vite build` | exit 0 |
| Size budget | `node scripts/size-budget.mjs` | exit 0 (every row inside the 5% tolerance; see below) |
| Public asset budget | `node scripts/public-size-budget.mjs` | exit 0 |
| Database harness | `python3 scripts/db-test.py` | exit 0. 104 migrations applied, assertions passed |
| Heroku-style CI | GitHub Actions `CI` on `dd7a670` | success (build job, including the database job that slices 3 and 4 failed) |

The ffmpeg used for the local fixture tests is `imageio-ffmpeg`'s binary in `/tmp/ffvenv`, outside the repository, and is used only for test fixtures. No production ffmpeg was called.

### Size budget detail

`node scripts/size-budget.mjs` prints `over` for a row that grew past its recorded baseline but is still inside the 5% tolerance, and `FAIL` only past the limit. At this HEAD: `total-js` 250.02 kB against a limit of 255.35 kB; `admin-pages` and `admin-total-js` 117.94 kB against 119.50 kB; `supabase` 55.61 kB; `react-vendor` 44.03 kB; `icons` 10.45 kB against 10.70 kB; `entry` 28.41 kB; `article-reader` 19.84 kB; the lazy admin ceilings all pass (`video-look` 2.68 kB of 4.00 kB, `automation-runs` 8.50 kB of 9.00 kB, `automation-check` 2.79 kB of 4.00 kB, `admin-guide` 2.44 kB of 8.00 kB, `BuddyEntry` 2.82 kB of 3.00 kB). **`css` and `total-css` are 15.95 kB against a limit of 15.95 kB: they sit exactly on the tolerance edge.** No CSS was added in Phase H (the copy edits removed a `<code>` element), but the next phase must not add an Admin utility class without checking this row.

### Secret scan

A prefix scan over tracked files lists file names only and prints no matched text. `AIza`, `sk-` and `re_` matched nothing at all. `FLWSECK` matched `.env.example` and `src/admin/pages/AdminSettings.tsx`; both are placeholders (`FLWSECK_TEST-your-secret-key-here`) and both lines exist on `main`. `eyJ` matched `package-lock.json` (one 30-character base64 blob, not a token) and `src/__tests__/supabaseEnv.test.ts` (four fixtures, 36 to 54 characters, where a real signed token is far longer; also on `main`). No live credential was found and no credential-shaped string was added in Phase H.

## Known gaps and open risks

- **The Check screen's database-written text is still engine talk.** The screen maps all 30 check names to plain labels, but the `detail` and `fix` sentences come from `admin_health_set` in `20261004202000_admin_ops_tools.sql` and still say things like "sequential scans", "dead tuples" and "Supabase SQL editor". A replacement migration would have to re-create the check function, because the text is rewritten on every check run. **No such migration was written**, so nothing exists that could be applied by accident. Owner decision.
- **Flutterwave has two homes.** Live payment verification reads `FLW_SECRET_KEY` and `FLW_WEBHOOK_HASH` from the function environment, while the Keys page offers a `flutterwave_secret_key` row that only its Test button uses. Either payments should read the saved key (a function change on a money path) or that row should say it is test-only. Nothing was changed; the Admin settings steps and the Keys row were left as they are. Owner decision.
- **The Admin settings page still carries the old "Admin Panel Guide" block.** It duplicates the new Guide page. Removing it is a copy decision, not a jargon one, so it was left.
- **The retired-keys migration is not applied.** The site hides the 21 names with or without it (`notOfferedKeys.ts`). Any Vault values the owner already saved for them are still there and are not deleted by anything in this branch.
- **Visible copy was checked by tests, not in a browser.** No preview server was run; the screens were not seen rendered. The checks are source-level (JSX text and string literals) plus the jsdom mounts in the guide, Keys and Health tests.
- **Pins changed on purpose.** `phaseEFreeze.test.ts` had an "open decision: a non-swap unnamed order still asks which mind" pin; slice 5 closed the decision and the pin now says so. `phaseFFreeze.test.ts` had "there is no Phase H"; slice 6 flips it. `phase8Freeze.test.ts` had one assertion that relied on the router leaving a shop-product request unfiled; it now checks the handler's never-list instead. No other pin was touched.
- **Budget edge.** See the size budget detail above: `css` is on its limit.

## Leftover

Phase I is the only work left after H: the 08:00 clock, the mind pipeline, notify-every-act, prices, the competitor fetch and two-week autonomy. Nothing else from the Phase H spec is open. The three owner decisions above (Check text, Flutterwave key home, the Settings guide block) are the only non-Phase-I items.
