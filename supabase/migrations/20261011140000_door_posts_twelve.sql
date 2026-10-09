-- Phase 6 slice 2: the door-post table accepts all twelve auto doors, so later slices can record posts for them.
-- Only the table's check changes. The reservation function (minds_reserve_door_post, last set in
-- 20261011120000_door_posts_open_all.sql) still accepts only the six doors that have a send step. A door is opened
-- for posting in the slice that builds its send step, together with its function change.
-- The four gated channels are not in this list, and never will be. Additive. NOT applied to production.

ALTER TABLE public.minds_door_posts DROP CONSTRAINT IF EXISTS minds_door_posts_door_check;

ALTER TABLE public.minds_door_posts ADD CONSTRAINT minds_door_posts_door_check CHECK (door IN (
  'telegram', 'bluesky', 'mastodon', 'tumblr', 'discord', 'blogger',
  'medium', 'youtube', 'pixelfed', 'wordpress_com', 'podcast', 'vimeo'
));
