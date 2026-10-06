import { handleAutomationRunner } from "./handler.ts";

Deno.serve((req: Request) => handleAutomationRunner(req));
