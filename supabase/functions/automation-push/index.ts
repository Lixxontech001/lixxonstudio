import { handleAutomationPush } from "./handler.ts";

Deno.serve((req: Request) => handleAutomationPush(req));
