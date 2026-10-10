// What Buddy says after an order: waiting, done, or blocked. One plain line each.
// Pure: the caller passes what it knows (Takeover, what changed, the Auditor's reason).

export type OrderFeedback =
  | { state: "waiting"; takeover: boolean | null; mind?: string }
  | { state: "done"; what: string }
  | { state: "blocked"; reason: string };

function sentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

/**
 * The owner-facing line for an order the day run reports. An applied change reads "Done." with the names
 * (the placement detail names the product and the article). Any other status keeps its plain detail.
 */
export function orderOutcomeLine(status: string, detail: string): string {
  return status === "applied" ? feedbackLine({ state: "done", what: detail }) : detail;
}

export function feedbackLine(feedback: OrderFeedback): string {
  if (feedback.state === "done") return `Done. ${sentence(feedback.what)}`;
  if (feedback.state === "blocked") return `Blocked. ${sentence(feedback.reason)} Nothing on the site changed.`;
  const head = feedback.mind ? `Saved for the ${feedback.mind}. It is waiting.` : "Saved. It is waiting.";
  if (feedback.takeover === true) return `${head} Takeover is on, so it runs on the next run.`;
  if (feedback.takeover === false) return `${head} Takeover is off, so nothing has changed.`;
  return `${head} I could not read Takeover just now, so nothing has changed.`;
}
