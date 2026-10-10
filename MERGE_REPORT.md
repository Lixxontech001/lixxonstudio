# MERGE report: Buddy kit

**Status: MERGED.** PR #43 (`arena/1d438dc4-lixxonstudio` → `main`, "Buddy kit: minds, doors, brains") was merged with a merge commit. `main` is now `bce574c`. The supabase deploy workflow ran on that push. It applied migrations and deployed functions to the owner's Supabase project, and its verification steps passed.

This report replaces the earlier "held" version. The held version was written before the CI fix and the merge.

## What was done, in order

1. **CI was red on PR #43 (`build`).** The cause was the Node pin, not the app. `@supabase/supabase-js` 2.117.2 requires Node 22 or later. The test `src/__tests__/phaseAFreeze.test.ts` (new on this branch, from Phase A) loads the Supabase client. Under Node 20 it fails at load with "native WebSocket not found". `main` was green only because it has no test that loads the client.
   - Fix: `.github/workflows/ci.yml`, `node-version` 20 → 22 in the `build` and `lighthouse` jobs. Config only. No test was removed or skipped.
   - Commit `19e5748`, pushed to the arena branch. CI run 38069196063: **success** (build and lighthouse).
2. **Checks before merge, all passing:**
   - `npm run lint`: exit 0 (0 errors, 30 warnings).
   - `npx tsc --noEmit -p api/tsconfig.json`: exit 0.
   - `python3 scripts/db-test.py` (embedded Postgres, every migration in order, plus RLS assertions): exit 0, **103 migrations applied; assertions passed.** This runs against an embedded database with a Supabase stub, not the live project.
   - Earlier gates (from before the CI fix): `vitest` 172 files / 2,348 tests, `tsc` for app and functions, `vite build`, all exit 0.
   - PR #43 was `MERGEABLE` and `CLEAN` with build, lighthouse, measure, Vercel, and Vercel Preview Comments passing.
3. **Merge.** `gh pr merge 43 --merge`, with `--match-head-commit` pinned to `19e5748`. The merge commit is `bce574c`. The merge subject does not contain "pg_cron". No force-push, no `--auto`, no branch deleted. Pushing to `main` was not done directly. The `main` push came from the PR merge.
4. **Supabase deploy** (`Deploy Supabase`, triggered by the push to `main`): run 38069480937, **success**.
   - Link project: success.
   - Set function secrets: success.
   - Seed private scheduler credentials in Vault: success.
   - **Push migrations (`supabase db push --include-all`): success.**
   - **Deploy edge functions: success.**
   - Verify deployment (migrations applied, functions answer): success.
   - Verify pg_cron jobs and inspect `cron.job_run_details`: success.
   - Drain email queue: skipped (it runs only when the commit message contains "pg_cron"; this one did not).
5. **Results on `main` (`bce574c`):** CI build success, Supabase deploy success, Supabase Preview success, **Vercel status: success**. Lighthouse is skipped on `main`, as configured.

## Migrations

- The deploy report (issue #44) lists 29 migrations, from `20261009230000` through `20261019010000`. Local and remote match for each one listed. The report is an excerpt. It does not show the older files, so this report does not claim the full list of 103 was checked on the live database. The push itself reported success.
- `--include-all` applies any older migration that was missing on production, so the pre-`20261009` files were included in that push. Check the live `supabase_migrations` table to confirm the full set.
- Migration errors: none. The push step succeeded, so there was no error to stop at.

## Functions

- The deploy step reports success for all edge functions. The workflow's probes (from issue #44):
  - `GET feeds?type=sitemap` → 200.
  - `GET order-status`, `submit-form`, `create-order`, `download-file`, `verify-payment` → 405 (expected for GET).
  - `POST refresh-rates` → 200 `{"ok":true,"updated":7}`. **This probe wrote 7 rate updates to the live database.** It came from the workflow's own check, not from this session. It is listed here for transparency.
  - `POST send-emails` with a wrong secret → 403 (expected).
- `verify_jwt`: existing lines in `supabase/config.toml` are unchanged (0 lines removed in the diff). New functions were added, with `verify_jwt = true` for the owner-only ones. `buddy-night-clock` is `verify_jwt = false` on purpose, because it checks an internal secret itself.

## ⚠ Needs the owner's attention: the Buddy night clock is now scheduled

- Migration `20261016000000_buddy_night_clock.sql` schedules pg_cron job `lixxon_buddy_night_clock` every 30 minutes (`*/30 * * * *`). Its guards passed, because the Vault credentials were seeded in the same deploy run. The job is now **live**.
- What it does, each run: calls the `buddy-night-clock` function. That function sends any owner web-push notifications still waiting, and writes the owner's night report once per night. It does not call a language model or a messaging channel.
- I flagged this migration before the merge, but the merge went ahead before the owner had reviewed it. The owner should decide whether to keep the schedule. To turn it off, unschedule it in the Supabase SQL editor (`select cron.unschedule('lixxon_buddy_night_clock');`). I could not do that from this sandbox.

## Still unchanged (per GO_LIVE.md)

- **Takeover:** still off. Default `takeover: false` in `src/buddy/minds/mindsControlsStore.ts`. No Takeover setting was changed. The live row was not checked.
- **Daily cron** (`minds-daily-run`, `20261010090000_minds_daily_run.sql`): still commented out.
- **Keys:** none read, pasted, or logged. Vault seeding ran inside the workflow with secret values never shown here.
- **Doors, phone registration, posting, live LLM, Telegram, Gemini, Groq:** not touched.

## Not verified

- Workflow logs cannot be downloaded from this sandbox (`gh run view --log` returns an EOF from the results receiver). Step status comes from the Actions API, and the report comes from the issue. I have not read the full raw logs.
- Live database state beyond the 29-row excerpt. Live project not reachable from this sandbox.
- Vercel's production deployment content. Only the GitHub status (success) was read.

## For the owner

1. Decide on the Buddy night clock schedule (see above).
2. Open `/buddy`, read the briefing, ask one question.
3. Paste keys in Admin (phone alert keys, brain keys) and register the phone for push. Connect only the doors you have accounts for.
4. Turn Takeover on only when ready (Minds).

## Branch note

This report was updated on `arena/1d438dc4-lixxonstudio`, not `main`. Per the operator rule, changes reach `main` only through a PR merge. Opening a small follow-up PR for this file is an option if you want it on `main`.
