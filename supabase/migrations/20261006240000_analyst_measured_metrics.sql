-- =============================================================================
-- Phase 4 gap 1 — the Analyst reads measured business data, not just AI counters.
--
-- Before this, the Analyst's brief contained only aggregates from `admin_ai_metrics`
-- (the agents' own counters), so views, searches, orders, email and channel numbers
-- were simply absent — and nothing said they were missing. This adds a real read
-- model over the tables that actually record those events and states plainly which
-- metrics have no source at all.
--
-- Truthfulness rules enforced here:
--   * Every section carries `available`, the real `source` table, and either measured
--     values or an `unavailable_reason`. An empty window is reported as unavailable —
--     never as a zero that could be mistaken for a measured zero.
--   * Channel figures keep `measured` and `estimated` strictly separate, using the
--     distribution ledger's `measurement_kind`/`collection_basis` columns.
--   * Email numbers describe this site's own queue (delivery attempts), not provider
--     readback, and open/click rates are listed as unavailable because nothing records them.
--   * Recommendations are emitted only when the measured numbers support them, and each
--     carries the exact `basis` figures it came from.
--
-- Read-only, SECURITY DEFINER, pinned search_path, gated on the same
-- `admin.ai.reports` capability the control tower uses. No table is added and no
-- browser-supplied input is accepted.
-- =============================================================================

CREATE OR REPLACE FUNCTION analyst_metrics(p_window_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_days integer := GREATEST(1, LEAST(365, COALESCE(p_window_days, 30)));
  v_since timestamptz;
  v_views jsonb; v_search jsonb; v_orders jsonb; v_email jsonb; v_channels jsonb; v_conversions jsonb;
  v_views_total bigint := 0;
  v_searches bigint := 0;
  v_paid_orders integer := 0;
  v_email_total integer := 0;
  v_email_sent integer := 0;
  v_email_failed integer := 0;
  v_channel_samples integer := 0;
  v_top_title text; v_top_views bigint; v_top_share numeric;
  v_currency text; v_revenue numeric;
  v_query text; v_query_count bigint;
  v_unavailable jsonb;
  v_recommendations jsonb := '[]'::jsonb;
BEGIN
  PERFORM admin_ai_require('admin.ai.reports');
  v_since := now() - make_interval(days => v_days);

  -- ------------------------------------------------------------- article views
  SELECT count(*) INTO v_views_total FROM article_views WHERE created_at >= v_since;
  v_views := jsonb_build_object(
    'available', v_views_total > 0,
    'source', 'article_views',
    'total', v_views_total,
    'posts_viewed', (SELECT count(DISTINCT post_id) FROM article_views WHERE created_at >= v_since AND post_id IS NOT NULL),
    'top_posts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('title', t.title, 'views', t.views) ORDER BY t.views DESC)
        FROM (
          SELECT COALESCE(p.title, 'Untitled') AS title, count(*)::bigint AS views
            FROM article_views av
            LEFT JOIN posts p ON p.id = av.post_id
           WHERE av.created_at >= v_since AND av.post_id IS NOT NULL
           GROUP BY COALESCE(p.title, 'Untitled')
           ORDER BY count(*) DESC
           LIMIT 5
        ) t
    ), '[]'::jsonb),
    'unavailable_reason', CASE WHEN v_views_total > 0 THEN NULL
      ELSE format('View tracking recorded no rows in the last %s days', v_days) END
  );

  -- ------------------------------------------------------------------- search
  SELECT count(*) INTO v_searches FROM search_history
   WHERE created_at >= v_since AND btrim(query) <> '' AND position('@' in query) = 0;
  v_search := jsonb_build_object(
    'available', v_searches > 0,
    'source', 'search_history',
    'total', v_searches,
    'distinct_queries', (SELECT count(DISTINCT lower(btrim(query))) FROM search_history
     WHERE created_at >= v_since AND btrim(query) <> '' AND position('@' in query) = 0),
    'top_queries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('query', q.query, 'count', q.n) ORDER BY q.n DESC)
        FROM (
          SELECT min(left(btrim(query), 60)) AS query, count(*)::bigint AS n
            FROM search_history
           WHERE created_at >= v_since AND btrim(query) <> '' AND position('@' in query) = 0
           GROUP BY lower(btrim(query))
           ORDER BY count(*) DESC
           LIMIT 5
        ) q
    ), '[]'::jsonb),
    'note', 'Queries containing "@" are excluded (they may be contact details) and text is truncated to 60 characters.',
    'unavailable_reason', CASE WHEN v_searches > 0 THEN NULL
      ELSE format('No searches were recorded in the last %s days', v_days) END
  );

  -- ------------------------------------------------------------------- orders
  SELECT count(*) INTO v_paid_orders FROM orders WHERE payment_status = 'paid' AND created_at >= v_since;
  v_orders := jsonb_build_object(
    'available', v_paid_orders > 0,
    'source', 'orders',
    'paid_orders', v_paid_orders,
    'revenue_by_currency', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', o.currency, 'orders', o.n, 'revenue', o.revenue, 'average_order_value', o.aov) ORDER BY o.revenue DESC)
        FROM (
          SELECT currency, count(*)::integer AS n, round(sum(amount)::numeric, 2) AS revenue, round(avg(amount)::numeric, 2) AS aov
            FROM orders WHERE payment_status = 'paid' AND created_at >= v_since GROUP BY currency
        ) o
    ), '[]'::jsonb),
    'top_products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('product_name', t.product_name, 'units', t.units, 'revenue', t.revenue) ORDER BY t.revenue DESC)
        FROM (
          SELECT oi.product_name, sum(oi.quantity)::bigint AS units, round(sum(oi.price * oi.quantity)::numeric, 2) AS revenue
            FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE o.payment_status = 'paid' AND o.created_at >= v_since
           GROUP BY oi.product_name
           ORDER BY sum(oi.price * oi.quantity) DESC
           LIMIT 5
        ) t
    ), '[]'::jsonb),
    'refund_requests', (SELECT count(*) FROM refund_requests WHERE created_at >= v_since),
    'unavailable_reason', CASE WHEN v_paid_orders > 0 THEN NULL
      ELSE format('No paid orders in the last %s days', v_days) END
  );

  -- -------------------------------------------------------------------- email
  SELECT count(*), count(*) FILTER (WHERE status = 'sent'), count(*) FILTER (WHERE status = 'failed')
    INTO v_email_total, v_email_sent, v_email_failed
    FROM email_queue WHERE created_at >= v_since;
  v_email := jsonb_build_object(
    'available', v_email_total > 0,
    'source', 'email_queue',
    'queued', (SELECT count(*) FROM email_queue WHERE status = 'queued' AND created_at >= v_since),
    'sent', v_email_sent,
    'failed', v_email_failed,
    'skipped', (SELECT count(*) FROM email_queue WHERE status = 'skipped' AND created_at >= v_since),
    'by_kind', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('kind', k.kind, 'count', k.n) ORDER BY k.n DESC)
        FROM (SELECT kind, count(*)::integer AS n FROM email_queue WHERE created_at >= v_since GROUP BY kind ORDER BY count(*) DESC LIMIT 5) k
    ), '[]'::jsonb),
    'note', 'Counts are this site''s own queue records (delivery attempts), not provider readback.',
    'unavailable_reason', CASE WHEN v_email_total > 0 THEN NULL
      ELSE format('No emails were queued in the last %s days', v_days) END
  );

  -- ----------------------------------------------------------------- channels
  SELECT count(*) INTO v_channel_samples
    FROM distribution_metric_samples WHERE period_end >= (current_date - v_days);
  v_channels := jsonb_build_object(
    'available', v_channel_samples > 0,
    'source', 'distribution_metric_samples',
    'measured', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('channel_key', c.channel_key, 'metric_key', c.metric_key, 'value', c.value, 'basis', c.basis) ORDER BY c.channel_key, c.metric_key)
        FROM (
          SELECT channel_key, metric_key, round(sum(metric_value)::numeric, 4) AS value, min(collection_basis) AS basis
            FROM distribution_metric_samples
           WHERE measurement_kind = 'measured' AND period_end >= (current_date - v_days)
           GROUP BY channel_key, metric_key LIMIT 30
        ) c
    ), '[]'::jsonb),
    'estimated', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('channel_key', c.channel_key, 'metric_key', c.metric_key, 'value', c.value, 'basis', c.basis) ORDER BY c.channel_key, c.metric_key)
        FROM (
          SELECT channel_key, metric_key, round(sum(metric_value)::numeric, 4) AS value, min(collection_basis) AS basis
            FROM distribution_metric_samples
           WHERE measurement_kind = 'estimated' AND period_end >= (current_date - v_days)
           GROUP BY channel_key, metric_key LIMIT 30
        ) c
    ), '[]'::jsonb),
    'note', 'Measured and estimated channel figures are never merged, and no provider readback has run.',
    'unavailable_reason', CASE WHEN v_channel_samples > 0 THEN NULL
      ELSE 'No channel metric samples exist for this window; channel performance is unknown, not zero' END
  );

  -- -------------------------------------------------------------- conversions
  v_conversions := jsonb_build_object(
    'available', v_views_total > 0 AND v_paid_orders > 0,
    'basis', 'derived',
    'note', 'Paid orders divided by recorded article views in the same window. This is a coarse ratio, not a tracked funnel: the two events are not linked per visitor.',
    'paid_orders_per_1000_views', CASE WHEN v_views_total > 0
      THEN round((v_paid_orders::numeric * 1000) / v_views_total, 2) ELSE NULL END,
    'unavailable_reason', CASE WHEN v_views_total > 0 AND v_paid_orders > 0 THEN NULL
      ELSE 'Needs both recorded article views and paid orders in the same window' END
  );

  -- ------------------------------------------- metrics with no source at all
  v_unavailable := jsonb_build_array(
    jsonb_build_object('metric_key', 'email.open_rate', 'reason', 'The email queue records delivery status only; opens are not tracked.'),
    jsonb_build_object('metric_key', 'email.click_rate', 'reason', 'Clicks inside emails are not tracked.'),
    jsonb_build_object('metric_key', 'search.zero_result_rate', 'reason', 'The search log stores the query text but not whether it returned results.'),
    jsonb_build_object('metric_key', 'article.avg_time_on_page', 'reason', 'No time-on-page, scroll or engagement timing is collected.'),
    jsonb_build_object('metric_key', 'traffic.unique_visitors', 'reason', 'Article views store an untrusted per-row fingerprint, which cannot be counted as unique visitors.'),
    jsonb_build_object('metric_key', 'checkout.conversion_funnel', 'reason', 'No step-level checkout funnel is recorded; only final paid orders are known.'),
    jsonb_build_object('metric_key', 'channel.provider_readback', 'reason', 'No provider API readback has run, so provider-side figures are unavailable and collected estimates stay labelled as estimates.')
  );

  -- ------------------------------------- recommendations, grounded in the data
  SELECT t.title, t.views, round((t.views::numeric * 100) / NULLIF(v_views_total, 0), 1)
    INTO v_top_title, v_top_views, v_top_share
    FROM (
      SELECT COALESCE(p.title, 'Untitled') AS title, count(*)::bigint AS views
        FROM article_views av LEFT JOIN posts p ON p.id = av.post_id
       WHERE av.created_at >= v_since AND av.post_id IS NOT NULL
       GROUP BY COALESCE(p.title, 'Untitled') ORDER BY count(*) DESC LIMIT 1
    ) t;

  IF v_views_total > 0 AND v_top_share >= 25 THEN
    v_recommendations := v_recommendations || jsonb_build_array(jsonb_build_object(
      'title', 'One article carries a large share of measured views',
      'basis', format('"%s" recorded %s of %s views (%s%%) in the last %s days', v_top_title, v_top_views, v_views_total, v_top_share, v_days),
      'metric_keys', jsonb_build_array('article_views.total', 'article_views.top_posts')));
  END IF;

  IF v_views_total = 0 THEN
    v_recommendations := v_recommendations || jsonb_build_array(jsonb_build_object(
      'title', 'No view data to act on yet',
      'basis', format('View tracking recorded 0 rows in the last %s days, so traffic conclusions would be guesses', v_days),
      'metric_keys', jsonb_build_array('article_views.total')));
  END IF;

  IF v_paid_orders > 0 THEN
    SELECT o.currency, o.revenue INTO v_currency, v_revenue
      FROM (SELECT currency, round(sum(amount)::numeric, 2) AS revenue FROM orders
             WHERE payment_status = 'paid' AND created_at >= v_since
             GROUP BY currency ORDER BY sum(amount) DESC LIMIT 1) o;
    v_recommendations := v_recommendations || jsonb_build_array(jsonb_build_object(
      'title', 'Revenue is concentrated in one currency',
      'basis', format('%s paid order(s) worth %s %s in the last %s days', v_paid_orders, v_revenue, v_currency, v_days),
      'metric_keys', jsonb_build_array('orders.paid_orders', 'orders.revenue_by_currency')));
  END IF;

  SELECT q.query, q.n INTO v_query, v_query_count
    FROM (SELECT min(left(btrim(query), 60)) AS query, count(*)::bigint AS n FROM search_history
           WHERE created_at >= v_since AND btrim(query) <> '' AND position('@' in query) = 0
           GROUP BY lower(btrim(query)) ORDER BY count(*) DESC LIMIT 1) q;
  IF v_searches > 0 AND v_query_count >= 3 THEN
    v_recommendations := v_recommendations || jsonb_build_array(jsonb_build_object(
      'title', 'A repeated search term may indicate unmet demand',
      'basis', format('"%s" was searched %s times in the last %s days', v_query, v_query_count, v_days),
      'metric_keys', jsonb_build_array('search.total', 'search.top_queries')));
  END IF;

  IF v_email_failed > 0 THEN
    v_recommendations := v_recommendations || jsonb_build_array(jsonb_build_object(
      'title', 'Email delivery failures need attention',
      'basis', format('%s of %s queued email(s) failed in the last %s days', v_email_failed, v_email_total, v_days),
      'metric_keys', jsonb_build_array('email.sent', 'email.failed')));
  END IF;

  IF v_channel_samples = 0 THEN
    v_recommendations := v_recommendations || jsonb_build_array(jsonb_build_object(
      'title', 'Channel performance cannot be judged yet',
      'basis', 'No distribution metric samples exist for this window; treat channel numbers as unknown rather than zero',
      'metric_keys', jsonb_build_array('channels.measured', 'channels.estimated')));
  END IF;

  IF jsonb_array_length(v_recommendations) = 0 THEN
    v_recommendations := v_recommendations || jsonb_build_array(jsonb_build_object(
      'title', 'No action is indicated by the measured data',
      'basis', format('Measured sections were non-zero but no threshold was crossed in the last %s days', v_days),
      'metric_keys', jsonb_build_array('article_views.total', 'orders.paid_orders')));
  END IF;

  RETURN jsonb_build_object(
    'window_days', v_days,
    'generated_at', now(),
    'sections', jsonb_build_object(
      'article_views', v_views, 'search', v_search, 'orders', v_orders,
      'email', v_email, 'channels', v_channels, 'conversions', v_conversions),
    'unavailable', v_unavailable,
    'recommendations', v_recommendations
  );
END $$;

-- A compact, human-readable summary for the queued brief, built from the same
-- object so the text can never disagree with the stored numbers.
CREATE OR REPLACE FUNCTION analyst_metrics_summary(p_metrics jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  s jsonb := COALESCE(p_metrics -> 'sections', '{}'::jsonb);
  v_days text := COALESCE(p_metrics ->> 'window_days', '?');
  parts text[] := '{}';
  missing text[] := '{}';
BEGIN
  IF COALESCE((s #>> '{orders,available}')::boolean, false) THEN
    parts := parts || format('%s paid order(s): %s', s #>> '{orders,paid_orders}', COALESCE((
      SELECT string_agg(format('%s %s', r ->> 'revenue', r ->> 'currency'), ', ')
        FROM jsonb_array_elements(COALESCE(s #> '{orders,revenue_by_currency}', '[]'::jsonb)) r), 'no currency total'));
  ELSE
    missing := missing || format('paid orders (%s)', COALESCE(s #>> '{orders,unavailable_reason}', 'unavailable'));
  END IF;

  IF COALESCE((s #>> '{article_views,available}')::boolean, false) THEN
    parts := parts || format('%s article view(s) across %s article(s)', s #>> '{article_views,total}', s #>> '{article_views,posts_viewed}');
  ELSE
    missing := missing || format('article views (%s)', COALESCE(s #>> '{article_views,unavailable_reason}', 'unavailable'));
  END IF;

  IF COALESCE((s #>> '{search,available}')::boolean, false) THEN
    parts := parts || format('%s search(es), %s distinct', s #>> '{search,total}', s #>> '{search,distinct_queries}');
  ELSE
    missing := array_append(missing, 'search activity');
  END IF;

  IF COALESCE((s #>> '{email,available}')::boolean, false) THEN
    parts := parts || format('%s email(s) sent, %s failed', s #>> '{email,sent}', s #>> '{email,failed}');
  ELSE
    missing := array_append(missing, 'email activity');
  END IF;

  IF COALESCE((s #>> '{channels,available}')::boolean, false) THEN
    parts := parts || format('%s measured and %s estimated channel sample(s)',
      jsonb_array_length(COALESCE(s #> '{channels,measured}', '[]'::jsonb)),
      jsonb_array_length(COALESCE(s #> '{channels,estimated}', '[]'::jsonb)));
  ELSE
    missing := array_append(missing, 'channel metrics (unknown, not zero)');
  END IF;

  RETURN format('Measured in the last %s days: %s. Unavailable: %s. Recommendations: %s.',
    v_days,
    COALESCE(array_to_string(parts, '; '), 'nothing measurable'),
    COALESCE(array_to_string(missing, ', '), 'none'),
    COALESCE(array_to_string(ARRAY(
      SELECT r ->> 'title' FROM jsonb_array_elements(COALESCE(p_metrics -> 'recommendations', '[]'::jsonb)) r), '; '), 'none'));
END $$;

REVOKE ALL ON FUNCTION analyst_metrics(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION analyst_metrics_summary(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION analyst_metrics(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION analyst_metrics_summary(jsonb) TO authenticated;


-- =============================================================================
-- The Analyst brief is rebuilt from the measured read model above. This is the
-- LATEST definition of admin_ai_run_agent (the Executioner ownership scoping from
-- 20261006160000 is preserved); only the analyst branch changed.
-- =============================================================================

CREATE OR REPLACE FUNCTION admin_ai_run_agent(p_agent_key text, p_mission_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a admin_ai_agents;
  job uuid;
  n integer := 0;
  row record;
  action_id uuid;
  facts jsonb;
  metrics jsonb;
  summary text;
  idem text;
BEGIN
  PERFORM admin_ai_require('admin.ai.run');
  SELECT * INTO a
    FROM admin_ai_agents
   WHERE agent_key = lower(btrim(p_agent_key))
     AND enabled
     AND autonomy_level <> 'disabled';
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent is disabled or unknown'; END IF;

  IF a.agent_key IN ('analyst','strategist','ceo','auditor','executioner','chief_of_staff')
     AND a.autonomy_level <> 'suggest' THEN
    RAISE EXCEPTION 'Boardroom agents are suggestion-only';
  END IF;

  idem := 'agent:' || a.agent_key || ':' || to_char(now(),'YYYY-MM-DD-HH24-MI');
  INSERT INTO admin_ai_jobs (kind, agent_key, mission_id, idempotency_key, requested_by, status, started_at)
  VALUES ('agent', a.agent_key, p_mission_id, idem, auth.uid(), 'running', now())
  ON CONFLICT (idempotency_key) DO UPDATE
    SET status = CASE WHEN admin_ai_jobs.status = 'failed' THEN 'running' ELSE admin_ai_jobs.status END
  RETURNING id INTO job;
  IF EXISTS (SELECT 1 FROM admin_ai_jobs WHERE id = job AND status = 'completed') THEN
    RETURN jsonb_build_object('job_id',job,'queued',0,'deduplicated',true);
  END IF;

  IF a.agent_key IN ('seo','content') THEN
    FOR row IN
      SELECT id, title, excerpt FROM posts
       WHERE status = 'published'
         AND (seo_title IS NULL OR btrim(seo_title) = '' OR seo_description IS NULL OR btrim(seo_description) = '')
       ORDER BY updated_at DESC NULLS LAST LIMIT a.max_actions
    LOOP
      action_id := admin_ai_queue_action(
        a.agent_key, 'seo_patch', 'Improve SEO: ' || row.title,
        'A safe metadata patch is available; content body is never changed by this agent.',
        'low', CASE WHEN a.agent_key = 'seo' THEN a.autonomy_level ELSE 'approval_required' END,
        'content.write', 'posts', row.id,
        jsonb_build_object('seo_title', left(row.title,60), 'seo_description', left(COALESCE(NULLIF(row.excerpt,''),row.title),155)),
        p_mission_id, job
      );
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'community' THEN
    FOR row IN
      SELECT id, content FROM comments
       WHERE is_approved AND is_visible AND (admin_reply IS NOT TRUE)
       ORDER BY created_at ASC LIMIT a.max_actions
    LOOP
      action_id := admin_ai_queue_action(
        a.agent_key, 'reply_draft', 'Reply needed for community comment',
        'A context-aware reply draft is ready for review.', 'medium', 'draft', 'content.moderate',
        'comments', row.id,
        jsonb_build_object('body', 'Thanks for joining the conversation. We appreciate you reading and will keep this in mind for a future guide.'),
        p_mission_id, job
      );
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'commerce' THEN
    FOR row IN
      SELECT id, name FROM products
       WHERE is_active AND (description IS NULL OR btrim(description) = '')
       ORDER BY updated_at DESC NULLS LAST LIMIT a.max_actions
    LOOP
      action_id := admin_ai_queue_action(
        a.agent_key, 'product_copy_draft', 'Improve product copy: ' || row.name,
        'The product needs a clearer description and conversion-focused structure.', 'medium', 'draft',
        'commerce.pricing', 'products', row.id,
        jsonb_build_object('brief', 'Add what it is, who it is for, benefits, proof and a clear next step.'),
        p_mission_id, job
      );
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'reliability' THEN
    FOR row IN
      SELECT fix_key, title, detail FROM admin_suggestions()
       WHERE fix_key IN ('requeue_email','repair_image_urls','backfill_seo','analyze')
       LIMIT a.max_actions
    LOOP
      action_id := admin_ai_queue_action(
        a.agent_key, row.fix_key, row.title, row.detail, 'low', 'auto_apply', 'ops.fix',
        'system', NULL, jsonb_build_object('fix_key',row.fix_key), p_mission_id, job
      );
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'security' THEN
    INSERT INTO admin_ai_incidents (severity, title, detail, source, evidence, related_job_id)
    SELECT CASE WHEN count(*) > 10 THEN 'critical' ELSE 'warning' END,
           'Review recent AI activity',
           'Security agent requests an owner review of AI actions and policy changes.',
           'security', jsonb_build_object('ai_actions_last_day', count(*)), job
      FROM admin_ai_action_queue
     WHERE created_at > now() - interval '1 day';
    n := 1;
  ELSIF a.agent_key = 'analyst' THEN
    -- Measured business data (views, search, paid orders, email queue, channel samples)
    -- plus the agents' own counters. Sections without a data source are reported as
    -- unavailable with a reason; the brief never presents an absent metric as zero.
    metrics := analyst_metrics(30);
    summary := analyst_metrics_summary(metrics);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'metric_key', metric_key, 'samples', samples, 'value_sum', value_sum
           ) ORDER BY metric_key), '[]'::jsonb)
      INTO facts
      FROM (
        SELECT metric_key, count(*)::integer AS samples, round(sum(value)::numeric,2) AS value_sum
          FROM admin_ai_metrics
         WHERE recorded_at >= now() - interval '30 days'
         GROUP BY metric_key
         ORDER BY metric_key
         LIMIT 20
      ) AS aggregate_metrics;
    action_id := admin_ai_queue_action(
      'analyst', 'analytics_brief', 'Analyst: 30-day measured review',
      summary,
      'low', 'suggest', 'admin.ai.reports', 'analyst_metrics', NULL,
      metrics || jsonb_build_object('ai_metric_aggregates', COALESCE(facts, '[]'::jsonb)),
      p_mission_id, job
    );
    n := 1;
  ELSIF a.agent_key = 'strategist' THEN
    SELECT jsonb_build_object(
      'pending_actions', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'queued'),
      'approved_actions', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'approved'),
      'active_missions', (SELECT count(*) FROM admin_ai_missions WHERE status = 'active'),
      'measured_metric_keys', (SELECT count(DISTINCT metric_key) FROM admin_ai_metrics WHERE recorded_at >= now() - interval '30 days'),
      'window_days', 30
    ) INTO facts;
    action_id := admin_ai_queue_action(
      'strategist', 'strategy_brief', 'Strategist: evidence-led priority review',
      'A deterministic planning snapshot is ready. Review current proposals and active missions before changing priorities.',
      'low', 'suggest', 'admin.ai.reports', 'admin_ai_missions', NULL, facts, p_mission_id, job
    );
    n := 1;
  ELSIF a.agent_key = 'ceo' THEN
    SELECT jsonb_build_object(
      'autopilot_enabled', (SELECT enabled FROM admin_ai_autopilot_settings WHERE id),
      'kill_switch_active', (SELECT kill_switch FROM admin_ai_autopilot_settings WHERE id),
      'daily_budget_cents', (SELECT daily_budget_cents FROM admin_ai_autopilot_settings WHERE id),
      'enabled_agents', (SELECT count(*) FROM admin_ai_agents WHERE enabled),
      'pending_actions', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'queued'),
      'failed_jobs_24h', (SELECT count(*) FROM admin_ai_jobs WHERE status = 'failed' AND created_at >= now() - interval '24 hours'),
      'open_incidents', (SELECT count(*) FROM admin_ai_incidents WHERE status NOT IN ('resolved','ignored','closed'))
    ) INTO facts;
    action_id := admin_ai_queue_action(
      'ceo', 'executive_scorecard', 'CEO: aggregate operating scorecard',
      'Review this deterministic operations scorecard; it is not a production-health certification or a publishing instruction.',
      'low', 'suggest', 'admin.ai.reports', 'admin_ai_autopilot_settings', NULL, facts, p_mission_id, job
    );
    n := 1;
  ELSIF a.agent_key = 'auditor' THEN
    SELECT jsonb_build_object(
      'approved_without_note', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'approved' AND NULLIF(btrim(decision_note),'') IS NULL),
      'enabled_auto_apply_agents', (SELECT count(*) FROM admin_ai_agents WHERE enabled AND autonomy_level = 'auto_apply'),
      'failed_jobs_30d', (SELECT count(*) FROM admin_ai_jobs WHERE status = 'failed' AND created_at >= now() - interval '30 days'),
      'open_critical_incidents', (SELECT count(*) FROM admin_ai_incidents WHERE severity = 'critical' AND status NOT IN ('resolved','ignored','closed')),
      'window_days', 30
    ) INTO facts;
    action_id := admin_ai_queue_action(
      'auditor', 'governance_brief', 'Auditor: approval and policy review',
      'Aggregate governance exceptions are listed for owner review; this check is read-only and does not alter records.',
      'low', 'suggest', 'admin.ai.reports', 'admin_ai_action_queue', NULL, facts, p_mission_id, job
    );
    n := 1;
  ELSIF a.agent_key = 'executioner' THEN
    PERFORM admin_ai_require('admin.ai.approve');
    IF EXISTS (SELECT 1 FROM admin_ai_autopilot_settings WHERE id AND kill_switch) THEN
      RAISE EXCEPTION 'AI kill switch is active';
    END IF;
    -- The only executable key is ANALYZE. It must already be owner-approved, request ops.fix,
    -- and is dispatched via the existing executor (permission check, audit, and kill switch).
    FOR row IN
      SELECT q.id
        FROM admin_ai_action_queue AS q
       WHERE q.status = 'approved'
         AND q.agent_key = a.agent_key
         AND q.action_type = 'analyze'
         AND q.required_permission = 'ops.fix'
         AND q.target_id IS NULL
       ORDER BY q.created_at, q.id
       LIMIT a.max_actions
       FOR UPDATE SKIP LOCKED
    LOOP
      PERFORM admin_ai_execute_action(row.id, false);
      n := n + 1;
    END LOOP;
  ELSIF a.agent_key = 'chief_of_staff' THEN
    SELECT jsonb_build_object(
      'pending_actions', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'queued'),
      'approved_actions', (SELECT count(*) FROM admin_ai_action_queue WHERE status = 'approved'),
      'active_missions', (SELECT count(*) FROM admin_ai_missions WHERE status = 'active'),
      'failed_jobs_7d', (SELECT count(*) FROM admin_ai_jobs WHERE status = 'failed' AND created_at >= now() - interval '7 days'),
      'open_incidents', (SELECT count(*) FROM admin_ai_incidents WHERE status NOT IN ('resolved','ignored','closed')),
      'owner_follow_up', jsonb_build_array('Review queued proposals','Check open incidents','Confirm active mission owners')
    ) INTO facts;
    action_id := admin_ai_queue_action(
      'chief_of_staff', 'operations_digest', 'Chief of Staff: owner follow-up digest',
      'A compact aggregate digest is ready for the owner; it does not send messages or mutate business records.',
      'low', 'suggest', 'admin.ai.reports', 'admin_ai_jobs', NULL, facts, p_mission_id, job
    );
    n := 1;
  ELSE
    -- Preserve the existing deterministic brief for the legacy experiments agent and any
    -- pre-existing registry extensions; all six new boardroom roles have explicit branches above.
    INSERT INTO admin_ai_action_queue (fingerprint, agent_key, job_id, action_type, title, detail, risk, autonomy_level, required_permission, proposed, created_by)
    VALUES (md5(a.agent_key || ':growth:' || current_date), a.agent_key, job, 'growth_brief',
            'Create a growth review',
            'Review traffic, retention and conversion trends against the active mission.',
            'low', 'suggest', 'analytics.read', jsonb_build_object('agent',a.agent_key), auth.uid())
    ON CONFLICT DO NOTHING;
    n := 1;
  END IF;

  UPDATE admin_ai_jobs SET status='completed', result=jsonb_build_object('queued',n), finished_at=now() WHERE id=job;
  UPDATE admin_ai_agents SET last_run_at=now(), next_run_at=now() + make_interval(mins => a.cadence_minutes), updated_at=now() WHERE agent_key=a.agent_key;
  RETURN jsonb_build_object('job_id',job,'agent',a.agent_key,'queued',n);
EXCEPTION WHEN others THEN
  IF job IS NOT NULL THEN UPDATE admin_ai_jobs SET status='failed', error=SQLERRM, finished_at=now() WHERE id=job; END IF;
  RAISE;
END $$;
-- The Analyst brief now carries the measured read model.
REVOKE ALL ON FUNCTION admin_ai_run_agent(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_ai_run_agent(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
