# GO_LIVE: the owner's checklist

This is the only work left after Phase F. It is for the owner, in this order.
**The coding agent does not do steps 2 to 4, and does not do steps 5 to 10 either.** It never merges, never deploys,
never applies a migration, and never holds a key. No key goes in chat, in git, or in a file.

Branch: `arena/1d438dc4-lixxonstudio`. Nothing on it is merged, deployed, or applied.

## 1. Review this branch against `main`

- The branch starts from `main` at `a128521230ab11c197e7d23d035ad7f973b216a7`. That is the last checked `main`.
- Read `main` again before you merge. If `main` has moved, check the diff still makes sense.
- Read `PHASE_F_REPORT.md` for the commit list, the test numbers, and the open decisions.

## 2. Merge, when you say so

- You merge the branch. The agent does not merge and does not open a pull request.

## 3. Apply the unapplied migrations, in filename order

The production database cannot be seen from the coding side. First check what is already on production, for example with `supabase migration list` against the live project. Skip any file that is already applied. Then apply the rest **once each, in filename order**. Do not run a file twice unless its header says it is safe to run again.

The repository marks these 38 files as **not applied** (their headers say so):

1. `supabase/migrations/20261009140000_minds_controls.sql`
2. `supabase/migrations/20261009150000_buddy_orders.sql`
3. `supabase/migrations/20261009160000_minds_daily_log.sql`
4. `supabase/migrations/20261009170000_minds_notable_events.sql`
5. `supabase/migrations/20261009180000_buddy_night_report_writer.sql`
6. `supabase/migrations/20261009190000_post_product_slots.sql`
7. `supabase/migrations/20261009200000_post_product_edits.sql`
8. `supabase/migrations/20261009210000_post_drip_days.sql`
9. `supabase/migrations/20261009220000_minds_gap_notes.sql`
10. `supabase/migrations/20261009230000_minds_apply_placement.sql`
11. `supabase/migrations/20261010090000_minds_daily_run.sql`
12. `supabase/migrations/20261010100000_minds_packs.sql`
13. `supabase/migrations/20261010110000_minds_pack_posted.sql`
14. `supabase/migrations/20261011090000_door_connections_catalog.sql`
15. `supabase/migrations/20261011100000_door_posts.sql`
16. `supabase/migrations/20261011110000_door_posts_open_more.sql`
17. `supabase/migrations/20261011120000_door_posts_open_all.sql`
18. `supabase/migrations/20261011130000_door_catalog_twelve.sql`
19. `supabase/migrations/20261011140000_door_posts_twelve.sql`
20. `supabase/migrations/20261011150000_door_posts_three_open.sql`
21. `supabase/migrations/20261011160000_podcast_cover_catalog.sql`
22. `supabase/migrations/20261011170000_door_posts_all_twelve_open.sql`
23. `supabase/migrations/20261011180000_podcast_episodes.sql`
24. `supabase/migrations/20261011190000_door_post_retry.sql`
25. `supabase/migrations/20261011200000_pack_media_saved.sql`
26. `supabase/migrations/20261011210000_notable_push.sql`
27. `supabase/migrations/20261012000000_notable_sources.sql`
28. `supabase/migrations/20261013000000_minds_paused_doors.sql`
29. `supabase/migrations/20261014000000_door_posts_rss_four.sql`
30. `supabase/migrations/20261015000000_notable_door_failed.sql`
31. `supabase/migrations/20261015010000_video_template_clear_name.sql`
32. `supabase/migrations/20261015020000_minds_controls_change_source.sql`
33. `supabase/migrations/20261016000000_buddy_night_clock.sql`
34. `supabase/migrations/20261017000000_buddy_brain_slots.sql`
35. `supabase/migrations/20261018000000_notable_week_change.sql`
36. `supabase/migrations/20261018010000_retire_old_sender_keys.sql`
37. `supabase/migrations/20261019000000_abandoned_carts_no_anon_update.sql`
38. `supabase/migrations/20261019010000_push_note_pending.sql`

Earlier files (65 files, before `20261009140000`) do not say "not applied" in their headers. The check above is the only way to know whether they are on production. Apply any that are not, in the same order.

Notes on the files above:

- `20261016000000_buddy_night_clock.sql`: the header says it applies only when you merge and turn the schedule on. The night report then writes between 23:30 and 04:00 on your clock.
- `20261010090000_minds_daily_run.sql`: the daily cron line is a comment. It stays a comment until you turn the schedule on (see Owner decisions, item A).
- `20261019000000_abandoned_carts_no_anon_update.sql`: before you apply it, check the live `abandoned_carts` policies. It drops `abandoned_carts_anon_update` and `rl_ac_update` if they exist. The storefront writes carts only through the database function `upsert_abandoned_cart`.
- `20261019010000_push_note_pending.sql`: applies the one-send guarantee. Until it is applied, the claim cannot be written, and the send goes ahead as it did before Phase E. So two attempts at once can both send.
- `20261018010000_retire_old_sender_keys.sql`: turns off the old sender key rows (WhatsApp, and the manual Facebook and Pinterest keys). It does not delete any saved value.

## 4. Deploy the edge functions

The function folder has these twenty functions. Each one has an explicit `verify_jwt` entry in `supabase/config.toml`, and the table matches that file. Deploy each one with the Supabase CLI, for example `supabase functions deploy <name>`. `_shared` and `_types` are folders of shared code, not functions, and are not deployed on their own.

| Function | verify_jwt |
|---|---|
| `automation-distribution` | true |
| `automation-keys` | true |
| `automation-push` | true |
| `automation-runner` | false |
| `automation-scheduler` | false |
| `automation-video-template` | true |
| `buddy-night-clock` | false |
| `buddy-night-report` | true |
| `buddy-think` | true |
| `create-order` | false |
| `door-connection-test` | true |
| `download-file` | false |
| `feeds` | false |
| `minds-control-notify` | true |
| `minds-run-placement` | true |
| `order-status` | false |
| `refresh-rates` | false |
| `send-emails` | false |
| `submit-form` | false |
| `verify-payment` | false |

The functions the owner most needs: `buddy-think` (Buddy's chat and the brain chain), `minds-control-notify` (the Minds switches and the phone buzz), `buddy-night-clock` and `buddy-night-report` (the night report), `minds-run-placement` (Run today), and the `automation-*` functions (the pack and door run).

## 5. Keys: paste them only in the app

- Paste every key in **Admin**: the **Automation keys** page (`/admin/automation/keys`), the **Brains** page (`/admin/automation/brains`), or **Connections** (`/admin/ai/connections`, linked from Minds). Never in chat, never in a file, never in git.
- The brain keys are the eight brain slots, with Gemini first. Buddy does not try Cerebras or DeepSeek, so a key for either one changes nothing yet.
- The door keys are on Connections. A saved value is never shown again.
- The phone push keys (VAPID) are generated and saved on **Automation keys**.

## 6. Register your phone for push

- On **Automation keys**, save the VAPID values first.
- On your phone, open `/admin/settings` and tap **Register this device**. Without VAPID, push is skipped honestly and nothing is sent.

## 7. Connect only the doors you actually have

- On **Connections**, connect only the doors you have accounts for. A door is "connected" only when every field is saved.
- **Test** checks the connection. It publishes nothing.
- The four gated channels (Instagram, TikTok, Facebook, Pinterest) are never sent by a robot. Buddy makes the caption, the time, the picture, the video and the link for each. You post by hand, then tap **I posted this**.

## 8. Open Buddy, and read the briefing

- Open `/buddy`. Tap **Continue**. Read today's briefing. It may be quiet, and that is correct when nothing happened.
- Ask Buddy one question, for example "how do I connect Telegram?", to check that it answers.
- Do **not** turn Takeover on until you have looked at all of the above.

## 9. Flipboard, Google News, Microsoft Start and SmartNews

- Buddy keeps your RSS feed current and pings a free hub for each new article. That ping is the product.
- If any of those services asks for a feed address, give it your site's `/rss.xml`. Buddy does not fill in those forms.
- Any extra "submit to the hub" step is you, in a browser. Buddy does not submit anything.

## 10. Takeover stays off until you are ready

- Takeover is off by default and stays off until you turn it on in **Minds**.
- When Takeover is on, the minds may do the work they are already allowed to do, and they must tell you.
- Kill stops nothing, all five minds, or one mind. Use it at any time.

## Owner decisions (not code)

These are your decisions. Each one is either a choice the code already supports, or a limit that the screen or the report states. None is an unfinished code path left for the agent.

- **A. Daily run and the schedule.** The 08:00 Lagos pipeline is in code. The minds' daily run is queued by a cron line that is still a comment (`20261010090000_minds_daily_run.sql`). When that line is on, it queues today's order only. The run starts when you ask Buddy to run today, with Takeover on. A fully automatic daily run is not built. Decide before you turn the schedule on.
- **B. "Delete the old one".** Fixed in Phase F: "Delete the old one" and "Erase it" are refused like other deletes, with the refusal line. Nothing for you to decide. Tell the agent if you want a different wording.
- **C. "Which mind?" for unnamed orders.** Swaps go to the Executioner with no question. Other unnamed orders still ask which mind. Keep the question or drop it.
- **D. The saved video look.** The pack video reads three saved values: length, caption size and caption colour. The title, movement, end card and watermark are not used by the pack video. The test render workflow does not read the saved look. Nothing to decide unless you want more values wired.
- **E. Gemini TTS.** Confirm the free-tier terms on Google's pricing page before you tell anyone the voice is free.
- **F. Medium.** Only an existing integration token works. Medium no longer issues new tokens.

## Eyes-only checks (no code)

- Look at the Video look screen and the Buddy screens in a browser, in each of the four looks.
- Check that no "Nigeria", "Naira" or "Lagos" text is on any screen.
- Listen to a real pack video. It must have sound.
