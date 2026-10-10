-- Buddy phase B slice 5: the old sender keys are retired. WhatsApp is never offered. Facebook and Pinterest are manual only
-- (the owner posts those by hand). With these rows disabled, the Keys page no longer lists them, and a save or test for them
-- is refused by the database ("Unknown or disabled secret name"). Existing Vault values are not deleted here.
-- Additive in effect: it only turns the catalogue rows off. NOT applied to production.

UPDATE public.automation_secret_catalog
SET enabled = false
WHERE secret_name IN (
  'whatsapp_access_token',
  'whatsapp_phone_number_id',
  'meta_access_token',
  'facebook_page_id',
  'pinterest_access_token',
  'pinterest_board_id'
);
