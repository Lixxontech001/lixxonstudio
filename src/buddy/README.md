# Buddy

This folder is Buddy. Buddy is the only one who talks to the owner.

- Buddy is a private chat for the owner. Other minds (Analyst, Strategist, CEO, Executioner, Auditor) do not get a chat here. They work behind the scenes in later phases.
- All new Buddy screens and Buddy-only browser code go in this folder. Do not add Buddy chat screens under `src/admin/pages`.
- Buddy sits at `/buddy`. It is behind the same owner sign-in, Admin role and MFA as the Admin area. Installing Buddy as an app grants no access.
- Buddy never posts, never edits articles, never sends email or push, and never turns on takeover.

## What is here now (phase 1, slice 1)

| File | What it does |
| --- | --- |
| `BuddyEntry.tsx` | Decides what `/buddy` shows. Right now it shows a placeholder. `/buddy/controls` shows the old screen. |
| `BuddyPwaApp.tsx` | The old Buddy: a typed command box with a draft list. Kept for now, to be replaced by the chat. It also holds the shared sign-in and MFA gate (`BuddyAccessGate`). |
| `buddyOperations.ts` | The old typed command list (status, daily kit, help, pause or resume the daily schedule). |
| `offlineBuddyQueue.ts` | The old draft list saved in the browser. |
| `BuddyThinkCheck.tsx` | Phase 1 slice 2. Shows whether a Google key is saved, and a "test question" button that makes one real Gemini call. |
| `buddyThinkResult.ts` | Reads the answers from the think function. Anything malformed is dropped. |
| `buddyPaths.ts` | The `/buddy/controls` path check. |

Server side: `supabase/functions/buddy-think/` (the owner check, Vault read and rate limit) and `supabase/functions/_shared/buddyThink.ts` (the Gemini call and the answer rules). Buddy thinks with `gemini-3.8-flash`. The Google key is the existing `gemini_api_key` entry in Admin, under Automation keys. It is written once and never sent back to the browser.

## What is not here

- The Admin AI control tower lives in `src/admin/pages/AdminAI.tsx` (22 tabs). It is not Buddy and is not touched in phase 1 slice 1.
- Buddy's chat, vibes and reports are added in later slices of phase 1.
