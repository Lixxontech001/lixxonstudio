-- Buddy phase 9 slice 1: the seeded video template has no city in its name. Renames the seeded row only.
-- Edits nothing else in the template. Additive. NOT applied to production.

UPDATE public.video_templates
   SET name = 'Clear daylight (default)'
 WHERE name = 'Lagos daylight (default)'
   AND NOT EXISTS (SELECT 1 FROM public.video_templates WHERE name = 'Clear daylight (default)');
