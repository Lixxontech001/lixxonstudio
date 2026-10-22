# Lixxon Studio — Grand vision for Buddy, minds, automation, Takeover
**Audience:** Gemini (and any coding agent) continuing this product.  
**Owner:** Lixxontech001. Magazine + shop. Public site: `https://lixxonstudio.vercel.app`. Repo: `Lixxontech001/lixxonstudio`.  
**How to use this file:** This is the contract. If a thought, a PR, or an older report fights this file, **this file wins**. Do not reopen locks unless the owner says so in this conversation. Do not invent extra Admin tabs, extra minds, Make.com, n8n, WhatsApp, paid ads spend, or a 22nd “AI settings” screen.
Read the live repo on **`main`** as code truth. This document is **product truth** for what Buddy must become. The live code is **behind** this vision. That gap is the work.
---
## 0. One sentence
Buddy is one ultra-smart operator for this magazine-shop: it thinks in living plain words, plans, then does connected work now (or in the background with a buzz), keeps the archive alive, drafts in this magazine’s voice, never publishes or creates products or spends by itself, never lies that something went out, and never leaves the owner a pile of tickets for work Buddy should have done. A good owner day is **under 20 minutes**. If it needs more of him, the upgrade failed.
---
## 1. What this business is
Lixxon Studio is a **magazine with a shop**, not a generic SaaS, not a chatbot demo, not a content farm.
- Readers come for **articles**.
- Money is **USD** on the public site. Never Naira on public screens. Never country, city, or timezone names on public screens.
- The owner **writes** (or at least **hits publish**). The owner **makes every shop product**. The owner **pays** for anything that costs money.
- Buddy is the **chief of staff**, not a second public writer, not a customer-support bot, not an ads buyer.
The owner is tired of clerk software. He asked for autonomous, full authority, ultra intelligence — then we **locked** what that means so it can scale the **site**, not spam the internet.
---
## 2. What is actually live today (do not gaslight)
**Production `main` (verified in this talk):** merge commit **`b7ef3a3`**, PR **#46** (12 Oct 2026), on top of Buddy kit **#43** and image-cache egress **#45**. Live `version.json` was this sha. Database migrations including the **08:00 morning clock** were applied by the repo’s Deploy Supabase workflow (issue **#47**). Takeover **default is Off**; the owner can turn it **On**.
### 2.1 What shipped (real)
- Magazine, shop, Flutterwave, Admin, Guide, Keys, Check, Data in plainer labels.
- Buddy chat + briefing + Reports + Changes.
- Five named minds in code: Analyst, Strategist, CEO, Executioner, Auditor.
- Eight brain slots: Gemini, Groq, NVIDIA, Cloudflare, OpenRouter, Hugging Face; **Cerebras and DeepSeek skipped**.
- Sixteen **free doors** (Telegram, Discord, Bluesky, Mastodon, Tumblr, Blogger, Medium, Pixelfed, WordPress.com, YouTube, Vimeo, podcast, Flipboard, Google News, Microsoft Start, SmartNews). **No WhatsApp door.**
- Takeover, Kill, 08:00 clock (ticks; with Takeover Off it must **stop** before changing the site).
- Packs, Video look, “I posted this,” captions.
- Collection pages, typo-tolerant search (articles **and** products), related-articles rail, featured/editor’s pick, tags, glossary/knowledge cards, Listen-to-article (device TTS), theme light/dark, offline shell, comments approval, cart/refund counts, phone register, Team & access.
### 2.2 What the owner actually got in chat (broken — this is why he is angry)
A real session with **Takeover On** and **keys saved**:
- Briefing: away 7 hours, Takeover on, **nothing sent**, views **2 vs 41**, paid orders **0 vs 5**, “no mind has logged anything,” **“I cannot read the error log yet,”** phone alerts did not go out, **“N orders waiting for you,”** next move **“Some numbers could not be read. Ask me again.”**
- “Make the Auditor audit the full site now” → Buddy said it **cannot force** the Auditor, then “passed a note,” then tickets **3 → 10 waiting for the owner**.
- Repeated: **“Buddy could not reach any of its brains just now. Nothing was changed. Try again in a few minutes.”** — this line is `ALL_FAILED_LINE` in `brainChain.ts`. It means keys **were found** and **every** provider call still failed. It is not “forgot to paste a key.”
- When minds finally “logged Done”: Analyst restated the briefing numbers; Strategist “suggested next steps” **with no steps in the log**; CEO said **no waiting orders** while the same screen said **10 waiting**.
- “What are the next steps?” → circular, then “not listed in the current log,” then brains unreachable again, then canned “I hear your frustration.”
- Duplicate sends of every line (UI double-submit).
- Earlier chat: “Do something (anything)” → **“No mind was named. Saved for the Executioner. It is waiting. Takeover is on, so it runs on the next run.”** plus **“Minds will not publish, send or spend…”** even for connected free doors.
### 2.3 Why the code is dumb (root causes — fix these, do not perfume them)
1. **Buddy is a ticket clerk.** Orders file as `waiting`. The briefing labels them **“waiting for you.”** Those are **his orders to the company**. Inverting that made him the intern.
2. **Takeover On does not mean do it now.** Chat files for “the next run” / 08:00. “Make the Auditor do it now” is not wired to run the Auditor in that turn.
3. **Canned owner-facing strings.** `No mind was named.` `ALL_FAILED_LINE`. Helpdesk greets. `RESTRICTED_LINE` dumping “will not publish, send or spend” on the word *post*. Phase H killed “which mind?” and replaced it with a **worse stamp**.
4. **Buddy’s own system instruction still forbids acting:** it is told it does not post, send, publish, or change anything itself — so even a working brain talks like a clerk.
5. **Brain calls fail as a mystery.** Chain in `brains.ts` / `brainChain.ts`, ~15s timeout. Model IDs must be **real and current**. Test must mean a **one-line proof**, not Saved. Failure must **name which brain and why** (refused, too slow, empty), then try the next. Never ten copies of the same stamp.
6. **Logs are slogans.** “Suggested next steps” with no steps is a **fail**. Empty Done is a **fail**.
7. **Briefing next-move is a form.** `nextMove()` treats an unreadable **error log** as “ask me again” even when views and orders **were** read. That must die.
8. **Five minds on the surface.** The owner now wants **one Buddy**. The five exist **inside**. He must never hear routing.
Until brains **answer** and work **runs now**, nothing else scales the site.
---
## 3. North star (110×)
Buddy is **one** operator.
- Reads **this** shop: published titles and bodies, shop, logs, last briefing, **this chat**, **30 days** of winners and losers (views and paid orders, doors). **No** reader message **bodies** in mind logs. **No** Vault strings. **No** keys in chat.
- Thinks in **living plain English**. No frozen helpdesk lines as the answer. No jargon (Vault, RPC, OAuth, JWT, RLS, cron, seq_scan) on anything the owner reads.
- Shows a **short plan**, then **does it** when he says go / do it now / don’t ask me what.
- When he is **away** and Takeover is On, runs an **08:00 morning desk** (same rules).
- If work continues after the reply: chat may say **started**; **buzz + log + briefing** when it **finishes or blocks**. He must not sit asking “has it done it?”
- **Under 20 minutes** of owner time on a normal day: publish 0–1 draft, maybe make one product, maybe approve comments, copy the weekly letter if it is that week. Everything else is Buddy.
---
## 4. Takeover, Kill, Auditor, 08:00 (the switches)
### 4.1 Takeover
- **Owner** flips it on Admin → Minds. Buddy **never** flips Takeover.
- **Off:** think, tell, draft in chat/Admin unpublished. **Nothing live** changes: no door post, no pack save that goes out, no price write, no featured reorder, no live 1–2 sentences.
- **On:** Buddy **may** change the live site **only** in the ways locked below, **Auditor first** where a live change is defined, **tell every time**.
### 4.2 Kill
- **One tap** stops **live** work: posts, prices, places, reorders, featured flips, packs that send.
- Drafts in chat / unpublished Admin drafts **may continue** (think/tell).
- Owner turns Kill off to resume. **Do not** add five extra Kill switches.
- Pause-one-channel on Connections **stays**.
### 4.3 Auditor (inside Buddy)
- Never weakened. Never killed via another path.
- Before a **live** change: Auditor checks. If no: Buddy **rewrites that one change once** from the reason, tries once more. If still no: **skip that change**, continue **other** work, buzz with why. **Never force** a blocked change through.
- “Auditor” in the owner’s mouth means: **run a real check now**, findings **in this chat**, not a ticket to a ghost.
### 4.4 08:00
- Existing **owner-day** clock. Do **not** put city/country/timezone on public screens. If the hour is wrong, fix it to the owner’s day without naming a place on the magazine.
- 08:00 is the **away desk**, not “chat orders wait until morning.”
- Chat orders with Takeover On run **in this turn** (or start now and buzz when done).
### 4.5 Away two weeks (Takeover On)
- Mornings **keep running**. Do **not** halt the week because one channel died.
- Channel fails: retry **up to 3**, then **skip that channel**, continue others, write it down. Owner fixes the channel when back.
- All brains dead: skip work that **needs** a brain; still do anything that does not; buzz; try next morning. No “try in a few minutes” loop in chat.
- Safer side **still means:** no spend, no silent publish of a new article, no new shop row, no fake send, no ignoring Auditor.
---
## 5. Who does what (human jobs vs Buddy)
| Job | Who |
|---|---|
| Hit **publish** | Owner only |
| **Create** shop product (row, file upload, price first set) | Owner only |
| **Spend** / ads / refunds / coupons go live | Owner only (Buddy **never** spends, never refunds, never auto-discount, never $0 / free / Naira) |
| **Unpublish / take down** | Owner only. Buddy may **say** a piece looks dead/wrong. Never deletes. Taken-down pieces are **not** dripped |
| Approve **comments** | Owner. Buddy **drafts** a reply in chat. Never auto-public as the owner. Never put comment **body** in a mind log |
| Send **weekly letter** / cart reminder / copy to mail | Owner copies/sends. Letter **stays in Buddy chat**. Buddy must **not** send a list even if Resend is connected |
| Register **phone**, paste **keys**, connect **channels** | Owner |
| **Draft** articles (series + at most one extra) | Buddy, quality gate |
| Land draft in **Admin unpublished** | Buddy (no copy-paste from chat) |
| **Pack** on publish | Buddy |
| **Post** connected channels | Buddy (Takeover On) |
| **Place** owner-made products (1–2 sentences) | Buddy, Auditor, tell |
| **One USD price** a day | Buddy, Auditor, tell |
| **Featured / winners first** | Buddy (Takeover On); owner **pin** overrides |
| **Plan, diagnose, weekly meeting, recovery step one** | Buddy |
---
## 6. Chat behaviour (living words, not strings)
### 6.1 Forbidden owner-facing stamps (delete as the reply)
Including but not limited to:
- “No mind was named.”
- “Saved for the Executioner. It is waiting.”
- “Takeover is on, so it runs on the next run.”
- “Minds will not publish, send or spend, so any part like that waits for you.”
- Stock “Hey! How can I help you today?” twice
- “Buddy could not reach any of its brains just now. Nothing was changed. Try again in a few minutes.” **as a nameless loop**
- “Some numbers could not be read. Ask me again in a little while.” when views/orders **were** read
- “I cannot read the error log yet” as the **next move**
- “N orders waiting **for you**” when those are **Buddy’s** jobs
- Empty “Done” / “suggested next steps” with no steps
- “I can’t force the Auditor to start”
Internal constants may exist for tests. They must **not** be what the owner reads.
### 6.2 Required talk
- Every owner-visible reply is **thought** from this moment’s facts (Takeover, Kill, what went out, money, reads, this chat, 30-day winners, what just ran or blocked).
- “Hey” → one living line or one useful observation. Never two helpdesk greets.
- Plan: what, to what, what will go out, what stays for him.
- After work: what **actually** happened. Never claim a send/publish/change that did not happen.
- Brain fail: **which** brain, **why**, next brain or skip that piece.
- “Waiting for you” **only** for: publish a draft, make a product, pay, connect a channel, register device, approve a comment, copy a letter.
### 6.3 One send, one reply
The same words twice must not file two tickets or two brain calls. Disable send until the reply lands. No “has it done it?” five times.
### 6.4 Plan then go
- Short plan first.
- If he already said **do it now** / **don’t ask me what** / **go**, **run** (do not wait for a second plan cycle).
- “Do something” with Takeover On: pick the **best next act from facts** (example: nothing sent + recent article → pack and post connected; views collapsed → recovery **step one**), then do it, then tell.
---
## 7. Brains (thinking engines)
**Try order (code):** Gemini → Groq → NVIDIA → Cloudflare → OpenRouter → Hugging Face. Skip Cerebras, DeepSeek until the owner unlocks them. No GitHub Models as brains. No Bytez. No OpenAI/Anthropic as offered Keys.
**Bar:**
- **Test** = real one-line proof from that provider, not Saved.
- Walk the chain until **one answers**.
- Each failure: name + reason (refused / too slow / empty / unreadable).
- All dead: skip work that needs a brain; buzz; never the stamp loop.
- Keep model IDs **true to the provider’s current list**. A wrong model name is how you get ALL_FAILED with keys saved. The owner is on Google Pro / Gemini 3.8 Flash / Gemini 4 Argon in **Antigravity** for **coding**. That does **not** automatically mean the **site’s** Vault Gemini key or `brains.ts` `model` field is correct. Align `brains.ts` / `BUDDY_GEMINI_MODEL` with what the **site’s** Gemini API key can actually call. Do not print keys.
**Buddy vs coding Gemini:** this vision is for the **product** Buddy. Do not wire the owner’s Antigravity session into production. Production thinks through **Vault keys** on the server, never `VITE_` service role, never keys in chat.
---
## 8. Content engine (magazine)
### 8.1 Series
- **One** running series of connected guides.
- Each day Buddy may add the **next chapter draft**.
- At most **one extra** one-off the same day if a rival moved or numbers dipped.
- Quality gate: generic/off-voice → throw away, try **once**; still bad → **show nothing** to publish, say why.
- Voice: **read published articles first**. This magazine, not listicles, not hype, not fake expert. If it cannot match: say so, shorter skeleton for him to rewrite.
- If **he** writes: Buddy may suggest 1–2 cuts or a stronger title **in chat**. Never publishes.
- Working **title** on drafts; he can change before publish. **Live titles stay his.**
- One **honest meta line** on the draft. No stuffing. Live meta changes only when he publishes.
- Short **excerpt** + plain **slug** from the working title. **Live slug does not change later** (broken links).
- **One existing category**; may suggest **existing tags** only. No invented taxonomy. No tag spam.
- **Byline:** his **existing author**. No fake staff.
- **Reading time:** as the site already computes from body. Buddy does not invent minutes.
- **No embeds** (YouTube/TikTok) in Buddy drafts. He may paste in Admin. Packs may use a **Video look** clip; article **body** does not get random embeds.
- **No scheduled silent publish.** Buddy may **remind** (briefing/buzz) that a draft is waiting. He taps publish.
- Up to **three** ready unpublished drafts. He picks. No nag.
### 8.2 Publish path
A **good** draft appears in **Admin as unpublished** (title, body, category, working title, excerpt, slug, meta, collection). Chat tells him it is ready. He opens, fixes if he wants, **hits publish**. No copy-paste workflow. **Never auto-publish.**
### 8.3 Collection = series on the public site
**There is already a collection page. That is the series. Do not build a second series CMS.**
- When he says **yes** to a series name, Buddy uses (or asks him to pick) an **existing collection**.
- Buddy **assigns** the unpublished draft to that collection. He can change before publish.
- Buddy does **not** create a new collection unless he said yes to that name.
- Drafts **never** listed on the public collection page.
When a series **ends:** Buddy proposes **one** next series from winners + rivals, one line why, **waits for yes**. Weekly meeting repeats the proposal if unanswered.
### 8.4 Week with no publish
Keep the **archive** alive: connected channels still get **already published** pieces (Buddy chooses pace and text/image/video). Product list of 3 stays current. Next series draft may still be written. **Nothing new goes live** until he publishes.
### 8.5 Live article edits (narrow)
On a **live** piece, Takeover On, Auditor first, **tell him every time**:
- **1–2 sentences** to **place a product he already made**.
- And/or **1–2 links** to **his own** older published titles (not a rewrite, not a second related widget).
- If people **read** but **don’t click** a product: **one** better product sentence (one try). If still dead later: **brief** a different product for **him to make**.
- Title and the rest of the body stay as published.
- **Only he unpublishes.** Drip uses **live** pieces only. Taken-down pieces **must not** keep going out. Never delete.
### 8.6 Sharp editor + quality
Junk is not a draft. Empty Done is not strategy. Weekly meeting has **written steps**.
---
## 9. Shop
- Owner **creates** every product. Buddy writes **briefs** (name, USD, who it is for, which article). Standing list **max 3**. Includes: article with nothing to sell; line that looks dead (**no paid this week and last week**, not day one, **never delete**); variant/**bundle idea** of what already sold — **idea only**, **no variant rows** in this upgrade.
- **One product, one USD price** in this upgrade. No size/color variant system from Buddy.
- Buddy **places** owner-made products on articles (1–2 sentences, Auditor, tell).
- **At most one smart USD price change a day.** Auditor first. Never 0 / free / Naira. Pick the change most likely to help paid orders. Tell every time.
- **Never** auto discount, coupon, or $0. He may make a code in Admin. Buddy may say “worth a sale; you set it.”
- **Never** upload shop files. Brief may say “this should be a file.” He adds the file. Keep download-file as it is.
- **Buddy does not do shipping.** Never pretends a parcel went out.
- **Leave Flutterwave / checkout / receipts as they are.** No new payment provider. No checkout circus. USD only.
- **Refunds:** Admin only. Buddy **counts**. Never refunds.
- **Abandoned carts:** count + **at most one reminder draft a day** in Buddy. **He** sends. Never auto-email the person. Never dump items in a public log.
- **No product reviews** in this upgrade. Never write a review. Never reply as a buyer.
- **Winners first** in the shop via **existing featured** (Takeover On). He may **pin** one product (“pin this” **in Buddy chat**; changeable in Admin). Never delete. Never empty the front.
- After a **paid order:** **write it down for the weekly meeting.** Do **not** reshape the site the same day because of one sale.
---
## 10. Distribution (doors, packs, channels)
### 10.1 Connected = may go out
If a channel is **connected** and Takeover is On, Buddy **may post** after the plan (or after do-it-now), Auditor-safe, **tell every time**. This **includes** Instagram, TikTok, Facebook, Pinterest **if connected**. If **not** connected: copy **in this chat**, never claim it went out.
This **replaces** the old “four big apps always by hand” rule.
### 10.2 Buddy decides pace and format
The pick “owner types 1–4 on Connections” is **void**.
- Buddy decides **how often** and whether this send is **text, image, video, or a mix**, based on what is good for **that** channel (some are mostly text; sometimes image or clip when we **really have one**).
- Never a **fake** video. Never a **stolen** image.
- Same article **not** twice to the same channel in the **same week**.
- RSS / news-style doors: usually **one send per new published article**; drip old only when nothing new exists and it is honest.
- He **may** override a channel on Connections. Buddy does **not** wait for a number before it can send.
- **YouTube and podcast** stay **ordinary doors**, not a new studio.
### 10.3 Packs
- **Every newly published article** gets a pack (captions, thumbnail, clips **if** Video look is set).
- **He sets Video look once.** Buddy does not invent a new brand look. If look unset: captions + stills, **no fake video**.
- Old articles get packs only when nothing new went out (**drip**).
- Captions: **this magazine’s voice**, **few or no hashtags**, no stuffing.
- Sixteen free doors unchanged as the door **set**. No 21st door. No WhatsApp. No Feedly. No Make.com.
### 10.4 Pictures
- **Library / article image first.** **No automatic Pexels or stock.**
- Generate **only if this codebase already can**. Else **describe**, he uploads.
- Broken image URL: **say so**, he replaces. Do not auto-swap stock.
- Share card: **real title + picture already on that article**. No picture: title only.
- No return of dropped “HTML images / that website.”
### 10.5 Cadence vs spam
Quiet is allowed. Do not flood. Skip a failed channel; do not stop the whole morning.
---
## 11. Homepage, search, rails (use what exists — do not duplicate)
- **Winners first** uses **existing featured / editor’s pick**. No new homepage builder. No extra hero. **Pin** one article (chat “pin this”). Pin wins over winners.
- **Search: keep what already shipped** (typo-tolerant, articles and products, filters). The “titles only” lock is **void**. No fake hits. Do not strip search.
- **Related-articles rail: keep.** Buddy’s 1–2 own-links are **extra**, not a second widget.
- **Glossary / knowledge cards: leave.** No generated encyclopedia. Drafts may use terms that already exist; he adds terms.
- **Listen-to-article TTS: leave.** No paid voices. No new player. (Owner’s Antigravity Gemini is unrelated.)
- **Theme, offline, contrast, SW: leave.** Not a public reskin except winners-first/featured.
- **Reader personalisation / retention: leave.** Buddy is **not** a reader-AI. No new tracker. No login wall on articles.
- **Contact / presence: leave.** No reader chat widget. Never reply as the owner.
- **Consent/cookies: leave.** No generated legal.
- **Sitemap/robots/404: leave unless broken.** No SEO suite.
- **No UTM/ads dashboard.** Winners = views + paid orders, 30 days. Send log names the channel.
- **Health/Check/Sentry: leave.** Problems line = failed sends, Auditor blocks, dead brains — not a new monitor tab.
- **Check / backups / Team: leave.** Do not expand Team. Do not empty any bucket. Buddy does not run backups.
- **Reports and Changes: restyle.** No canned phrases, no function names, no frozen strings. Living plain words, **organised** (what went out, money, what needs him). Not today’s labelled skeleton. Empty Done is a fail.
---
## 12. Readers (never as the owner)
- Comments: **he approves**. Buddy **drafts** reply in chat. No extra spam-AI. No auto-kill comments. No comment **body** in mind logs.
- Form messages: **count**, not body, in operator logs. Suggested reply in Buddy if we treat them like comments; he sends.
- Weekly letter: from the **best already published** article, **in chat**, he copies. **Never** send the list.
- Cart reminder: he sends.
- **No AI replies to readers on the public site.**
---
## 13. Memory, rivals, weekly meeting, recovery
- Memory: **last 30 days** of titles, products, doors that got **views** or **paid orders**; last briefing; **this chat**. No reader bodies. Do not retell an unchanged spike (Quiet).
- Rivals: he pastes **public https** in **chat only**. **10 reads a day**, oldest unread first. Honest change line or nothing. No new Admin rivals screen. No IG/TikTok **private** insights. No paid search API.
- If a rival moved: may draft “we should publish X” in **this magazine’s voice**. Never copy them. Extra one-off draft only if the series rules allow.
- **Weekly meeting** in Buddy: what worked, what to publish, what to make, what to stop. **Written steps.** Sales feed **this**, not a same-day scramble.
- **Numbers fall hard:** diagnose from numbers **did** read; **one** recovery plan; if Takeover On, **start step one now** (e.g. pack strongest old article, post connected); buzz when that step ends. Not a recovery farm without the plan. Not “only tell” if Takeover is already On.
---
## 14. Notify
**Every live act:** phone buzz + log + briefing + night. Never claim a send that did not happen. Missing push: **honest skip once** + Guide to `/admin/settings` Register this device. **Do not nag** every briefing. Takeover does **not** require a phone. **Every** live act still buzzes when registered — no digest product that hides acts. Auditor blocks and all-brains-dead still buzz when away.
---
## 15. Out of this upgrade (do not sneak in)
- Extra Buddy looks, read-aloud expansion, premium TTS
- Generated law, privacy CMS, 22-tab Admin
- New homepage builder, new series page type, new related widget, new search product, new SEO suite, new YouTube studio
- Reviews, wishlist, follow, membership, login wall on articles
- Variants, auto discounts, shipping brain, ads/UTM dashboard, spend
- WhatsApp, Feedly, Make.com, n8n, extra action mind, GitHub Models as brains
- Silent publish, silent product insert, silent unpublish, silent list email
- Inventing article titles, product names, prices, or numbers not on the site
- Thousands-of-orders promises
- HTML-images website (dropped)
---
## 16. Safety that never moves
- No keys in chat. No Vault strings in chat. No service role in `VITE_`. Never empty the bucket.
- Admin upload stays Supabase as designed.
- USD public. Auditor blocks 0 / free / Naira.
- No country/city/timezone/local-currency **names** on screens.
- Owner still **makes** products and **publishes** articles.
- Buddy may say “worth it; you pay.”
---
## 17. How a coding agent should continue
### 17.1 Read first
1. This file.
2. Live `main` (not a stale sandbox). Important paths:
   - `supabase/functions/_shared/buddyThink.ts` — talk path, **system instruction that forbids acting**, canned run lines
   - `supabase/functions/_shared/buddyRouter.ts` — routing, `routedOrderLine`, restricted words including **post**
   - `supabase/functions/_shared/brainChain.ts` — `ALL_FAILED_LINE`
   - `supabase/functions/_shared/brains.ts` — model IDs
   - `supabase/functions/_shared/buddyBriefing.ts` — `nextMove`, “waiting for you”
   - `supabase/functions/_shared/mindPipeline.ts`, `morningClock.ts`, `mindActs.ts`, `doorPosts.ts`
   - Admin article editor, collections, featured, packs, Video look, Connections
3. `FEATURES.md` so you **do not rebuild** search, related rail, TTS, collections.
### 17.2 Order of work (do not skip)
**P0 — Make it a company, not a clerk**
1. Brains actually answer; honest named failures; Test = proof.
2. One send, one reply.
3. Takeover On + order in chat = **run now** (or start + buzz). Auditor **now** means run the check **now**.
4. Kill “waiting for you” for Buddy’s jobs. Kill nameless ALL_FAILED loop. Kill next-move-from-unread-error-log.
5. Strip owner-facing canned lines. Replies thought from facts. System instruction must **match this vision** (Buddy **does** post connected when Takeover On; it still never spends, never silent-publishes, never creates products).
6. Word **post/send/publish** in an owner order is **not** a blanket refuse: connected doors + gated copy in chat.
**P1 — Morning desk + packs + place + price + featured**
**P2 — Drafts into Admin unpublished, series = collections, quality gate, 3 ready, remind to publish**
**P3 — Reports/Changes restyle in living words; briefing honesty; weekly meeting with steps**
**P4 — Recovery step one; 30-day memory; rivals in chat; pin in chat**
Do **not** start P4 while P0 is red. A beautiful series engine on a clerk that cannot reach Gemini is cruelty.
### 17.3 Tests and discipline
- Fake brains, fake ports, no live keys in tests, no live door, no live push.
- Pass: Takeover Off → zero live ports. Takeover On → pack/door/place paths in **this turn**, not morning-only.
- Gated/unconnected: copy in payload, **no** send port.
- Spend / create product / rewrite whole live article / unpublish / list email: still blocked.
- Notify helper on a live door post.
- No new door, no WhatsApp, Takeover default **false**.
Migrations: **files** with “not applied” comments if the agent cannot apply; production apply is the owner’s Deploy workflow on `main`, not a surprise. Cron is already in the DB; do not double-schedule.
### 17.4 Language
Owner-facing: plain English. No em dash addiction in product copy if the codebase already forbids it. No “phase” talk in the app. No “I am an AI language model.”
---
## 18. What “done” looks like (acceptance story)
Owner opens Buddy after a day away, Takeover On:
- Briefing in **living organised words** (not a skeleton of labels): what went out (or honestly nothing), money and reads from numbers **read**, problems that are **real** (failed channel named, Auditor reason, brain named), **his** jobs only (publish this draft, make this product, register phone **once** if needed).
- Next move is **an act or a real block**, never “ask me again.”
- He says “audit the site now.” He gets **findings in that chat**, not a ticket.
- He says “do something.” Buddy **plans one line if needed**, **does** the next useful thing, **tells** what happened.
- He publishes a draft sitting in Admin → pack → connected channels get it in the right format → unconnected copy in chat → phone buzzes.
- Brains fail: “Gemini refused; Groq answered” or “all three dead, skipped captions, did not fake a post.”
- He is not asked which mind. He does not see Executioner. He does not paste drafts. He does not hunt “has it done it?”
- Twenty minutes: publish, maybe one product, done.
That is the company. Everything else in this file is detail so you do not “help” by building a farm, a clerk, or a second CMS.
---
## 19. Explicit reversals (so you do not honour dead rules)
| Old | Now |
|---|---|
| Four big apps always by hand | Post if **connected** |
| Owner types 1–4 per channel | **Buddy decides** pace and text/image/video |
| Search titles only | **Keep shipped search** |
| Chat files for next 08:00 run | **Do it now** when Takeover On |
| “Minds will not publish/send” blanket | **Send connected**; still no silent **article** publish |
| Never change USD prices | **One smart USD price / day**, Auditor, tell |
| Ask which mind | **Never**; one Buddy |
| Waiting for you = all orders | Only **his** jobs |
| Series = new page type | **Existing collection** |
| Type Connections boxes first | Do not wait |
---
## 20. Continue flag
If you are Gemini continuing this project: **P0 first.** Prove brains. Prove do-it-now. Prove honest talk. Then the morning desk and drafts-in-Admin. Work on current `main`. Do not merge from a sandbox that cannot push. Do not print secrets. Do not claim the site scaled until the owner can leave Takeover On for two weeks and only publish, make, and pay.
End of contract.
