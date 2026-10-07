# Admin super panel (M7) — RBAC, editors, settings, AI, security

The original owner account is the **ultra-super-admin**: it holds every capability, cannot be
suspended, demoted or removed, and only it can hand the founder flag to another account.
Everything else about "who may do what" is **rows in the database**; the UI only mirrors them.

```
admin_permissions ──┐
                    ├── role_permissions ── admin_roles ── app_admins ── auth.users
admin_permission_overrides ────────────────────────────────────┘   (status, is_founder)
```

## 1. Capabilities

`admin_permissions` is the catalogue (34 keys). `admin_can('key')` is the single authority —
every RLS policy, every RPC and every panel screen goes through it:

```sql
admin_can(perm) =
     is_admin()                       -- active row in app_admins, AAL2 when enrolled in 2FA
 AND ( admin_role() = 'owner'         -- owners hold everything implicitly
     OR override = 'grant'
     OR (role has the permission AND no override = 'deny') )
```

| Category | Keys |
|---|---|
| Editorial | `content.read` `content.write` `content.publish` `content.delete` |
| Moderation | `content.moderate` |
| Media | `media.read` `media.write` `media.delete` |
| Editorial ops | `taxonomy.manage` |
| Marketing | `collections.manage` `marketing.newsletter` `marketing.campaigns` |
| Analytics | `analytics.read` `analytics.export` |
| Commerce | `commerce.read` `commerce.write` `commerce.pricing` `commerce.refunds` |
| Settings | `settings.read` `settings.write` `settings.frontend` |
| Team | `team.read` `team.manage` `team.roles` |
| Security | `security.sessions` `audit.read` `audit.revert` |
| Operations | `ops.health` `ops.fix` `ops.backups` `ops.jobs` |
| Data | `data.explore` `data.write` `data.sql` |

Seeded roles: **owner** (all), **editor** (editorial + marketing, no commerce), **moderator**
(community only), **analyst** (read-only analytics/ops/data), **support** (orders, refunds,
community). Custom roles can be created from the panel; `owner`, `editor` and `moderator` keep
their names.

## 2. Invariants (enforced by triggers, not by the UI)

| Invariant | Where |
|---|---|
| At least one **active owner** must remain | `trg_admin_guard_last_owner` on `app_admins` |
| The **founder** cannot be suspended, demoted or deleted; only `admin_transfer_founder()` moves the flag | `trg_admin_protect_founder` + `admin_transfer_founder()` |
| Publishing/scheduling beyond `content.write` needs `content.publish` | `trg_guard_post_publish` on `posts` |
| The owner role can never lose a permission | `admin_set_role_permission()` |
| A role in use cannot be deleted | `admin_delete_role()` |
| Owners always hold everything (no override can weaken them) | `admin_set_override()` |

## 3. Team management (Admin → Team & access)

| Job | RPC | Needs |
|---|---|---|
| List members with effective permissions, overrides, last seen | `admin_team()` | `team.read` |
| Add / change a role by email | `set_admin_role(email, role)` | `team.manage` |
| Rename, suspend, restore, note | `admin_update_member(user_id, display_name, note, status)` | `team.manage` |
| Remove from the team | `remove_admin(user_id)` | `team.manage` |
| Force a re-login (drops `auth.sessions` + refresh tokens) | `admin_force_signout(user_id)` | `security.sessions` |
| Roles and the permission matrix | `admin_roles_overview()`, `admin_permission_catalogue()`, `admin_set_role_permission()`, `admin_create_role()`, `admin_update_role()`, `admin_delete_role()` | `team.read` / `team.roles` |
| Per-admin grant/deny | `admin_set_override(user_id, permission, effect)` | `team.roles` |
| Hand over the super admin | `admin_transfer_founder(user_id)` | founder only |

A new admin must have signed in once (magic link at `/account`) before they can be added,
because the panel resolves people through `auth.users`.

## 4. Audit trail (Admin → Activity log)

`admin_activity_log` records **who, when, from where, and the field-level before/after diff**
for every write to 43 admin-managed tables. Triggers write the rows, so no panel action can
skip one; money and team changes are `warning`/`critical` and the founder's own account is
`critical`. IP + user-agent come from the request headers; the actor comes from the JWT.

* `admin_audit_search(filters)` — free text over descriptions/labels/diff values, plus entity,
  action, severity, actor and date filters. Ordering is by `seq` (same-transaction rows share
  `now()`).
* `admin_audit_entry(id)` — one entry with the full `before`/`after`.
* `admin_audit_revert(id)` — needs `audit.revert`; restores `before` for 19 revertable tables,
  refuses when the row moved on since, and writes its own `revert` entry.
* `admin_prune_audit(days)` — `ops.fix`/`team.manage`; minimum 30 days; a weekly pg_cron job
  keeps 180 days by default.

## 5. Data explorer & SQL console (Admin → Data)

* `admin_table_catalog()` lists the explorable tables with columns, write flags, PII warnings
  and row estimates (`admin_explorable_tables`).
* Browsing, editing, inserting, deleting and CSV export run through **PostgREST as the signed-in
  admin**, so RLS decides what is visible and `data.write` decides whether it can be changed.
  Money rows (`orders`, `order_items`, `refund_requests`) are read/update only; `app_admins`,
  `admin_activity_log` and `user_profiles` are read-only by design.
* `admin_run_sql(sql, max_rows)` — needs `data.sql`. One `SELECT`/`WITH` statement, ≤ 20 000
  chars, function/keyword denylist, `statement_timeout = 5 s`, `default_transaction_read_only`,
  200-row cap. It runs as the caller, so RLS still applies.

## 6. Health, repairs, advisor and growth

* `admin_run_checks()` (~28 checks: database, security, email queue, commerce, content,
  moderation, search, backups, cron) writes `admin_health_checks` + a snapshot for the trend;
  `admin_health_overview()` returns the latest set.
* `admin_fix_issue(key)` (`ops.fix`) applies the safe repairs: `requeue_email`, `repair_images`,
  `backfill_seo`, `backfill_entitlements`, `take_backup`, `prune_audit`, `analyze`.
* `admin_suggestions()` returns ≤ 12 scored, permission-aware actions (impact, effort, route,
  optional fix); each row also declares the permission its button needs.
* `admin_growth_report(days)` bundles traffic, content pipeline, search demand, audience and
  commerce with previous-period comparisons.
* `admin_system_metrics()` gives size/cache/connections/table detail for scaling decisions.

## 7. Admin AI control room (Admin → Admin AI)

M7 adds a database-grounded automation queue rather than an un-audited model with direct
credentials:

* `admin_ai_scan()` turns the live health/growth facts into durable, prioritised suggestions.
* `admin_ai_auto_run()` can batch only the owner-enabled low-risk repairs (email requeue,
  image URL repair, SEO backfill and ANALYZE).
* `admin_ai_queue_workflow()` proposes approve, publish, reject or an allow-listed SEO edit;
  `admin_ai_draft_reply()` proposes a context-aware community reply. Neither publishes, edits
  or replies until `admin_ai_apply()` is explicitly approved.
* `admin_ai_dismiss()` records a decision, and AI runs/suggestions are trigger-audited.
  `admin.ai.run` and `admin.ai.approve` are separate capabilities; underlying publish,
  moderation, repair and content permissions are checked again at execution time.

The default policy is conservative: low-risk automation is off, and auto-publish/auto-reply
are permanently false in this release. An external language model, if added later, must sit
behind an authenticated edge function and may only create a proposal — never receive database
credentials or bypass the approval queue.

## 8. Admin AI Autopilot OS (Admin → Admin AI)

M8 expands the M7 queue into a policy-driven operating system. The control tower has tabs for
Overview, Agents, Missions, Action queue, Workflows, Experiments, AI memory, Incidents and
Settings. It is usable without a paid model: deterministic agents inspect live rows and create
proposals; a future model may be selected as `edge_provider` only after an authenticated edge
function is added.

* Seven agents are seeded: growth, SEO, content, commerce, community, reliability and security.
  Each has its own enable switch, cadence, action cap and autonomy level.
* Missions define an objective, metric, priority, deadline and agent team. Workflows compose agent
  steps and can be manually enabled and run. Jobs, idempotency keys and metrics persist in the DB.
* The action queue records risk, required capability, proposal, before/after payload, approval,
  execution and failure state. Only the allow-listed low-risk reliability repairs can auto-apply.
* The owner can set the global autopilot, daily budget, provider mode and emergency kill switch.
  Publish, edit, reply, commerce, experiments, permissions and security work remain approval-gated.
* Durable memory stores brand/editorial/SEO/commerce/community rules. Experiments store variants,
  impressions, conversions and value. Incidents and notifications provide an auditable safety loop.

The M8 RPCs are `admin_ai_control_tower`, `admin_ai_run_autopilot`, `admin_ai_run_agent`,
`admin_ai_execute_autonomous`, `admin_ai_set_autopilot`, `admin_ai_set_agent`,
`admin_ai_create_mission`, `admin_ai_create_workflow`, `admin_ai_run_workflow`,
`admin_ai_decide_action`, `admin_ai_upsert_memory`, `admin_ai_create_experiment`,
`admin_ai_record_experiment_event` and `admin_ai_resolve_incident`. Every mutation re-checks
RBAC server-side and is trigger-audited.

## 8.1 Admin AI Predictive Control Centre (Admin → Admin AI)

M10 adds event-driven, predictive and self-reviewing operation without changing the M8/M9 safety
contract. The new Admin AI tabs are Predictive, Events, Digital twin, Debate & trust, Maintenance,
Lifecycle, AI security and Learning.

* `admin_ai_record_event()` and `admin_ai_process_events()` provide an idempotent event stream for
  traffic drops, checkout failures, cart abandonment, article publication, broken links, prompt
  injection, secret exposure and permission anomalies. Events create incidents, maintenance tasks
  or approval queue proposals; they do not mutate public content or payment state.
* `admin_ai_refresh_digital_twin()` records aggregate content, commerce, subscriber, lifecycle and
  AI-operation facts. `admin_ai_generate_forecasts()` and `admin_ai_scan_anomalies()` create
  deterministic, review-state forecasts and notifications from recent observations.
* `admin_ai_debate_queue()` runs security, growth and content reviews over queued proposals and
  records confidence, evidence and trust scores. Critical proposals are paused for review.
* `admin_ai_reindex_knowledge()` now indexes published articles and products. The knowledge graph,
  stale-source maintenance tasks and post-publication checks remain reviewable before any edit.
* `admin_ai_refresh_lifecycle()` stores only aggregate lifecycle snapshots. `admin_ai_run_security_sweep()`
  quarantines possible secrets, prompt injection and suspicious permission signals. `admin_ai_learn_from_outcomes()`
  recommends policy changes but cannot change its own permissions or autonomy.
* `admin_ai_replay_command()` makes a previous command reproducible while retaining the original
  command link. All M10 rows are RLS-protected and trigger-audited.

The M10 RPCs are `admin_ai_refresh_predictive`, `admin_ai_refresh_digital_twin`,
`admin_ai_generate_forecasts`, `admin_ai_scan_anomalies`, `admin_ai_debate_queue`,
`admin_ai_refresh_knowledge_graph`, `admin_ai_generate_maintenance_tasks`,
`admin_ai_refresh_lifecycle`, `admin_ai_run_security_sweep`, `admin_ai_learn_from_outcomes`,
`admin_ai_decide_maintenance`, and `admin_ai_resolve_security_finding`. The default provider remains
`rules`; external providers must remain authenticated edge-function integrations that can only
create proposals.

## 8.2 Operations agents and per-agent status, transcript and incidents (Admin → Admin AI → Agents)

The six operations roles — **Analyst, Strategist, CEO, Auditor, Executioner and Chief of Staff** —
extend the M7–M10 model rather than replacing it. They share the existing `admin_ai_agents`, jobs,
action queue, events, approvals, critic and audit paths, and they seed **disabled and
suggestion-only**. The five read-only roles produce deterministic aggregate briefs only (the Analyst
reads server-side metrics; the others summarise missions, queue counts and governance counts), so
no browser-supplied sales figure is ever accepted and no unavailable business metric is invented.
Executioner is limited to its own owner-approved `analyze` rows and never publishes to a channel.

Each agent card in the Agents tab now shows a status strip and a transcript, both read from the
server. Nothing here is estimated in the browser:

* **Last run / Next run** come from the recorded timestamps, and **Schedule** states one of
  `Scheduled`, `Due now`, `No next run yet` or `Paused — will not run`. A disabled agent always reads
  Paused, even if a stale timestamp exists. **Last 24h** shows the run count and how many proposals
  are still queued; failed runs (7 days) and open incidents appear only when they are non-zero.
* **Transcript & incidents** loads on demand (`admin_ai_agent_transcript`, at most 25 runs, default
  10). Each run shows its status, when it happened, how many proposals it created, its duration and
  any error text, plus the incidents recorded against that specific run. A failed run is never
  displayed as a success.
* **Incident controls** reuse the existing `admin_ai_resolve_incident` RPC from the card:
  **Acknowledge** stamps the acknowledgement, **Resolve** records the resolution, the owner who made
  the decision and a time. A resolved incident leaves the open count but stays in the transcript as
  history. Both controls require `admin.ai.incidents`, so a reviewer without it can read the history
  but not change it — and a refused control reports the refusal instead of appearing to succeed.

Status and transcript reads require `admin.ai.reports`, match the existing control-tower gate, and
are scoped to a single agent: a transcript can only return that agent's own jobs. The per-agent read
model adds **no new table**, makes no provider call and changes no existing M7–M10 behavior.

### 8.2.1 Analyst measured metrics (Admin → Admin AI → Action queue)

The Analyst brief is built by `analyst_metrics(window_days)` (default 30, clamped to 1–365) over the
tables that actually record events, and it is written to the queued `analytics_brief` action so the
readable summary appears as the action detail and the full object appears under the action's
`proposed` payload. Opening it from the Action queue always requires `admin.ai.reports`.

Measured sections, each naming its real source table:

| Section | Source | What it reports |
|---|---|---|
| `article_views` | `article_views` | total views, articles viewed, top 5 articles by views |
| `search` | `search_history` | total searches, distinct queries, top 5 queries (queries containing `@` are excluded and text is truncated to 60 characters) |
| `orders` | `orders`, `order_items`, `refund_requests` | paid orders only, revenue and average order value per currency, top products by revenue, refund requests |
| `email` | `email_queue` | queued, sent, failed and skipped counts plus the top kinds — queue records, not provider readback |
| `channels` | `distribution_metric_samples` | per-channel metrics with `measured` and `estimated` **kept separate**, each carrying its `collection_basis` |
| `conversions` | derived | paid orders per 1,000 recorded views, explicitly labelled a coarse ratio rather than a tracked funnel |

**Honest gaps are part of the output.** A section with no rows in the window reports
`available: false` plus an `unavailable_reason` (never a zero that looks measured), and seven metrics
that nothing records are always listed as unavailable with a reason: `email.open_rate`,
`email.click_rate`, `search.zero_result_rate`, `article.avg_time_on_page`, `traffic.unique_visitors`,
`checkout.conversion_funnel` and `channel.provider_readback`. Recommendations are emitted only when
the measured numbers support them, and each carries the exact `basis` figures plus the metric keys it
came from — for example `"Measured article" recorded 9 of 10 views (90.0%) in the last 30 days`.

The agents' own `admin_ai_metrics` counters are still included, under `ai_metric_aggregates`, so
nothing that was previously visible was removed.

### 8.2.2 Grounded strategy, CEO decisions, the independent Auditor and approved dispatch

The four executive roles now produce grounded, reviewable work instead of static snapshots. Every
step stays suggestion-only, approval-gated and free of external publishing.

* **Strategist — grounded experiment proposal.** The Strategist reads the measured metrics
  (`analyst_metrics`, §8.2.1) and proposes an experiment only when a measured signal crosses the
  grounding threshold: a repeated search term (3+ hits in 30 days) or one article carrying 25%+ of
  measured views. The proposal carries its `basis` sentence, the `metric_keys` behind it and the
  signal object; the experiment is created as a **draft** with two variants and guardrails
  (`traffic_percent` 50, `no_paid_spend`, `max_duration_days` 30, `external_publishing` false). One
  open experiment per hypothesis — a second run never duplicates the study, and when nothing is
  grounded the brief says so explicitly instead of inventing a target.
* **CEO — one decision per run.** If a grounded draft experiment is waiting, the CEO raises exactly
  one action (`experiment_start`, target = that experiment, permission `admin.ai.approve`) that also
  carries the whole operating scorecard under `proposed.scorecard`. Otherwise it raises the
  scorecard. Nothing starts without the owner approving **and** dispatching it.
* **Auditor — independent review that can block.** `admin_ai_audit_action` records a verdict
  (`clear` / `concern` / `blocked`) for each proposal with the proposer, the reviewer, the criteria
  and the findings. The Auditor can never review its own proposal, and it reviews every boardroom
  agent's queued or approved work. Blocks come from evidence-based criteria: an empty proposal, a
  claim with no `basis`/`metric_keys`, a critical-risk action, a health claim, and three
  **non-overridable** hard blocks — possible credential exposure, any external publishing/sending
  action type, and `auto_apply` on a boardroom agent.
* **A block holds.** A blocked proposal is paused and cannot be executed or dispatched. The only
  release is `admin_ai_override_block` with a **written reason of at least 10 characters**, recorded
  with who wrote it and when; hard blocks cannot be overridden at all. The owner then approves the
  proposal normally.
* **Approved dispatch, never publishing.** `admin_ai_dispatch_approved` requires an owner-approved
  action and dispatches only three allow-listed types: `analyze` (the existing executor), 
  `experiment_start` (sets the experiment to running — internal state only) and `channel_prepare`
  (creates or refreshes a **pending** draft in `automation_distribution_drafts` with its SHA-256
  payload hash, for the owner to approve in the Daily Kit). It refuses everything else, so there is
  no automation path that publishes, sends, emails or campaigns; the kill switch stops `analyze` and
  `experiment_start` dispatches.
* **Chief of Staff — linked digest.** The digest carries `links`, one item per thing that needs the
  owner: actions (with their latest Auditor verdict and what each needs), open experiments and open
  incidents, each with the record's id. It states that it sends nothing externally.
* **CEO — proposed re-dating of your Lagos queue (V8).** When no experiment is awaiting a
  decision, the CEO reads the next 14 Lagos days against the same two-a-day counter the
  scheduling guard uses. If one day holds two articles while another is empty, it proposes moving
  the **least-visited** item (fewest measured views in 30 days, newest first on a tie) into the
  earliest empty day at that item's own clock time — one reason per move, the measured basis
  attached and the limits stated in the payload: `max_moves`, `capacity_per_day: 2`, the window,
  future-only, published untouched, content untouched, status untouched, owner-apply-only. With
  nothing to spread it stays the aggregate scorecard, so the CEO still raises exactly one action
  per run. A re-dating moves `scheduled_at`/`published_at` together through the owner's own
  calendar path and queued intake items through the same capacity counter; article text, article
  status and every published article are never touched, the Auditor hard-blocks any move against a
  non-scheduled or published article or any field outside the re-dating contract, and
  `admin_ai_execute_action` does not know the action type, so nothing automatic can move a date.
  The owner presses **Apply schedule** in the action queue; the apply honours the Auditor's block
  gate and the kill switch and refuses a stale proposal.
* **In the control room** (Admin → Admin AI → Action queue) each action now shows its decision note
  (which is where an Auditor block reason appears), an optional note field, and — for owners with
  `admin.ai.approve` — a **Dispatch** button on approved allow-listed actions and an
  **Override block** button on Auditor-blocked ones. A reviewer without that permission sees none of
  those controls.

## 9. Front end as data (Admin → Front end)

`site_settings` public rows drive the storefront without a deploy: `nav_menu`, `footer`,
`homepage` (section order + visibility), `theme` (accent pair), `seo_defaults`, `redirects`,
`custom_head`, `flags`, `announcement`, `maintenance`. Writes go through
`admin_set_setting(key, value, is_public)` which validates shape and requires
`settings.frontend` (or `settings.write` for non-front-end keys); `admin_reset_setting(key)`
restores the shipped default. The reader side reads everything in one `site_config()` call
(`src/hooks/useSiteConfig.ts` → `SiteConfigEffects`, Header, Footer, HomePage, SEO).

## 10. Local verification

```bash
/usr/bin/env python3 -m venv /home/user/.venv && /home/user/.venv/bin/pip install pgserver
/home/user/.venv/bin/python scripts/db-test.py          # 38 migrations + assertion suites
npx tsc --noEmit -p tsconfig.app.json && npm test && npm run build
node scripts/size-budget.mjs && npm run audit:contrast
```

`scripts/admin-assertions.sql` proves the model at the database level: editors cannot read
orders, moderators cannot publish or reach backups, suspended admins lose everything, the
founder cannot be demoted, the last owner cannot be removed, `deny` beats a role grant, the SQL
console refuses writes, and the audit log records diffs with actor/IP and can be reverted.
