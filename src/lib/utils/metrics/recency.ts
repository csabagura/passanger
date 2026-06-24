/**
 * Derived-metrics engine — relative-time recency (Story 4.1 / FR-19, AC4).
 *
 * Consolidates the whole-calendar-day delta + `Intl.RelativeTimeFormat` logic that was inlined in
 * `HomeDashboard.svelte` ("the formal recency helper (FR-19) arrives in Story 4.1"). String output is
 * byte-identical to the inline version it replaces. Pure: injectable `now` (default `new Date()`).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole-day delta between two local calendar dates. Each date's LOCAL year/month/day is fed into
 * `Date.UTC`, so both operands share one UTC frame and the timezone offset cancels in the subtraction
 * — the "today / yesterday / N days ago" classification stays stable across the day (no Date mutation,
 * no DST drift). Positive when `to` is calendar-after `from`.
 */
export function wholeCalendarDaysBetween(from: Date, to: Date): number {
	const fromMidnight = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
	const toMidnight = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
	return Math.round((toMidnight - fromMidnight) / MS_PER_DAY);
}

/**
 * Localized relative-time string for `date` vs `now`, e.g. `today` / `yesterday` / `5 days ago`
 * (`numeric: 'auto'`). A past date yields a negative day delta ("… ago"); the runtime locale is used
 * (matching the app's other `Intl` usages). The `Last fill-up: ` prefix lives at the call site.
 */
export function recency(date: Date, now: Date = new Date()): string {
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	return rtf.format(wholeCalendarDaysBetween(now, date), 'day');
}
