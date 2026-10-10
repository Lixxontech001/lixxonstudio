-- Buddy phase 1 slice 2: the existing Gemini key row becomes the one "Google key" Buddy uses.
-- Only the catalogue label and purpose text change. No secret value is read, moved or deleted.
UPDATE public.automation_secret_catalog
   SET label = 'Google key',
       purpose = 'This is how Buddy thinks.'
 WHERE secret_name = 'gemini_api_key';
