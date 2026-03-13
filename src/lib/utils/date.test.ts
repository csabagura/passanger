import { describe, expect, it } from 'vitest';
import {
	formatLocalCalendarDate,
	getTodayDateInputValue,
	parseDateInputValue,
	toLocalDateInputValue
} from './date';

describe('date utilities', () => {
	it('derives a local yyyy-mm-dd input value from a Date', () => {
		const today = new Date(2026, 2, 10, 23, 59, 59);
		expect(getTodayDateInputValue(today)).toBe('2026-03-10');
	});

	it('parses a date input value into a stable local calendar Date', () => {
		const parsed = parseDateInputValue('2026-03-10');
		expect(parsed).toBeInstanceOf(Date);
		expect(parsed?.getHours()).toBe(12);
		expect(parsed && toLocalDateInputValue(parsed)).toBe('2026-03-10');
	});

	it('rejects invalid calendar dates and malformed strings', () => {
		expect(parseDateInputValue('')).toBeNull();
		expect(parseDateInputValue('2026/03/10')).toBeNull();
		expect(parseDateInputValue('2026-02-30')).toBeNull();
		expect(parseDateInputValue('2026-13-10')).toBeNull();
	});

	it('round-trips DST-adjacent local dates without day drift assumptions', () => {
		const spring = parseDateInputValue('2026-03-29');
		const autumn = parseDateInputValue('2026-10-25');

		expect(spring && toLocalDateInputValue(spring)).toBe('2026-03-29');
		expect(autumn && toLocalDateInputValue(autumn)).toBe('2026-10-25');
	});

	it('formats stored dates for display using local calendar fields', () => {
		const parsed = parseDateInputValue('2026-03-10');
		expect(parsed && formatLocalCalendarDate(parsed, 'en-GB')).toBe('10 Mar 2026');
	});
});
