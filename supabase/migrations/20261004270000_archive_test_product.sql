/*
  Production content cleanup: keep the historical test fixture for order/audit
  references, but remove it from every public shop query. The public products RLS
  policy already requires is_active = true, so this is a reversible archive rather
  than a destructive delete.
*/
UPDATE products
SET is_active = false,
    updated_at = now()
WHERE lower(slug) = 'test-product'
   OR (lower(name) = 'test product' AND lower(coalesce(description, '')) LIKE '%test%');
