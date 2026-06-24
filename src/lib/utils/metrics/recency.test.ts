import { describe, expect, it } from 'vitest';
import { recency, wholeCalendarDaysBetween } from './recency';

// Locale-independent expectations: derive the words from the same Intl API the helper uses (mirrors
// the HomeDashboard recency tests), so this passes regardless of the runtime locale.
function relativeDay(days: number): string {
	return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(days, 'day');
}

const NOW = new Date(2026, 5, 15, 9, 0, 0, 0);

describe('wholeCalendarDaysBetween', () => {
	it('is 0 for two times on the same calendar day', () => {
		expect(
			wholeCalendarDaysBetween(new Date(2026, 5, 15, 1, 0), new Date(2026, 5, 15, 23, 0))
		).toBe(0);
	});

	it('is positive when `to` is calendar-after `from`', () => {
		expect(wholeCalendarDaysBetween(new Date(2026, 5, 10), new Date(2026, 5, 15))).toBe(5);
	});

	it('is negative when `to` is calendar-before `from`', () => {
		expect(wholeCalendarDaysBetween(new Date(2026, 5, 15), new Date(2026, 5, 10))).toBe(-5);
	});

	it('counts whole calendar days across a small time gap (boundary stability)', () => {
		// Only two hours apart in wall-clock time, but different calendar days → a whole-day delta of 1.
		expect(
			wholeCalendarDaysBetween(new Date(2026, 5, 14, 23, 0), new Date(2026, 5, 15, 1, 0))
		).toBe(1);
	});
});

describe('recency', () => {
	it('returns "today" for a same-day date', () => {
		expect(recency(NOW, NOW)).toBe(relativeDay(0));
	});

	it('returns "yesterday" for the previous calendar day', () => {
		expect(recency(new Date(2026, 5, 14, 12, 0), NOW)).toBe(relativeDay(-1));
	});

	it('returns "5 days ago" for a date five calendar days back', () => {
		expect(recency(new Date(2026, 5, 10, 12, 0), NOW)).toBe(relativeDay(-5));
	});

	it('classifies by calendar day, not elapsed hours (yesterday despite a 2-hour gap)', () => {
		const now = new Date(2026, 5, 15, 1, 0);
		const fill = new Date(2026, 5, 14, 23, 0);
		expect(recency(fill, now)).toBe(relativeDay(-1));
	});
});
