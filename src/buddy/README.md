# Buddy

This folder is Buddy. Buddy is the only one who talks to the owner.

- Buddy is a private chat for the owner. Other minds (Analyst, Strategist, CEO, Executioner, Auditor) do not get a chat here. They work behind the scenes in later phases.
- All new Buddy screens and Buddy-only browser code go in this folder. Do not add Buddy chat screens under `src/admin/pages`.
- Buddy sits at `/buddy`. It is behind the same owner sign-in, Admin role and MFA as the Admin area. Installing Buddy as an app grants no access.
- Buddy never posts, never edits articles, never sends email or push, and never turns on takeover.

## What is here now (phase 1, slices 1 to 3)

| File | What it does |
| --- | --- |
| `BuddyEntry.tsx` | Decides what `/buddy` shows: the chat. `/buddy/controls` shows the old screen. |
| `BuddyChat.tsx` | The chat: message list, composer, New chat, and a Chats drawer for past chats. |
| `buddyChatStore.ts` | Browser side of chats: list, create, open, and send. Only this owner's rows are readable (row-level security). |
| `buddy.css` | Buddy's look. Scoped to `.buddy-app`. Noir Gold is the only vibe for now. |
| `buddyThinkResult.ts` | Reads the answers from the think function. Anything malformed is dropped. |
| `BuddyPwaApp.tsx` | The old Buddy: a typed command box with a draft list. Kept at `/buddy/controls` until it is retired. It also holds the shared sign-in and MFA gate (`BuddyAccessGate`). |
| `buddyOperations.ts` | The old typed command list (status, daily kit, help, pause or resume the daily schedule). |
| `offlineBuddyQueue.ts` | The old draft list saved in the browser. |
| `buddyPaths.ts` | The `/buddy/controls` path check. |

Server side:

- `supabase/functions/buddy-think/index.ts`: the owner check, the Google key read from Vault, the rate limit, and the chat storage through the owner's own session.
- `supabase/functions/_shared/buddyThink.ts`: the rules for `status`, `probe` and `ask`, and the one Gemini call. Buddy thinks with `gemini-3.8-flash`.
- `supabase/migrations/20261009110000_buddy_chats.sql`: the `buddy_chats` and `buddy_messages` tables. Each owner sees only their own rows.
- The Google key is the existing `gemini_api_key` entry in Admin, under Automation keys (labelled "Google key"). It is written once and never sent back to the browser.

## What is not here

- The Admin AI control tower lives in `src/admin/pages/AdminAI.tsx` (22 tabs). It is not Buddy and is not touched in phase 1.
- The morning briefing, the Reports list, the greeting animation, vibes and voice are later slices of phase 1.
- Buddy cannot see the website's articles or shop yet. That is slice 6.
