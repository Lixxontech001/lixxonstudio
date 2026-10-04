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

## 8. Front end as data (Admin → Front end)

`site_settings` public rows drive the storefront without a deploy: `nav_menu`, `footer`,
`homepage` (section order + visibility), `theme` (accent pair), `seo_defaults`, `redirects`,
`custom_head`, `flags`, `announcement`, `maintenance`. Writes go through
`admin_set_setting(key, value, is_public)` which validates shape and requires
`settings.frontend` (or `settings.write` for non-front-end keys); `admin_reset_setting(key)`
restores the shipped default. The reader side reads everything in one `site_config()` call
(`src/hooks/useSiteConfig.ts` → `SiteConfigEffects`, Header, Footer, HomePage, SEO).

## 9. Local verification

```bash
/usr/bin/env python3 -m venv /home/user/.venv && /home/user/.venv/bin/pip install pgserver
/home/user/.venv/bin/python scripts/db-test.py          # 34 migrations + 8 assertion suites
npx tsc --noEmit -p tsconfig.app.json && npm test && npm run build
node scripts/size-budget.mjs && npm run audit:contrast
```

`scripts/admin-assertions.sql` proves the model at the database level: editors cannot read
orders, moderators cannot publish or reach backups, suspended admins lose everything, the
founder cannot be demoted, the last owner cannot be removed, `deny` beats a role grant, the SQL
console refuses writes, and the audit log records diffs with actor/IP and can be reverted.
