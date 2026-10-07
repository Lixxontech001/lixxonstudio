// TypeScript shim for the Deno npm: specifier used by Supabase Edge Functions.
declare module "npm:@supabase/supabase-js@2.57.4" {
  export { createClient } from "@supabase/supabase-js";
  export type { SupabaseClient } from "@supabase/supabase-js";
}
