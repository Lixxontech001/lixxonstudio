// The Analyst's week against last week: paid orders and article views, real counts only.
// "This week" is the last 7 days. "Last week" is the 7 days before that. Rolling windows, so no time zone is guessed.
// Pure rules. The day run and the briefing pass in the counts; nothing here reads the database.

import type { NotablePlan } from "./notableSources.ts";

export const WEEK_DAYS = 7;
/** A spike or a drop is only news when the bigger count clears this floor, so 0 to 1 is never a spike. */
export const VIEW_FLOOR = 20;
export const PAID_FLOOR = 3;
/** Within this share of last week's count, the two weeks are about the same. */
const SAME_SHARE = 0.1;

export const CANNOT_SEE_LAST_WEEK = "I cannot see last week yet.";

export interface WeekCounts {
  views: number;
  paid: number;
}

/** `ok` is false when any count could not be read. Then the sentence says so, and no notable is written. */
export interface WeekFacts {
  ok: boolean;
  thisWeek: WeekCounts;
  lastWeek: WeekCounts;
}

export interface WeekWindows {
  /** Start of the last 7 days (this week). */
  thisStart: string;
  /** Start of the 7 days before that (last week). */
  lastStart: string;
  /** Now, as an ISO time. Counts are taken up to here. */
  end: string;
}

export function weekWindows(now: Date): WeekWindows {
  const day = 24 * 60 * 60 * 1000;
  return {
    thisStart: new Date(now.getTime() - WEEK_DAYS * day).toISOString(),
    lastStart: new Date(now.getTime() - 2 * WEEK_DAYS * day).toISOString(),
    end: now.toISOString(),
  };
}

export type WeekDirection = "up" | "down" | "same";

/** Up, down, or about the same. Going from nothing to something is up. Within 10% of last week is the same. */
export function weekDirection(thisCount: number, lastCount: number): WeekDirection {
  if (thisCount === lastCount) return "same";
  if (lastCount === 0) return "up";
  const share = Math.abs(thisCount - lastCount) / lastCount;
  if (share <= SAME_SHARE) return "same";
  return thisCount > lastCount ? "up" : "down";
}

const DIRECTION_WORD: Record<WeekDirection, string> = { up: "up", down: "down", same: "about the same" };

/** One plain sentence for the briefing. Null when the week was not asked for. Honest when a count is missing. */
export function weekSentence(facts: WeekFacts | undefined): string | null {
  if (!facts) return null;
  if (!facts.ok) return CANNOT_SEE_LAST_WEEK;
  const views = facts.thisWeek.views;
  const lastViews = facts.lastWeek.views;
  const paid = facts.thisWeek.paid;
  const lastPaid = facts.lastWeek.paid;
  return `Against the 7 days before, the last 7 days have article views ${DIRECTION_WORD[weekDirection(views, lastViews)]} (${views} against ${lastViews}) and paid orders ${DIRECTION_WORD[weekDirection(paid, lastPaid)]} (${paid} against ${lastPaid}).`;
}

/** The ISO week of the owner's local day, such as 2026-W41. Used so a spike or drop is written once per week. */
export function isoWeekKey(localDay: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDay)) return localDay;
  const [year, month, day] = localDay.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = (date.getUTCDay() + 6) % 7; // Monday is 0
  date.setUTCDate(date.getUTCDate() - weekday + 3); // the Thursday of this week decides the year
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + firstWeekday) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

interface Measure {
  name: "views" | "paid";
  label: string;
  floor: number;
  thisCount: number;
  lastCount: number;
}

/**
 * A notable when this week is at least twice last week (and clears the floor), or at most half of last week
 * (and last week cleared the floor). Keyed by the ISO week, so the same spike is written once that week, and a
 * heartbeat with the same numbers writes nothing new.
 */
export function planWeekNotables(facts: WeekFacts | undefined, localDay: string): NotablePlan[] {
  if (!facts || !facts.ok) return [];
  const week = isoWeekKey(localDay);
  const measures: Measure[] = [
    { name: "views", label: "Article views", floor: VIEW_FLOOR, thisCount: facts.thisWeek.views, lastCount: facts.lastWeek.views },
    { name: "paid", label: "Paid orders", floor: PAID_FLOOR, thisCount: facts.thisWeek.paid, lastCount: facts.lastWeek.paid },
  ];
  const plans: NotablePlan[] = [];
  for (const measure of measures) {
    const { thisCount, lastCount, label, name, floor } = measure;
    const detail = `${thisCount} in the last 7 days, ${lastCount} in the 7 days before. Buddy changed nothing.`;
    if (thisCount >= floor && thisCount >= 2 * lastCount) {
      plans.push({ key: `week:${week}:${name}:up`, kind: "week_up", mind: "analyst", title: `${label} are up this week.`, detail });
    } else if (lastCount >= floor && thisCount * 2 <= lastCount) {
      plans.push({ key: `week:${week}:${name}:down`, kind: "week_down", mind: "analyst", title: `${label} are down this week.`, detail });
    }
  }
  return plans;
}
