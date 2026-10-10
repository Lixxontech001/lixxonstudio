-- Buddy phase 1 slice 5: the owner's look and the optional read-aloud switch.
-- Both live on the owner's row in buddy_owner_state, so they follow the owner to any device.

-- "Last seen" starts empty. Saving settings before the first briefing must not count as having looked,
-- otherwise "since you left" would look back over the wrong window.
ALTER TABLE public.buddy_owner_state ALTER COLUMN last_seen_at DROP NOT NULL;
ALTER TABLE public.buddy_owner_state ALTER COLUMN last_seen_at DROP DEFAULT;

ALTER TABLE public.buddy_owner_state
  ADD COLUMN IF NOT EXISTS vibe text NOT NULL DEFAULT 'noir-gold',
  ADD COLUMN IF NOT EXISTS speak_replies boolean NOT NULL DEFAULT false;

ALTER TABLE public.buddy_owner_state DROP CONSTRAINT IF EXISTS buddy_owner_state_vibe_check;
ALTER TABLE public.buddy_owner_state ADD CONSTRAINT buddy_owner_state_vibe_check
  CHECK (vibe IN ('noir-gold', 'ivory-silk', 'velvet-opera', 'porcelain'));

-- The owner may change only these two settings, plus the timestamps the app already writes.
GRANT UPDATE (vibe, speak_replies) ON public.buddy_owner_state TO authenticated;
