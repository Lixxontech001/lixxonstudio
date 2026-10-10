-- Buddy Phase A slice 1: seven more brain key slots, in the same Vault catalogue as the other keys.
-- Only catalogue rows are added. No secret value is written, read, moved or echoed here.
-- Google Gemini already has its row (gemini_api_key, "Google key"). It is not repeated.
-- Each key is saved through automation_secret_save like the other Connections keys, shown as Saved or Not saved, never echoed.
-- The try order is fixed in code (supabase/functions/_shared/brains.ts), not stored here.
-- Additive. NOT applied to production.

INSERT INTO public.automation_secret_catalog
  (secret_name, label, category, purpose, required, sort_order, credential_type) VALUES
  ('groq_api_key', 'Groq key', 'ai', 'Buddy brain number 2: a fast free brain, used when Google is full.', false, 22, 'secret'),
  ('nvidia_api_key', 'NVIDIA NIM key', 'ai', 'Buddy brain number 3: free NVIDIA models, used when the first two are full.', false, 23, 'secret'),
  ('cloudflare_api_token', 'Cloudflare API token', 'ai', 'Buddy brain number 4: Cloudflare Workers AI token. Needs the account ID too.', false, 24, 'secret'),
  ('cloudflare_account_id', 'Cloudflare account ID', 'ai', 'Account identifier for the Cloudflare Workers AI brain.', false, 25, 'identifier'),
  ('openrouter_api_key', 'OpenRouter key', 'ai', 'Buddy brain number 5: free OpenRouter models only.', false, 26, 'secret'),
  ('cerebras_api_key', 'Cerebras key', 'ai', 'Buddy brain number 6: skipped until Cerebras is free again.', false, 27, 'secret'),
  ('huggingface_token', 'Hugging Face token', 'ai', 'Buddy brain number 7: a small free monthly credit, used near the end of the list.', false, 28, 'secret'),
  ('deepseek_api_key', 'DeepSeek key', 'ai', 'Buddy brain number 8: skipped until DeepSeek has a free path.', false, 29, 'secret')
ON CONFLICT (secret_name) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  purpose = EXCLUDED.purpose,
  required = EXCLUDED.required,
  sort_order = EXCLUDED.sort_order,
  credential_type = EXCLUDED.credential_type,
  enabled = true;
