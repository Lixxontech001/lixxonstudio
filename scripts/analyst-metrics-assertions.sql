-- Phase 4 gap 1 assertions: the Analyst reads measured business data and labels
-- every metric it cannot measure. Proves real aggregates, unavailable labelling,
-- measured-vs-estimated separation, privacy filtering and the queued brief.
-- This suite runs FIRST in scripts/db-test.py: its empty-window assertions need the
-- post-migration state before other suites insert their own fixtures, and it restores
-- every row it touches.
\set ON_ERROR_STOP on

DO $$
DECLARE
  owner jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","email":"owner@lixxonstudio.com"}';
  reader jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d4"}';
  anon_claims jsonb := '{"role":"anon"}';
  post_a uuid; post_b uuid; ord_paid uuid; ord_pending uuid; cust uuid; v_order_number text;
  m jsonb; s jsonb; brief jsonb; v_detail text; summary text;
  raised boolean;
  rec record;
BEGIN
  -- ------------------------------------------------------- 1. permission gate
  PERFORM set_config('request.jwt.claims', reader::text, true);
  PERFORM set_config('request.jwt.claim.sub', reader->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  raised := false;
  BEGIN PERFORM analyst_metrics(30); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'A non-owner read the analyst metrics'; END IF;

  PERFORM set_config('request.jwt.claims', anon_claims::text, true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  raised := false;
  BEGIN PERFORM analyst_metrics(30); EXCEPTION WHEN others THEN raised := true; END;
  IF NOT raised THEN RAISE EXCEPTION 'An anon caller read the analyst metrics'; END IF;

  PERFORM set_config('request.jwt.claims', owner::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner->>'sub', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  IF NOT has_function_privilege('authenticated', 'analyst_metrics(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'analyst_metrics(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'analyst_metrics grants are not least-privilege';
  END IF;

  -- ----------------------------------- 2. empty window => unavailable, not zero
  m := analyst_metrics(30);
  IF (m #>> '{sections,article_views,available}')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'an empty view window was not reported as unavailable';
  END IF;
  IF (m #>> '{sections,article_views,unavailable_reason}') IS NULL THEN
    RAISE EXCEPTION 'an unavailable metric carried no reason';
  END IF;
  IF (m #>> '{sections,article_views,total}')::bigint <> 0 THEN
    RAISE EXCEPTION 'an empty window did not report a zero count alongside unavailability';
  END IF;
  IF (m #>> '{sections,channels,available}')::boolean IS NOT FALSE
     OR (m #>> '{sections,conversions,available}')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'channels/conversions were reported available without any source data';
  END IF;
  -- Metrics with no source at all are always listed, even before any data exists.
  IF jsonb_array_length(m -> 'unavailable') <> 7 THEN
    RAISE EXCEPTION 'expected 7 never-measurable metrics, found %', jsonb_array_length(m -> 'unavailable');
  END IF;
  FOR rec IN SELECT jsonb_array_elements(m -> 'unavailable') e LOOP
    IF (rec.e ->> 'reason') IS NULL OR length(rec.e ->> 'reason') < 10 THEN
      RAISE EXCEPTION 'unavailable metric % carried no honest reason', rec.e ->> 'metric_key';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(m -> 'unavailable') e WHERE e ->> 'metric_key' = 'email.open_rate') THEN
    RAISE EXCEPTION 'email open rate was not listed as unavailable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(m -> 'unavailable') e WHERE e ->> 'metric_key' = 'search.zero_result_rate') THEN
    RAISE EXCEPTION 'search zero-result rate was not listed as unavailable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(m -> 'recommendations') r WHERE r ->> 'title' = 'Channel performance cannot be judged yet') THEN
    RAISE EXCEPTION 'no channel caution was emitted while no channel samples exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(m -> 'recommendations') r WHERE r ->> 'title' = 'No view data to act on yet') THEN
    RAISE EXCEPTION 'no view caution was emitted while no views were recorded';
  END IF;

  -- ------------------------------------------------- 3. fixtures: real events
  SELECT id INTO cust FROM customers LIMIT 1;
  INSERT INTO posts (title, slug, content, status) VALUES ('Measured article', 'gap1-measured', 'Body', 'published') RETURNING id INTO post_a;
  INSERT INTO posts (title, slug, content, status) VALUES ('Second article', 'gap1-second', 'Body', 'published') RETURNING id INTO post_b;

  -- 9 views on the first article, 1 on the second: one article dominates (90%).
  INSERT INTO article_views (post_id, fingerprint, created_at) SELECT post_a, 'fp-' || g, now() - interval '1 day' FROM generate_series(1, 9) g;
  INSERT INTO article_views (post_id, fingerprint, created_at) VALUES (post_b, 'fp-b', now() - interval '1 day');

  -- Repeated search term, plus something that looks like a contact detail.
  INSERT INTO search_history (fingerprint, query, created_at) VALUES
    ('s1', 'vitamin c serum', now() - interval '2 days'),
    ('s2', 'Vitamin C Serum', now() - interval '2 days'),
    ('s3', 'vitamin c serum ', now() - interval '1 day'),
    ('s4', 'reader@example.com', now() - interval '1 day');

  -- One paid order (100 USD) and one pending order that must never be counted.
  INSERT INTO orders (customer_id, order_number, customer_email, customer_name, status, payment_status, amount, currency, created_at)
    VALUES (cust, 'GAP1-PAID-1', 'reader@example.com', 'Gap One', 'completed', 'paid', 100.00, 'USD', now() - interval '3 days')
    RETURNING id, order_number INTO ord_paid, v_order_number;
  INSERT INTO orders (customer_id, order_number, customer_email, customer_name, status, payment_status, amount, currency, created_at)
    VALUES (cust, 'GAP1-PENDING-1', 'reader@example.com', 'Gap One', 'pending', 'pending', 999.99, 'USD', now() - interval '3 days')
    RETURNING id INTO ord_pending;
  INSERT INTO order_items (order_id, product_name, price, quantity) VALUES
    (ord_paid, 'Glow Serum', 40.00, 2),
    (ord_paid, 'Night Cream', 20.00, 1);
  INSERT INTO order_items (order_id, product_name, price, quantity) VALUES (ord_pending, 'Never Counted', 999.99, 1);
  INSERT INTO refund_requests (order_id, customer_email, reason, status) VALUES (ord_paid, 'reader@example.com', 'changed mind', 'pending');

  -- Email queue: one sent, one failed.
  INSERT INTO email_queue (to_email, subject, html, kind, status, created_at, sent_at) VALUES
    ('reader@example.com', 'Receipt', '<p>ok</p>', 'receipt', 'sent', now() - interval '3 days', now() - interval '3 days'),
    ('reader@example.com', 'Digest', '<p>ok</p>', 'digest', 'failed', now() - interval '2 days', NULL);

  -- Channel samples: the SAME channel and metric, once measured and once estimated.
  INSERT INTO distribution_metric_samples (post_id, channel_key, period_start, period_end, metric_key, metric_value, measurement_kind, collection_basis, consent_verified)
    VALUES (post_a, 'telegram', (current_date - 2), (current_date - 1), 'reach', 500, 'measured', 'provider_aggregate', false);
  INSERT INTO distribution_metric_samples (post_id, channel_key, period_start, period_end, metric_key, metric_value, measurement_kind, collection_basis, consent_verified)
    VALUES (post_a, 'telegram', (current_date - 2), (current_date - 1), 'clicks', 42, 'estimated', 'estimate', false);

  -- ------------------------------------------- 4. measured aggregates are real
  m := analyst_metrics(30);
  s := m -> 'sections';

  IF (s #>> '{article_views,available}')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'article views were reported unavailable despite recorded rows';
  END IF;
  IF (s #>> '{article_views,total}')::bigint <> 10 THEN
    RAISE EXCEPTION 'article view total was % instead of 10', s #>> '{article_views,total}';
  END IF;
  IF (s #>> '{article_views,posts_viewed}')::integer <> 2 THEN
    RAISE EXCEPTION 'distinct viewed posts were wrong';
  END IF;
  IF (s #>> '{article_views,top_posts,0,title}') <> 'Measured article' THEN
    RAISE EXCEPTION 'top post was not ordered by measured views';
  END IF;

  IF (s #>> '{search,total}')::bigint <> 3 THEN
    RAISE EXCEPTION 'search total was % instead of 3 (the email-like query must be excluded)', s #>> '{search,total}';
  END IF;
  IF (s #>> '{search,distinct_queries}')::bigint <> 1 THEN
    RAISE EXCEPTION 'case/whitespace variants of one query were not grouped';
  END IF;
  IF m::text LIKE '%reader@example.com%' THEN
    RAISE EXCEPTION 'a query that looks like a contact detail leaked into the metrics';
  END IF;

  IF (s #>> '{orders,paid_orders}')::integer <> 1 THEN
    RAISE EXCEPTION 'paid order count included a pending order';
  END IF;
  IF (s #>> '{orders,revenue_by_currency,0,revenue}')::numeric <> 100.00 THEN
    RAISE EXCEPTION 'revenue was wrong: %', s #>> '{orders,revenue_by_currency,0,revenue}';
  END IF;
  IF (s #>> '{orders,revenue_by_currency,0,currency}') <> 'USD' THEN
    RAISE EXCEPTION 'currency was not reported';
  END IF;
  IF (s #>> '{orders,top_products,0,product_name}') <> 'Glow Serum' THEN
    RAISE EXCEPTION 'top product was not ordered by revenue';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s #> '{orders,top_products}') p WHERE p ->> 'product_name' = 'Never Counted') THEN
    RAISE EXCEPTION 'a product from a pending order leaked into the paid-product list';
  END IF;
  IF (s #>> '{orders,refund_requests}')::integer <> 1 THEN
    RAISE EXCEPTION 'refund requests were not counted';
  END IF;

  IF (s #>> '{email,sent}')::integer <> 1 OR (s #>> '{email,failed}')::integer <> 1 THEN
    RAISE EXCEPTION 'email sent/failed counts were wrong';
  END IF;
  IF (s #>> '{email,note}') IS NULL THEN
    RAISE EXCEPTION 'email metrics did not disclose that they are queue records, not provider readback';
  END IF;

  -- ------------------------------- 5. measured and estimated never merge
  IF jsonb_array_length(s #> '{channels,measured}') <> 1 OR jsonb_array_length(s #> '{channels,estimated}') <> 1 THEN
    RAISE EXCEPTION 'measured and estimated channel samples were not separated';
  END IF;
  IF (s #>> '{channels,measured,0,metric_key}') <> 'reach' OR (s #>> '{channels,estimated,0,metric_key}') <> 'clicks' THEN
    RAISE EXCEPTION 'a channel sample was filed under the wrong measurement kind';
  END IF;
  IF (s #>> '{channels,measured,0,basis}') <> 'provider_aggregate' THEN
    RAISE EXCEPTION 'the measured channel basis was not surfaced';
  END IF;

  -- --------------------------------------- 6. derived conversion is labelled
  IF (s #>> '{conversions,available}')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'conversions were unavailable despite views and paid orders';
  END IF;
  IF (s #>> '{conversions,basis}') <> 'derived' THEN
    RAISE EXCEPTION 'the conversion ratio was not marked as derived';
  END IF;
  IF (s #>> '{conversions,note}') NOT LIKE '%not a tracked funnel%' THEN
    RAISE EXCEPTION 'the conversion caveat is missing: %', s #>> '{conversions,note}';
  END IF;
  IF (s #>> '{conversions,paid_orders_per_1000_views}')::numeric <> 100.00 THEN
    RAISE EXCEPTION 'conversion ratio was wrong: %', s #>> '{conversions,paid_orders_per_1000_views}';
  END IF;

  -- ------------------------------ 7. grounded recommendations with real basis
  IF jsonb_array_length(m -> 'recommendations') < 3 THEN
    RAISE EXCEPTION 'expected grounded recommendations, found %', jsonb_array_length(m -> 'recommendations');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(m -> 'recommendations') r
     WHERE r ->> 'title' = 'One article carries a large share of measured views'
       AND r ->> 'basis' LIKE '%9 of 10 views (90.0%)%'
  ) THEN RAISE EXCEPTION 'the view-concentration recommendation did not state its real basis'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(m -> 'recommendations') r
     WHERE r ->> 'title' = 'A repeated search term may indicate unmet demand'
       AND lower(r ->> 'basis') LIKE '%"vitamin c serum" was searched 3 times%'
  ) THEN RAISE EXCEPTION 'the repeated-search recommendation did not state its real basis'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(m -> 'recommendations') r
     WHERE r ->> 'title' = 'Email delivery failures need attention' AND r ->> 'basis' LIKE '%1 of 2 queued email(s) failed%'
  ) THEN RAISE EXCEPTION 'the email-failure recommendation did not state its real basis'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(m -> 'recommendations') r WHERE r ->> 'title' = 'Channel performance cannot be judged yet') THEN
    RAISE EXCEPTION 'a channel caution was emitted even though channel samples exist';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(m -> 'recommendations') r WHERE r ->> 'title' = 'No view data to act on yet') THEN
    RAISE EXCEPTION 'a no-view caution was emitted even though views were recorded';
  END IF;
  FOR rec IN SELECT jsonb_array_elements(m -> 'recommendations') e LOOP
    IF (rec.e ->> 'basis') IS NULL OR jsonb_array_length(COALESCE(rec.e -> 'metric_keys', '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'a recommendation was emitted without basis figures or metric keys';
    END IF;
  END LOOP;

  -- ------------------------------------ 8. the queued brief carries all of it
  -- Boardroom agents seed disabled, so the owner must enable the Analyst first.
  PERFORM admin_ai_set_agent('analyst', true, 'suggest', 1440, 5, '{}'::jsonb);
  brief := admin_ai_run_agent('analyst');
  IF brief ->> 'job_id' IS NULL THEN RAISE EXCEPTION 'the analyst run produced no job'; END IF;
  v_detail := (SELECT detail FROM admin_ai_action_queue WHERE agent_key = 'analyst' ORDER BY created_at DESC LIMIT 1);
  IF v_detail NOT LIKE 'Measured in the last 30 days:%' OR v_detail NOT LIKE '%Unavailable:%' THEN
    RAISE EXCEPTION 'the queued brief text is not the measured summary: %', left(v_detail, 120);
  END IF;
  IF v_detail NOT LIKE '%10 article view(s)%' THEN
    RAISE EXCEPTION 'the brief text did not include the measured view count: %', v_detail;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM admin_ai_action_queue
     WHERE agent_key = 'analyst'
       AND proposed #>> '{sections,article_views,total}' = '10'
       AND proposed #>> '{sections,orders,paid_orders}' = '1'
       AND jsonb_array_length(COALESCE(proposed -> 'unavailable', '[]'::jsonb)) = 7
       AND jsonb_array_length(COALESCE(proposed -> 'recommendations', '[]'::jsonb)) >= 3
       AND proposed ? 'ai_metric_aggregates'
       AND target_type = 'analyst_metrics'
  ) THEN RAISE EXCEPTION 'the analyst brief did not store the measured read model'; END IF;
  IF EXISTS (SELECT 1 FROM admin_ai_action_queue WHERE agent_key = 'analyst' AND proposed::text LIKE '%reader@example.com%') THEN
    RAISE EXCEPTION 'the stored brief leaked a contact detail';
  END IF;

  -- The summary helper agrees with the stored object, including its gaps.
  summary := analyst_metrics_summary(m);
  IF summary NOT LIKE '%Recommendations:%' OR summary NOT LIKE '%Unavailable:%' THEN
    RAISE EXCEPTION 'summary is missing its unavailable/recommendation disclosure';
  END IF;
  IF analyst_metrics_summary(analyst_metrics(365)) NOT LIKE 'Measured in the last 365 days:%' THEN
    RAISE EXCEPTION 'summary does not respect the requested window';
  END IF;

  -- --------------------------------------------------------------- 9. cleanup
  DELETE FROM distribution_metric_samples WHERE post_id IN (post_a, post_b);
  DELETE FROM email_queue WHERE to_email = 'reader@example.com' AND subject IN ('Receipt', 'Digest');
  DELETE FROM refund_requests WHERE order_id IN (ord_paid, ord_pending);
  DELETE FROM order_items WHERE order_id IN (ord_paid, ord_pending);
  DELETE FROM orders WHERE id IN (ord_paid, ord_pending);
  DELETE FROM search_history WHERE query IN ('vitamin c serum', 'Vitamin C Serum', 'vitamin c serum ', 'reader@example.com');
  DELETE FROM article_views WHERE post_id IN (post_a, post_b);
  DELETE FROM posts WHERE id IN (post_a, post_b);
  DELETE FROM admin_ai_action_queue WHERE agent_key = 'analyst' AND action_type = 'analytics_brief';
  DELETE FROM admin_ai_jobs WHERE agent_key = 'analyst';
  -- Restore the seeded policy so this suite leaves the database as it found it.
  PERFORM admin_ai_set_agent('analyst', false, 'suggest', 1440, 10, '{}'::jsonb);
  UPDATE admin_ai_agents SET last_run_at = NULL, next_run_at = NULL WHERE agent_key = 'analyst';
END $$;
