// Key names this site never offers. The Keys page, the key list parser and the keys function all read this one list,
// so a retired name can never be typed, saved or tested again from the site.
//
// Why each group is here:
// - WhatsApp is not a door and never posts.
// - The two dead "thinking keys" (OpenAI and Anthropic) are not brains any more: Buddy tries the eight free brains
//   on the Brains page. Nothing in the code posts, sends or thinks with them.
// - The social rows with no leftover job: Instagram, Facebook, TikTok and Pinterest are posted by hand; Threads,
//   LinkedIn and X have no sender in the day run at all.
// The matching migration (supabase/migrations/20261020000000_retire_dead_keys.sql) turns these catalogue rows off.
// That migration is NOT applied. This list is what the site shows either way. Saved values are never deleted.
export const NOT_OFFERED_KEY_NAMES: readonly string[] = [
  // Not a door, never asked for.
  'whatsapp_access_token',
  'whatsapp_phone_number_id',
  // Dead thinking keys.
  'openai_api_key',
  'anthropic_api_key',
  'claude_api_key',
  // Social rows with no leftover job.
  'meta_app_secret',
  'meta_access_token',
  'facebook_page_id',
  'facebook_page_token',
  'threads_access_token',
  'tiktok_client_secret',
  'tiktok_client_key',
  'tiktok_access_token',
  'pinterest_access_token',
  'pinterest_board_id',
  'linkedin_client_secret',
  'linkedin_client_key',
  'linkedin_access_token',
  'x_api_secret',
  'x_api_key',
  'x_access_token',
];

export function isNotOfferedKey(name: string): boolean {
  return NOT_OFFERED_KEY_NAMES.includes(name);
}
