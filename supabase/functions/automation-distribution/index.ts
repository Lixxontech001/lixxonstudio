import { handleAutomationDistribution } from "./handler.ts";

Deno.serve((req: Request) => handleAutomationDistribution(req));
