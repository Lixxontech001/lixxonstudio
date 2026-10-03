-- Make topic optional in contact_messages RLS policy
-- The form no longer requires a subject/topic field
DROP POLICY IF EXISTS "public_submit_contact" ON contact_messages;

CREATE POLICY "public_submit_contact" ON contact_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(TRIM(BOTH FROM name)) >= 2
    AND length(TRIM(BOTH FROM email)) >= 5
    AND POSITION('@' IN email) > 1
    AND length(TRIM(BOTH FROM message)) >= 10
  );
