// Days as numbers: days since 1 January 1970 in UTC, so a day's games and story are the same for
// everyone, and change at midnight UTC. Safe to import from client components.

export const DAY_MS = 86_400_000;

export const dayNumber = (now: number) => Math.floor(now / DAY_MS);

/** The first day of the daily games; the archive goes back to it. */
export const LAUNCH_DAY = dayNumber(Date.UTC(2026, 10, 28));

/** "2026-11-28". */
export const dateOfDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** "28 November 2026", for people. */
export const longDate = (day: number) =>
  new Date(day * DAY_MS).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** A day an address names, if it is one of the games' days up to today; otherwise today. */
export function dayIn(value: string, today: number): number {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? dayNumber(Date.parse(`${value}T00:00:00Z`)) : NaN;
  return day >= LAUNCH_DAY && day <= today ? day : today;
}

/** Today's number, for pages that wait for the request first (with `connection()`). */
export const todayNumber = () => dayNumber(Date.now());
