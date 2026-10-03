// Minimal Deno ambient types so the edge functions can be type-checked with the repo's tsc.
// (The real runtime is Supabase Edge / Deno; this file is never deployed.)
declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
}
declare module "npm:@supabase/supabase-js@2.57.4" {
  export * from "@supabase/supabase-js";
}
