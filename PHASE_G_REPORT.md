# PHASE G report

Branch `arena/1d438dc4-lixxonstudio`. Base `main` at `a128521230ab11c197e7d23d035ad7f973b216a7`. `main` was checked before the first slice and again before this report. It has not moved.

**Code HEAD for the gate numbers below: `45a985e` plus the freeze test and this report.** This report is the commit after it. Run `git log -1` for the report's own sha.

**Nothing merged, deployed, or applied.** No pull request is open. No migration has been applied to any database. `supabase/migrations/20261006310000_video_templates.sql` exists and is not applied. No deploy has run. No key was pasted, logged, or written to a file. No live LLM, door, push, Telegram, YouTube, Graph, Web Push, or voice-service call was made. Tests use fixtures, fake fetch, and fake send. Takeover default is `false` and was not turned on. No brain, door, or order kind was added. Admin AI was not restored. The `automation-distribution` function was not deleted.

## Commits in Phase G

| Slice | Commit | What |
|---|---|---|
| 1 | `96f2dea` | Pack video reads the saved Video look. Three values only: length, caption size, caption colour. The pack keeps its audio. Test: `src/__tests__/packVideoLook.test.ts` |
| 2 | `5460f56` | No WhatsApp in the leftover video-template library copy (`src/lib/automationDistribution.ts`) |
| 3 | `a64e057` | Admin copy, part 1: nav labels Keys, Check, Data; Keys, Check, Brains, Runs, Backups and VAPID screens in plain English |
| 4 | `a958a60` | Admin copy, part 2: Health, article editor, Data explorer, Check and Runs text; Check copy in `src/lib/automationHealth.ts` |
| 5 | `45a985e` | VAPID button in plain English. Lazy Buddy stylesheet gets its own ceiling (see Budget) |
| 6 | this commit | `src/buddy/phaseGFreeze.test.ts`, the Phase F "no Phase G" pin flipped, and this report |

**Scope note.** My working notes kept the full wording of slices 1–4 and the Phase G rules, but not the full wording of slices 5 and 6. For those two I used the Phase G rules as the scope: the budget and copy fixes in slice 5, and the freeze and report in slice 6. If the original slice list differs, this report needs correcting.

## What each rule now does

1. **Pack video keeps audio and reads the saved look.** `resolvePackLook(null)` gives the defaults: 10 s, caption 64, colour `0xFFFFFF`. The saved look overrides only length, caption size and colour. It is read from the single `video_templates` row where `is_active = true` by `loadActiveLook` in `scripts/save-pack-media.mjs`. The renderer never calls the database. A pack with no voice is refused (`buildFfmpegArgs` throws "A voice track is required"). The pack script contains no `-an`. Bounds are unchanged: length 8–60 s, caption 24–72, colour `0xRRGGBB`.
2. **No WhatsApp in visible copy.** The only remaining mention is a code comment in `src/lib/automationKeys.ts`. It is not shown on screen.
3. **Unnamed orders are unchanged.** Verified by running the real router (`routeMessage`):
   - "Review the Calm Skin article" → asks "which mind?" (`ask_which_mind`).
   - "Swap the Calm Skin Routine Guide onto the skin guide" → the Executioner, filed as `product_line_apply`, no question.
   - "Should we post more this week?" → chat.
   No router code was changed.
4. **Admin copy is plain English.** Nav labels are Keys, Check, Data. Routes are unchanged. The Admin subtitle is "Admin", not "Editorial CMS". Internal names stay in source.
5. **Budget.** See the next section.

## Budget (the one place a ceiling was touched)

`node scripts/size-budget.mjs` failed on `total-css` before any Phase G change. I built the Phase F head (`f25a424`) and `main` (`a128521`) in `/tmp` to check:

| Build | total-css (gzip) | Result |
|---|---|---|
| `main` `a128521` | 15.95 kB | within tolerance |
| Phase F head `f25a424` | 18.77 kB | **FAIL** |
| This branch (before slice 5) | 18.77 kB | **FAIL** |

The growth is one stylesheet, `BuddyEntry-*.css` (about 2.9 kB gzip). It is Buddy's own look, from Phase 9 slice 4 (`e000ea9`). It loads only on `/buddy`. It was on the branch before Phase G. Phase G did not add it.

What changed in `scripts/size-budget.mjs`:
- The Buddy stylesheet is now measured as its own group, `lazy-css`, with a **hard ceiling of 3 KiB gzip** (currently 2.82 kB).
- `total-css` now covers only the stylesheets a reader loads. Its baseline in `scripts/size-budget.json` is **unchanged** (15,556 bytes). It now reads 15.95 kB, which is within tolerance.
- The reader's own budgets (`css`, `entry`, `article-reader`, `supabase`, `react-vendor`) are unchanged.

**This is a change to what `total-css` measures.** It is a lazy Buddy ceiling, which the rules allow with a note. The owner should confirm it. The alternative is to shrink the Buddy stylesheet or approve a new baseline.

Other budget rows, all within the 5% tolerance (none fails):
- `total-js` 250.51 kB against a baseline of 243.19 kB (+7.32 kB, +3%). Phase G added about +0.09 kB of this (the Phase F head was 250.42 kB). Most of the growth is from earlier branch work, and it is still inside tolerance.
- `admin-total-js` is +3.18 kB over baseline, within tolerance.
- Protected lazy admin ceilings are unchanged. `automation-runs` is 8.50 kB against a 9.00 kB limit, which is close. Its copy changed in slices 3–4, and the size change is small.

`scripts/public-size-budget.mjs` (public asset file size, 250,000 bytes) passes. It was not touched.

## Gates (run on the tree for this report)

Run in `/home/user/lixxonstudio`. Results are recorded from the commands' exit codes and output.

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run` with `LIXXON_FFMPEG` set to a local ffmpeg | exit 0. 172 files, 2,348 tests passed. `packVideoLook` ran its real 20 s render (11 tests, not skipped) |
| Typecheck, app | `npx tsc --noEmit -p tsconfig.app.json` | exit 0 |
| Typecheck, node | `npx tsc --noEmit -p tsconfig.node.json` | exit 0 |
| Lint, touched files | `npx eslint` on the 205 added, modified or renamed `src/` and `scripts/` files since `main` | exit 0. 0 errors, 7 warnings, all in code not changed in Phase G (`AdminConnections.tsx`, `AdminDataExplorer.tsx` lines 24 and 31, `NavigationContext.tsx`) |
| Build | `npx vite build` | exit 0 |
| Size budget | `node scripts/size-budget.mjs` | exit 0 (after the lazy-css change above) |
| Public asset budget | `node scripts/public-size-budget.mjs` | exit 0 |
| Secret scan | `git grep -l` for the three key prefixes | see below |

The ffmpeg used for the local fixture tests came from the `imageio-ffmpeg` package, installed in `/tmp/ffvenv`, outside the repository. It is used only for the test fixtures. No production ffmpeg was called.

### Secret scan

The scan lists file names only and prints no matched text. Three prefixes were searched in tracked files. Four files matched:

- `FEATURES.md` and `src/components/article/AskEditor.tsx` also exist on `main`. Their matches are short words, not key-shaped.
- `src/__tests__/buddyBrains.test.ts` is new on this branch. Its matches are shorter than any real key. It contains no key-shaped string.
- `src/__tests__/supabaseEnv.test.ts` is on `main`. It has two JWT-shaped placeholders. Their signature segments are 3 characters long, where a real signature is about 43. They are fixtures, not live credentials.

No live credential was found. These matches were reviewed by hand and are not new in Phase G, except the `buddyBrains.test.ts` hit, which was checked in the same way. This is a judgement call, and the owner should look at it.

## Freeze

`src/buddy/phaseGFreeze.test.ts` has one group per rule above, using the real functions where they exist. Source checks are used only for copy and file rules. It covers: the pack defaults and bounds; the ASS colour; the audio track and the refusal of a silent pack; the look-table boundary; WhatsApp in the library; the unnamed-order routes; eight brains, sixteen doors and five order kinds; Takeover default false; no Admin AI file; the `automation-distribution` function; the nav labels; the plain Keys, Check, Health, Article and Data copy; and the report and freeze files.

The Phase F freeze said "there is no Phase G". I changed that one pin, on purpose, to say that Phase G is the only later phase and that there is no Phase H. No other Phase E or F pin was changed.

## Known gaps and open risks

- **Quiet tail on long looks.** If the saved look is longer than the voice, the pack pads the audio with silence (`apad`). The video has a quiet tail. The bounds are unchanged, so this is allowed by the rules but is worth a look before a real render.
- **Server health text is unchanged.** The Health checks come from `admin_health_overview` in `supabase/migrations/20261004202000_admin_ops_tools.sql`. The screen now shows plain labels for the five engine-heavy checks, using a mapping keyed by check name. The server's detail and suggestion text still says things like "RLS" and "seq scans". Changing that text needs a new migration. None was written in Phase G, so nothing was added that could be applied by accident.
- **Key labels are mapped on screen.** The Keys screen shows the catalogue label through `plainKeyLabel`. The labels in the database are unchanged.
- **Words kept on purpose.** The Data page still names the SQL keywords (`SELECT`, `WITH`) because it is an SQL explorer. The "unrecognized result" wording is kept in the error notices. `ops.fix` is a permission name in code and is not shown.
- **Visible copy was checked by a script, not in a browser.** A forbidden-word extractor (TypeScript parser over JSX text and string literals) found no remaining forbidden words in the Admin screens. No preview server was run, so the screens were not seen rendered.
- **Phase E pin.** The "Delete the old one" pin in `phaseEFreeze.test.ts` still passes. It was not flipped.
- **Budget decision.** See the Budget section. Owner sign-off is needed for the `total-css` measurement change.
