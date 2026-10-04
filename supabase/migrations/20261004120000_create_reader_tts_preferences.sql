-- =============================================================================
-- reader_tts_preferences — per-account listen settings (voice, rate, pitch,
-- volume, per-language voice memory). Guests keep theirs in localStorage only;
-- signed-in readers get cross-device sync. Least-privilege: no anon access at
-- all, each user manages only their own row.
-- =============================================================================

CREATE TABLE IF NOT EXISTS reader_tts_preferences (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reader_tts_preferences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON reader_tts_preferences FROM anon;
GRANT SELECT, INSERT, UPDATE ON reader_tts_preferences TO authenticated;

DROP POLICY IF EXISTS "users manage own tts prefs" ON reader_tts_preferences;
CREATE POLICY "users manage own tts prefs"
  ON reader_tts_preferences
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
