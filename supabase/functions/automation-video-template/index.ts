import { handleAutomationVideoTemplate } from "./handler.ts";

Deno.serve((req: Request) => handleAutomationVideoTemplate(req));
