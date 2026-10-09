-- Buddy phase 1 slice 3: private chats for the owner only.
-- Owner rule is the same one the Automation keys catalogue uses: admin + (owner or founder).
-- Chats and messages are private to the owner row by row; anon has no access at all.

CREATE TABLE IF NOT EXISTS public.buddy_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text CHECK (title IS NULL OR char_length(title) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.buddy_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.buddy_chats(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'buddy')),
  kind text NOT NULL DEFAULT 'reply' CHECK (kind IN ('reply', 'notice')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS buddy_chats_owner_recent ON public.buddy_chats (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS buddy_messages_chat_order ON public.buddy_messages (chat_id, created_at);

ALTER TABLE public.buddy_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buddy_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buddy_chats_owner_select ON public.buddy_chats;
CREATE POLICY buddy_chats_owner_select ON public.buddy_chats
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

DROP POLICY IF EXISTS buddy_chats_owner_insert ON public.buddy_chats;
CREATE POLICY buddy_chats_owner_insert ON public.buddy_chats
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

DROP POLICY IF EXISTS buddy_chats_owner_update ON public.buddy_chats;
CREATE POLICY buddy_chats_owner_update ON public.buddy_chats
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()))
  WITH CHECK (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

DROP POLICY IF EXISTS buddy_messages_owner_select ON public.buddy_messages;
CREATE POLICY buddy_messages_owner_select ON public.buddy_messages
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_admin() AND (public.is_owner() OR public.is_founder()));

DROP POLICY IF EXISTS buddy_messages_owner_insert ON public.buddy_messages;
CREATE POLICY buddy_messages_owner_insert ON public.buddy_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND public.is_admin() AND (public.is_owner() OR public.is_founder())
    AND EXISTS (SELECT 1 FROM public.buddy_chats c WHERE c.id = chat_id AND c.owner_id = auth.uid())
  );

REVOKE ALL ON public.buddy_chats FROM PUBLIC, anon;
REVOKE ALL ON public.buddy_messages FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.buddy_chats TO authenticated;
-- Only the title and the last-activity time of a chat may change after creation.
GRANT UPDATE (title, updated_at) ON public.buddy_chats TO authenticated;
GRANT SELECT, INSERT ON public.buddy_messages TO authenticated;
