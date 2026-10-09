# Buddy

This folder is Buddy. Buddy is the only one who talks to the owner.

- Buddy is a private chat for the owner. Other minds (Analyst, Strategist, CEO, Executioner, Auditor) do not get a chat here. They work behind the scenes in later phases.
- All new Buddy screens and Buddy-only browser code go in this folder. Do not add Buddy chat screens under `src/admin/pages`.
- Buddy sits at `/buddy`. It is behind the same owner sign-in, Admin role and MFA as the Admin area. Installing Buddy as an app grants no access.
- Buddy never posts, never edits articles, never sends email or push, and never turns on takeover.

## What is here now (phase 1, slices 1 to 5)

| File | What it does |
| --- | --- |
| `BuddyEntry.tsx` | Decides what `/buddy` shows: the greeting, then the chat. `/buddy/controls` is not a screen any more; it moves the owner to `/buddy`. |
| `BuddyAccessGate.tsx` | The owner gate for Buddy: sign-in, Admin role, then the verified code (MFA). |
| `BuddyGreeting.tsx` | The greeting: a short gold line, a time-of-day word, and a Continue button that appears after about 9.5 seconds (at once with reduced motion). |
| `BuddyChat.tsx` | The chat: today's briefing first, then the message list, composer, New chat, a Chats drawer for past chats, and a Reports button. |
| `BuddyBriefingCard.tsx` | One morning briefing as titled sections. A quiet day shows "Quiet since you left." |
| `BuddyReports.tsx` | The Reports door: a list of night reports, or "No night reports yet." No composer. |
| `buddyChatStore.ts` | Browser side of chats, briefings and reports. Only this owner's rows are readable (row-level security). |
| `buddyDate.ts`, `buddyMotion.ts` | Today's date on this device, the time-of-day word, and the greeting timing. |
| `BuddySettings.tsx` | Buddy settings: pick one of four looks (previews at once, kept only on Save) and the optional read-aloud switch (off by default). |
| `buddyVibes.ts` | The four looks: Noir Gold (default), Ivory Silk, Velvet Opera, Porcelain. Unknown values fall back to Noir Gold. |
| `buddySettingsStore.ts` | Saves and reloads the look and the read-aloud switch on the owner's row. |
| `buddySpeech.ts` | Read-aloud through the browser's own voice. Only Buddy's replies and the briefing are read, and only when switched on. |
| `buddy.css` | Buddy's look. Scoped to `.buddy-app`. Four looks: Noir Gold (default), Ivory Silk, Velvet Opera, Porcelain. |
| `buddyThinkResult.ts` | Reads the answers from the think function. Anything malformed is dropped. |
| `buddyPaths.ts` | The `/buddy/controls` path check (the old address, which now redirects). |

Server side:

- `supabase/functions/buddy-think/index.ts`: the owner check, the Google key read from Vault, the rate limit, and the chat storage through the owner's own session.
- `supabase/functions/_shared/buddyThink.ts`: the rules for `status`, `probe`, `ask` and `briefing`, and the one Gemini call. Buddy thinks with `gemini-3.8-flash`.
- `supabase/functions/_shared/buddyBriefing.ts`: the briefing rules. A day is "quiet" only when every source was read and none had anything real (paid orders, new articles, failed automation steps). Article views are shown but do not make a day busy.
- `supabase/migrations/20261009110000_buddy_chats.sql`: the `buddy_chats` and `buddy_messages` tables. Each owner sees only their own rows.
- `supabase/migrations/20261009120000_buddy_briefing_reports.sql`: briefing threads (one per owner per day), the "last seen" time, and the `buddy_reports` table (read only).
- `supabase/functions/_shared/buddySiteFacts.ts`: the read-only site list Buddy sees with each question (published article titles, active shop products with USD prices). Article bodies are never read.
- `supabase/migrations/20261009130000_buddy_settings.sql`: the look and read-aloud columns on the owner's row. "Last seen" now starts empty, so saving settings does not count as having looked.
- The Google key is the existing `gemini_api_key` entry in Admin, under Automation keys (labelled "Google key"). It is written once and never sent back to the browser.

## What is not here

- The old typed-command screen (typed commands, draft list) was removed in Phase 2, slice 1. Its sign-in gate now lives in `BuddyAccessGate.tsx`.
- The old Admin AI screen lives in `src/admin/pages/AdminAI.tsx` (22 tabs). It is not Buddy. Phase 2 replaces what the owner sees there.
- Buddy cannot change the site. It only reads published article titles and active shop products, and never article bodies (see `supabase/functions/_shared/buddySiteFacts.ts`).
- Night reports are not written by anything yet. The Reports door only lists them.
