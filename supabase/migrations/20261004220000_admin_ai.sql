/*
# M7 · Admin AI control room

This is a database-grounded automation layer, not a hidden superuser. It turns the
existing health/growth signals into durable, reviewable suggestions and safe jobs:

* scans reuse `admin_suggestions()` so recommendations are based on live rows;
* low-risk repairs can be batched through `admin_ai_auto_run()`;
* publish, edit and reply actions are proposed first and require an explicit approval;
* every action is permission-checked twice (AI capability and the underlying capability),
  trigger-audited, and stored with its result;
* an optional provider can be put behind an edge function later without granting an
  external model database credentials.
*/

-- =====================================================================
-- 1. AI permissions and durable queue
-- =====================================================================
INSERT INTO admin_permissions (key, label, description, category, is_dangerous, sort_order) VALUES
  ('admin.ai.run',    'Run Admin AI',    'Scan the site, create grounded suggestions and draft safe actions.', 'Operations', false, 275),
  ('admin.ai.approve','Approve Admin AI','Apply AI suggestions, including content workflow and moderation actions.', 'Operations', true, 276)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, category = EXCLUDED.category,
  is_dangerous = EXCLUDED.is_dangerous, sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, permission)
VALUES ('owner', 'admin.ai.run'), ('owner', 'admin.ai.approve')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('scan', 'auto_fix', 'draft_reply', 'workflow')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  requested_by uuid,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
ALTER TABLE admin_ai_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('fix', 'growth', 'content', 'reply', 'workflow')),
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  risk text NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high')),
  permission text,
  action_route text,
  action_label text,
  fix_key text,
  target_type text,
  target_id uuid,
  proposed jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'dismissed', 'applied', 'failed')),
  result jsonb,
  created_by uuid,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  applied_at timestamptz
);
ALTER TABLE admin_ai_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_ai_runs_read ON admin_ai_runs;
CREATE POLICY admin_ai_runs_read ON admin_ai_runs FOR SELECT TO authenticated
  USING (admin_can('admin.ai.run'));
DROP POLICY IF EXISTS admin_ai_suggestions_read ON admin_ai_suggestions;
CREATE POLICY admin_ai_suggestions_read ON admin_ai_suggestions FOR SELECT TO authenticated
  USING (admin_can('admin.ai.run'));
-- No direct client INSERT/UPDATE/DELETE policies: all queue mutations go through the
-- SECURITY DEFINER functions below, which perform the same capability checks.

DO $$ BEGIN
  IF to_regclass('public.admin_activity_log') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_admin_ai_runs ON admin_ai_runs;
    CREATE TRIGGER trg_audit_admin_ai_runs AFTER INSERT OR UPDATE OR DELETE ON admin_ai_runs
      FOR EACH ROW EXECUTE FUNCTION audit_admin_change();
    DROP TRIGGER IF EXISTS trg_audit_admin_ai_suggestions ON admin_ai_suggestions;
    CREATE TRIGGER trg_audit_admin_ai_suggestions AFTER INSERT OR UPDATE OR DELETE ON admin_ai_suggestions
      FOR EACH ROW EXECUTE FUNCTION audit_admin_change();
  END IF;
END $$;

-- =====================================================================
-- 2. Grounded scan
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_ai_scan()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  run_id uuid := gen_random_uuid();
  item jsonb;
  v_key text;
  v_kind text;
  v_risk text;
  v_id uuid;
  total integer := 0;
BEGIN
  IF NOT admin_can('admin.ai.run') THEN RAISE EXCEPTION 'forbidden'; END IF;

  INSERT INTO admin_ai_runs (id, kind, requested_by) VALUES (run_id, 'scan', auth.uid());

  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(admin_suggestions(), '[]'::jsonb)) LOOP
    v_key := md5(COALESCE(item ->> 'fix_key', '') || ':' || COALESCE(item ->> 'title', '') || ':' || COALESCE(item ->> 'action_route', ''));
    v_kind := CASE WHEN COALESCE(item ->> 'fix_key', '') <> '' THEN 'fix' ELSE 'growth' END;
    v_risk := CASE WHEN COALESCE(item ->> 'fix_key', '') IN ('requeue_email', 'repair_image_urls', 'backfill_seo', 'analyze') THEN 'low' ELSE 'medium' END;

    INSERT INTO admin_ai_suggestions (
      fingerprint, kind, title, detail, priority, risk, permission, action_route, action_label,
      fix_key, proposed, created_by
    ) VALUES (
      v_key, v_kind, COALESCE(item ->> 'title', 'Admin AI suggestion'), COALESCE(item ->> 'detail', ''),
      LEAST(100, GREATEST(0, COALESCE((item ->> 'score')::integer, 0))), v_risk,
      NULLIF(item ->> 'permission', ''), NULLIF(item ->> 'action_route', ''), NULLIF(item ->> 'action_label', ''),
      NULLIF(item ->> 'fix_key', ''),
      jsonb_build_object('source', item, 'run_id', run_id), auth.uid()
    )
    ON CONFLICT (fingerprint) DO UPDATE SET
      detail = EXCLUDED.detail, priority = EXCLUDED.priority, risk = EXCLUDED.risk,
      permission = EXCLUDED.permission, action_route = EXCLUDED.action_route,
      action_label = EXCLUDED.action_label,
      proposed = admin_ai_suggestions.proposed || jsonb_build_object('last_scan', run_id),
      -- dismissed/applied are deliberate human decisions and must not reopen themselves
      status = CASE WHEN admin_ai_suggestions.status IN ('dismissed', 'applied') THEN admin_ai_suggestions.status ELSE 'open' END;
    total := total + 1;
  END LOOP;

  UPDATE admin_ai_runs
     SET status = 'completed', summary = jsonb_build_object('suggestions', total), finished_at = now()
   WHERE id = run_id;
  RETURN jsonb_build_object('run_id', run_id, 'suggestions', total);
EXCEPTION WHEN others THEN
  UPDATE admin_ai_runs SET status = 'failed', error = SQLERRM, finished_at = now() WHERE id = run_id;
  RAISE;
END $$;

-- A scan plus the allow-listed, non-destructive repairs. It never publishes, edits
-- content, sends email, or replies automatically.
CREATE OR REPLACE FUNCTION admin_ai_auto_run()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  run_id uuid := gen_random_uuid();
  s admin_ai_suggestions;
  n integer := 0;
  result jsonb;
  policy jsonb;
BEGIN
  IF NOT admin_can('admin.ai.run') OR NOT admin_can('ops.fix') THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM admin_ai_scan();
  INSERT INTO admin_ai_runs (id, kind, requested_by) VALUES (run_id, 'auto_fix', auth.uid());
  SELECT value INTO policy FROM site_settings WHERE key = 'ai_policy';
  IF COALESCE((policy ->> 'auto_fix_low_risk')::boolean, false) IS NOT TRUE THEN
    UPDATE admin_ai_runs SET status = 'completed', summary = jsonb_build_object('applied', 0, 'skipped', 'auto_fix_low_risk is disabled'), finished_at = now() WHERE id = run_id;
    RETURN jsonb_build_object('run_id', run_id, 'applied', 0, 'skipped', true);
  END IF;

  FOR s IN
    SELECT * FROM admin_ai_suggestions
     WHERE status = 'open' AND risk = 'low'
       AND fix_key IN ('requeue_email', 'repair_image_urls', 'backfill_seo', 'analyze')
     ORDER BY priority DESC LIMIT 20
  LOOP
    BEGIN
      result := admin_fix_issue(s.fix_key);
      UPDATE admin_ai_suggestions SET status = 'applied', result = result, reviewed_by = auth.uid(), reviewed_at = now(), applied_at = now()
       WHERE id = s.id;
      n := n + 1;
    EXCEPTION WHEN others THEN
      UPDATE admin_ai_suggestions SET status = 'failed', result = jsonb_build_object('error', SQLERRM), reviewed_by = auth.uid(), reviewed_at = now()
       WHERE id = s.id;
    END;
  END LOOP;

  UPDATE admin_ai_runs SET status = 'completed', summary = jsonb_build_object('applied', n), finished_at = now() WHERE id = run_id;
  RETURN jsonb_build_object('run_id', run_id, 'applied', n);
EXCEPTION WHEN others THEN
  UPDATE admin_ai_runs SET status = 'failed', error = SQLERRM, finished_at = now() WHERE id = run_id;
  RAISE;
END $$;

-- =====================================================================
-- 3. Human-approved workflow and moderation actions
-- =====================================================================
CREATE OR REPLACE FUNCTION admin_ai_queue_workflow(p_post_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p posts;
  id uuid;
  v_action text := lower(trim(COALESCE(p_action, '')));
BEGIN
  IF NOT admin_can('admin.ai.run') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_action NOT IN ('approve', 'publish', 'reject', 'edit') THEN RAISE EXCEPTION 'unsupported workflow action'; END IF;
  SELECT * INTO p FROM posts WHERE posts.id = p_post_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article not found'; END IF;
  INSERT INTO admin_ai_suggestions (
    fingerprint, kind, title, detail, priority, risk, permission, target_type, target_id, proposed, created_by
  ) VALUES (
    md5('workflow:' || p_post_id::text || ':' || v_action || ':' || COALESCE(p_note, '')),
    'workflow', initcap(v_action) || ' article: ' || p.title,
    CASE v_action WHEN 'edit' THEN 'The AI has queued an editorial edit for review; no text is changed until an owner approves it.' ELSE 'The AI proposes this workflow transition; nothing is published until an authorised admin approves it.' END,
    CASE WHEN v_action = 'publish' THEN 90 ELSE 70 END, CASE WHEN v_action = 'publish' THEN 'high' ELSE 'medium' END,
    CASE WHEN v_action IN ('approve', 'publish') THEN 'content.publish' ELSE 'content.write' END,
    'posts', p_post_id,
    jsonb_build_object(
      'action', v_action, 'post_id', p_post_id, 'note', NULLIF(btrim(COALESCE(p_note, '')), ''), 'title', p.title,
      'patch', CASE WHEN v_action = 'edit' THEN jsonb_build_object(
        'seo_title', COALESCE(NULLIF(btrim(p.seo_title), ''), left(p.title, 60)),
        'seo_description', COALESCE(NULLIF(btrim(p.seo_description), ''), left(COALESCE(NULLIF(btrim(p.excerpt), ''), regexp_replace(COALESCE(p.content, ''), '\s+', ' ', 'g')), 155))
      ) ELSE '{}'::jsonb END
    ), auth.uid()
  )
  ON CONFLICT (fingerprint) DO UPDATE SET status = CASE WHEN admin_ai_suggestions.status = 'applied' THEN 'applied' ELSE 'open' END,
    proposed = EXCLUDED.proposed, detail = EXCLUDED.detail
  RETURNING admin_ai_suggestions.id INTO id;
  RETURN id;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_draft_reply(p_comment_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c comments;
  id uuid;
  body text;
BEGIN
  IF NOT admin_can('admin.ai.run') OR NOT admin_can('content.moderate') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO c FROM comments WHERE comments.id = p_comment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comment not found'; END IF;
  body := CASE
    WHEN lower(COALESCE(c.content, '')) ~ '(where|how).*(buy|shop|purchase)' THEN 'Thanks for asking. The article links to the relevant edit, and our team can help if you still cannot find what you need.'
    WHEN lower(COALESCE(c.content, '')) ~ '(love|helpful|thank)' THEN 'Thank you for reading and for taking the time to share this. We are glad the guide was useful.'
    ELSE 'Thanks for joining the conversation. We appreciate you reading and will keep this in mind for a future guide.'
  END;
  INSERT INTO admin_ai_suggestions (
    fingerprint, kind, title, detail, priority, risk, permission, target_type, target_id, proposed, created_by
  ) VALUES (
    md5('reply:' || p_comment_id::text), 'reply', 'Draft a reply to ' || COALESCE(c.author_name, 'reader'),
    'A suggested reply is ready. It will not be posted until a moderator approves it.', 55, 'medium', 'content.moderate',
    'comments', p_comment_id, jsonb_build_object('action', 'reply', 'comment_id', p_comment_id, 'body', body), auth.uid()
  )
  ON CONFLICT (fingerprint) DO UPDATE SET status = CASE WHEN admin_ai_suggestions.status = 'applied' THEN 'applied' ELSE 'open' END,
    proposed = EXCLUDED.proposed, detail = EXCLUDED.detail
  RETURNING admin_ai_suggestions.id INTO id;
  RETURN id;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_apply(p_suggestion_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s admin_ai_suggestions;
  a text;
  post_id uuid;
  comment_id uuid;
  reply_id uuid;
  msg text;
BEGIN
  IF NOT admin_can('admin.ai.approve') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO s FROM admin_ai_suggestions WHERE id = p_suggestion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI suggestion not found'; END IF;
  IF s.status NOT IN ('open', 'approved') THEN RAISE EXCEPTION 'Suggestion is already %', s.status; END IF;

  IF s.kind = 'fix' AND s.fix_key IS NOT NULL THEN
    IF NOT admin_can('ops.fix') THEN RAISE EXCEPTION 'The underlying repair needs ops.fix'; END IF;
    msg := admin_fix_issue(s.fix_key);
  ELSIF s.kind = 'workflow' THEN
    a := s.proposed ->> 'action';
    post_id := NULLIF(s.proposed ->> 'post_id', '')::uuid;
    IF a IN ('approve', 'publish') THEN
      IF NOT admin_can('content.publish') THEN RAISE EXCEPTION 'Publishing needs content.publish'; END IF;
      msg := admin_approve_post(post_id, a = 'publish', s.proposed ->> 'note');
    ELSIF a = 'reject' THEN
      IF NOT (admin_can('content.publish') OR admin_can('content.write')) THEN RAISE EXCEPTION 'Rejecting needs content.write'; END IF;
      msg := admin_reject_post(post_id, COALESCE(NULLIF(s.proposed ->> 'note', ''), 'AI review requested changes'));
    ELSIF a = 'edit' THEN
      IF NOT admin_can('content.write') THEN RAISE EXCEPTION 'Editing needs content.write'; END IF;
      -- AI edits are intentionally patch-based and allow-listed. A blank patch is a
      -- review task, never a licence for arbitrary SQL or arbitrary columns.
      IF jsonb_typeof(s.proposed -> 'patch') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'This AI edit has no approved patch'; END IF;
      UPDATE posts SET title = COALESCE(NULLIF(s.proposed #>> '{patch,title}', ''), title),
                       excerpt = COALESCE(s.proposed #>> '{patch,excerpt}', excerpt),
                       seo_title = COALESCE(s.proposed #>> '{patch,seo_title}', seo_title),
                       seo_description = COALESCE(s.proposed #>> '{patch,seo_description}', seo_description),
                       focus_keyword = COALESCE(s.proposed #>> '{patch,focus_keyword}', focus_keyword),
                       last_edited_by = auth.uid()
       WHERE id = post_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Article not found'; END IF;
      msg := 'editorial patch applied';
    ELSE
      RAISE EXCEPTION 'Unsupported AI workflow';
    END IF;
  ELSIF s.kind = 'reply' THEN
    IF NOT admin_can('content.moderate') THEN RAISE EXCEPTION 'Replying needs content.moderate'; END IF;
    comment_id := NULLIF(s.proposed ->> 'comment_id', '')::uuid;
    IF length(btrim(COALESCE(s.proposed ->> 'body', ''))) < 2 THEN RAISE EXCEPTION 'Reply is empty'; END IF;
    SELECT post_id INTO post_id FROM comments WHERE id = comment_id;
    IF post_id IS NULL THEN RAISE EXCEPTION 'Comment not found'; END IF;
    INSERT INTO comments (post_id, parent_id, author_name, author_email, content, is_visible, is_approved, admin_reply)
    VALUES (post_id, comment_id, COALESCE(auth.jwt() ->> 'name', 'Lixxon Studio'), COALESCE(auth.jwt() ->> 'email', 'admin@lixxonstudio.com'), btrim(s.proposed ->> 'body'), true, true, true)
    RETURNING id INTO reply_id;
    msg := 'reply posted';
  ELSE
    RAISE EXCEPTION 'Unsupported AI suggestion';
  END IF;

  UPDATE admin_ai_suggestions SET status = 'applied', result = jsonb_build_object('message', msg), reviewed_by = auth.uid(), reviewed_at = now(), applied_at = now()
   WHERE id = s.id;
  RETURN jsonb_build_object('ok', true, 'message', msg, 'suggestion_id', s.id);
END $$;

CREATE OR REPLACE FUNCTION admin_ai_dismiss(p_suggestion_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT admin_can('admin.ai.approve') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE admin_ai_suggestions SET status = 'dismissed', reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = p_suggestion_id AND status = 'open';
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION admin_ai_set_policy(p_auto_fix_low_risk boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT admin_can('admin.ai.approve') THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO site_settings (key, value, is_public, updated_at)
  VALUES ('ai_policy', jsonb_build_object('auto_fix_low_risk', COALESCE(p_auto_fix_low_risk, false), 'auto_publish', false, 'auto_reply', false), false, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_public = false, updated_at = now();
  RETURN (SELECT value FROM site_settings WHERE key = 'ai_policy');
END $$;

CREATE OR REPLACE FUNCTION admin_ai_control_room()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT admin_can('admin.ai.run') THEN '{}'::jsonb ELSE jsonb_build_object(
    'suggestions', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.priority DESC, s.created_at DESC) FROM admin_ai_suggestions s WHERE s.status = 'open'), '[]'::jsonb),
    'recent_runs', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.started_at DESC) FROM (SELECT * FROM admin_ai_runs ORDER BY started_at DESC LIMIT 10) r), '[]'::jsonb),
    'policy', COALESCE((SELECT value FROM site_settings WHERE key = 'ai_policy'), '{"auto_fix_low_risk": false}'::jsonb)
  ) END;
$$;

-- Defaults are opt-in. A future cron/edge invocation can call auto_run only after an
-- owner explicitly enables it; the function itself still uses its allow-list.
INSERT INTO site_settings (key, value, is_public) VALUES
  ('ai_policy', '{"auto_fix_low_risk": false, "auto_publish": false, "auto_reply": false}'::jsonb, false)
ON CONFLICT (key) DO NOTHING;

REVOKE ALL ON FUNCTION admin_ai_scan() FROM public;
REVOKE ALL ON FUNCTION admin_ai_auto_run() FROM public;
REVOKE ALL ON FUNCTION admin_ai_queue_workflow(uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION admin_ai_draft_reply(uuid) FROM public;
REVOKE ALL ON FUNCTION admin_ai_apply(uuid) FROM public;
REVOKE ALL ON FUNCTION admin_ai_dismiss(uuid) FROM public;
REVOKE ALL ON FUNCTION admin_ai_set_policy(boolean) FROM public;
REVOKE ALL ON FUNCTION admin_ai_control_room() FROM public;
GRANT EXECUTE ON FUNCTION admin_ai_scan() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_ai_auto_run() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_ai_queue_workflow(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_ai_draft_reply(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_ai_apply(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_ai_dismiss(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_ai_set_policy(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_ai_control_room() TO authenticated;

NOTIFY pgrst, 'reload schema';
