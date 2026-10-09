-- Buddy phase 1 slice 4: the morning briefing thread, the "last seen" marker, and the Reports door.
-- Owner-only, like the chat tables. Nothing here posts, sends or edits content.

-- 1. A briefing is a chat of its own kind: one per owner per local day.
ALTER TABLE public.buddy_chats
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'chat',
  ADD COLUMN IF NOT EXISTS briefing_date date;

ALTER TABLE public.buddy_chats DROP CONSTRAINT IF EXISTS buddy_chats_kind_check;
ALTER TABLE public.buddy_chats ADD CONSTRAINT buddy_chats_kind_check CHECK (kind IN ('chat', 'briefing'));
ALTER TABLE public.buddy_chats DROP CONSTRAINT IF EXISTS buddy_chats_briefing_date_check;
ALTER TABLE public.buddy_chats ADD CONSTRAINT buddy_chats_briefing_date_check
  CHECK ((kind = 'briefing') = (briefing_date IS NOT NULL));
ALTER TABLE public.buddy_chats DROP CONSTRAINT IF EXISTS buddy_chats_one_briefing_per_day;
ALTER TABLE public.buddy_chats ADD CONSTRAINT buddy_chats_one_briefing_per_day UNIQUE (owner_id, briefing_date);

-- 2. Briefing messages carry a small structure next to their plain-text summary.
ALTER TABLE public.buddy_messages
  ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE public.buddy_messages DROP CONSTRAINT IF EXISTS buddy_messages_kind_check;
ALTER TABLE public.buddy_messages ADD CONSTRAINT buddy_messages_kind_check CHECK (kind IN ('reply', 'notice', 'briefing'));
ALTER TABLE public.buddy_messages DROP CONSTRAINT IF EXISTS buddy_messages_payload_check;
ALTER TABLE public.buddy_messages ADD CONSTRAINT buddy_messages_payload_check
  CHECK (payload IS NULL OR jsonb_typeof(payload) = 'object');

-- 3. When the owner last clicked Continue. "Since you left" is measured from here.
CREATE TABLE IF NOT EXISTS public.buddy_owner_state (
  owner_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.buddy_owner_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buddy_owner_state_owner_select ON public.buddy_owner_state;
CREATE POLICY buddy_owner_state_owner_select ON public.buddy_owner_state
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

DROP POLICY IF EXISTS buddy_owner_state_owner_insert ON public.buddy_owner_state;
CREATE POLICY buddy_owner_state_owner_insert ON public.buddy_owner_state
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

DROP POLICY IF EXISTS buddy_owner_state_owner_update ON public.buddy_owner_state;
CREATE POLICY buddy_owner_state_owner_update ON public.buddy_owner_state
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()))
  WITH CHECK (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

REVOKE ALL ON public.buddy_owner_state FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.buddy_owner_state TO authenticated;
GRANT UPDATE (last_seen_at, updated_at) ON public.buddy_owner_state TO authenticated;

-- 4. Night reports. Only the path exists in this phase: the list reads from here, and nothing writes to it yet.
CREATE TABLE IF NOT EXISTS public.buddy_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 20000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS buddy_reports_owner_recent ON public.buddy_reports (owner_id, report_date DESC);
ALTER TABLE public.buddy_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buddy_reports_owner_select ON public.buddy_reports;
CREATE POLICY buddy_reports_owner_select ON public.buddy_reports
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

REVOKE ALL ON public.buddy_reports FROM PUBLIC, anon;
GRANT SELECT ON public.buddy_reports TO authenticated;
