-- One-shot, opt-in restock alerts flow through the existing email queue.
ALTER TABLE public.product_notifications
  ADD COLUMN IF NOT EXISTS consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS alert_id uuid;

UPDATE public.product_notifications
SET alert_id = gen_random_uuid()
WHERE alert_id IS NULL;

ALTER TABLE public.product_notifications
  ALTER COLUMN alert_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN alert_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS product_notifications_alert_id_uidx
  ON public.product_notifications (alert_id);
CREATE INDEX IF NOT EXISTS product_notifications_pending_product_idx
  ON public.product_notifications (product_id, created_at)
  WHERE notified_at IS NULL AND consented_at IS NOT NULL;

-- Emails and addresses remain private. Admin policies are retained; service_role is
-- the only non-admin writer used by the edge functions.
REVOKE ALL ON TABLE public.product_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.product_notifications TO authenticated, service_role;
REVOKE ALL ON TABLE public.email_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.email_queue TO authenticated;
GRANT ALL ON TABLE public.email_queue TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_product_restock_emails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  site text;
  safe_site text;
  safe_name text;
  safe_slug text;
BEGIN
  IF NEW.is_active IS NOT TRUE
     OR NEW.stock_status NOT IN ('in_stock', 'low')
     OR (OLD.is_active IS TRUE AND OLD.stock_status IN ('in_stock', 'low')) THEN
    RETURN NEW;
  END IF;

  SELECT value->>'url' INTO site
  FROM public.site_settings
  WHERE key = 'site_url';
  site := COALESCE(site, 'https://lixxonstudio.com');
  IF site !~ '^https?://' THEN site := 'https://lixxonstudio.com'; END IF;
  site := regexp_replace(site, '/+$', '');
  safe_site := replace(replace(replace(site, '&', '&amp;'), '"', '&quot;'), '<', '&lt;');
  safe_name := replace(replace(replace(replace(COALESCE(NEW.name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
  safe_slug := regexp_replace(COALESCE(NEW.slug, ''), '[^A-Za-z0-9_-]', '', 'g');
  IF safe_slug = '' THEN safe_slug := NEW.id::text; END IF;

  INSERT INTO public.email_queue (to_email, subject, html, kind, dedupe_key)
  SELECT
    pn.email,
    'Back in stock: ' || left(regexp_replace(NEW.name, '[[:cntrl:]]', ' ', 'g'), 120),
    '<p><strong>' || safe_name || '</strong> is available again.</p>' ||
    '<p><a href="' || safe_site || '/shop/product/' || safe_slug || '">View product</a></p>' ||
    '<p>You received this one-time email because you requested a back-in-stock alert for this product. This does not subscribe you to the newsletter.</p>',
    'restock',
    'restock:' || NEW.id::text || ':' || pn.alert_id::text
  FROM public.product_notifications AS pn
  WHERE pn.product_id = NEW.id
    AND pn.consented_at IS NOT NULL
    AND pn.notified_at IS NULL
  ON CONFLICT (dedupe_key) DO UPDATE
    SET subject = EXCLUDED.subject,
        html = EXCLUDED.html,
        status = 'queued',
        attempts = 0,
        scheduled_for = now(),
        sent_at = NULL
    WHERE email_queue.status = 'failed';

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_product_restock_emails() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_enqueue_product_restock_emails ON public.products;
CREATE TRIGGER trg_enqueue_product_restock_emails
  AFTER UPDATE OF stock_status, is_active ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_product_restock_emails();
