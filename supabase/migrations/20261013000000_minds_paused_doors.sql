-- Buddy phase 8 slice 3: the owner can pause a free door from chat (Takeover on).
-- One new column on the one-row minds_controls table. Empty means no door is paused.
-- Only the twelve free door ids may be listed. Owner-only rules on this table are unchanged.
-- Additive. NOT applied to production. Until it is applied, the day run reads the pause list as empty.

ALTER TABLE public.minds_controls
  ADD COLUMN IF NOT EXISTS paused_doors text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.minds_controls
  DROP CONSTRAINT IF EXISTS minds_controls_paused_doors_known;

ALTER TABLE public.minds_controls
  ADD CONSTRAINT minds_controls_paused_doors_known
  CHECK (paused_doors <@ ARRAY[
    'telegram', 'bluesky', 'mastodon', 'tumblr', 'discord', 'blogger',
    'medium', 'youtube', 'pixelfed', 'wordpress_com', 'podcast', 'vimeo'
  ]::text[]);
