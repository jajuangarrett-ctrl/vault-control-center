import type { ReviewRow } from "./file-review";
export interface ReviewDay { key: string; label: string; rows: ReviewRow[] }
/** Preserve the producer's written calendar day; never convert timestamps to local time. */
export function processingDay(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(value);
  if (!match) return null;
  const day = match[0].slice(0, 10);
  const parsed = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}
export function groupReviewDays(rows: ReviewRow[]): ReviewDay[] {
  const groups = new Map<string, ReviewDay>();
  for (const row of rows) {
    const days = row.history.map(event => processingDay(event.processed)).filter((day): day is string => !!day).sort().reverse();
    const key = days[0] ?? "unknown";
    let group = groups.get(key);
    if (!group) {
      group = { key, label: key === "unknown" ? "Unknown processing date" : new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }), rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()].sort((a, b) => a.key === "unknown" ? 1 : b.key === "unknown" ? -1 : b.key.localeCompare(a.key));
}
export function reviewDayOpen(choices: Map<string, boolean>, scope: string, day: string, index: number): boolean {
  return choices.get(JSON.stringify([scope, day])) ?? (!!scope || index === 0);
}
export function setReviewDayOpen(choices: Map<string, boolean>, scope: string, day: string, open: boolean): void {
  choices.set(JSON.stringify([scope, day]), open);
}
