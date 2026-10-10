# MERGE report: Buddy kit

**Status: NOT merged. Live database and functions NOT changed.** The merge was held (see Why). PR #43 is open.

## Checked

- `main` at last read: `a128521230ab11c197e7d23d035ad7f973b216a7`. Unchanged when checked.
- Ancestor check: `origin/main` is an ancestor of `origin/arena/1d438dc4-lixxonstudio` (OK). The branch is 112 commits ahead.
- `PHASE_G_REPORT.md` present on the branch (OK).
- Branch head at the gate run: `26bedc5`. Tree clean.

## Gates run before any merge (all pass)

| Gate | Result |
|---|---|
| `npx vitest run` (LIXXON_FFMPEG set) | exit 0. 172 files, 2,348 tests pass |
| `npx tsc --noEmit -p tsconfig.app.json` | exit 0 |
| `npx tsc --noEmit -p supabase/functions/tsconfig.json` | exit 0 |
| `npx vite build` | exit 0 |

## Pull request

- PR #43, `arena/1d438dc4-lixxonstudio` → `main`, title "Buddy kit: minds, doors, brains". Open. Not merged.

## Migrations

- Applied: **none.** The sandbox has no route to the live project. Outbound access is limited to github.com, npm, and PyPI. `supabase.co` and `api.supabase.com` do not resolve or connect. The Supabase CLI is not installed, and no Supabase token is configured.
- Present in the repo with a "not applied" header: all 38 files from `GO_LIVE.md` (checked). `20261010090000_minds_daily_run.sql` keeps its cron line commented.
- Older migrations (65 files before `20261009140000`): not checked against production. Only a live `supabase migration list` can show them.

## Functions

- Deployed: **none.** Same network limit. The 20 functions in `GO_LIVE.md` step 4 are ready to deploy. `verify_jwt` was not changed.

## Vercel

- Not checked. The sandbox cannot reach Vercel. The frontend build passes locally (`vite build` exit 0).

## Takeover

- Still off. Not touched.

## Keys

- Not touched. No key, Vault value, or service-role value was read, pasted, or logged.

## Why the merge is held

Merging `main` deploys the frontend (if Vercel is connected). The new screens call database functions and edge functions that do not exist on production until the migrations and deploys above are done. Merging first would leave production broken. The merge should happen after those steps, or together with them.

## Still for the owner

1. Run `supabase migration list` against the live project. Apply the missing files in filename order, starting at `20261009140000`. Stop at the first error.
2. Run `supabase functions deploy <name>` for each function in `GO_LIVE.md` step 4.
3. Merge PR #43 (merge commit keeps history).
4. Paste keys in Admin. Register the phone for push. Connect only the doors you have accounts for.
5. Open `/buddy`, read the briefing, ask one question.
6. Turn Takeover on only when ready (Minds).

## Not done in this session

- Egress: images still served from `supabase.co`. Not checked here, because the sandbox cannot reach it.
- Daily cron: not uncommented. Owner decision A.
