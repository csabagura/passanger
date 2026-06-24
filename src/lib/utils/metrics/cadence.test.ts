import { describe, expect, it } from 'vitest';
import type { FuelLog } from '$lib/db/schema';
import { cadence } from './cadence';

function createFuelEntry(overrides: Partial<FuelLog> = {}): FuelLog {
	return {
		id: overrides.id ?? 9,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 5, 10, 12, 0, 0, 0),
		odometer: overrides.odometer ?? 87400,
		quantity: overrides.quantity ?? 42,
		unit: overrides.unit ?? 'L',
		distanceUnit: overrides.distanceUnit ?? 'km',
		totalCost: overrides.totalCost ?? 78,
		currency: overrides.currency,
		calculatedConsumption: overrides.calculatedConsumption ?? 7,
		notes: overrides.notes ?? ''
	};
}

// Reference "now" — 15 June 2026, 09:00 local. The trailing window reaches back ~17 March.
const NOW = new Date(2026, 5, 15, 9, 0, 0, 0);

describe('cadence', () => {
	it('is insufficient (too-few-logs) for 0, 1, or 2 in-window logs', () => {
		expect(cadence([], NOW)).toEqual({ status: 'insufficient', reason: 'too-few-logs' });
		expect(cadence([createFuelEntry({ id: 1, date: new Date(2026, 5, 10) })], NOW)).toEqual({
			status: 'insufficient',
			reason: 'too-few-logs'
		});
		const two = [
			createFuelEntry({ id: 1, date: new Date(2026, 5, 5), odometer: 1000 }),
			createFuelEntry({ id: 2, date: new Date(2026, 5, 14), odometer: 1300 })
		];
		expect(cadence(two, NOW)).toEqual({ status: 'insufficient', reason: 'too-few-logs' });
	});

	it('is insufficient (span-too-short) for 3 logs spanning under 14 days', () => {
		const logs = [
			createFuelEntry({ id: 1, date: new Date(2026, 5, 5), odometer: 1000 }),
			createFuelEntry({ id: 2, date: new Date(2026, 5, 10), odometer: 1200 }),
			createFuelEntry({ id: 3, date: new Date(2026, 5, 15), odometer: 1500 })
		];
		expect(cadence(logs, NOW)).toEqual({ status: 'insufficient', reason: 'span-too-short' });
	});

	it('reports km/day for 3 logs spanning 20 days', () => {
		const logs = [
			createFuelEntry({ id: 1, date: new Date(2026, 4, 26), odometer: 1000 }),
			createFuelEntry({ id: 2, date: new Date(2026, 5, 5), odometer: 1300 }),
			createFuelEntry({ id: 3, date: new Date(2026, 5, 15), odometer: 1700 })
		];
		const result = cadence(logs, NOW);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.spanDays).toBe(20);
		expect(result.logsConsidered).toBe(3);
		expect(result.distanceUnit).toBe('km');
		expect(result.distancePerDay).toBeCloseTo(700 / 20, 6); // 35 km/day
	});

	it('excludes logs older than the 90-day window', () => {
		const logs = [
			createFuelEntry({ id: 0, date: new Date(2026, 2, 1), odometer: 1 }), // ~106 days ago → excluded
			createFuelEntry({ id: 1, date: new Date(2026, 4, 26), odometer: 1000 }),
			createFuelEntry({ id: 2, date: new Date(2026, 5, 5), odometer: 1300 }),
			createFuelEntry({ id: 3, date: new Date(2026, 5, 15), odometer: 1700 })
		];
		const result = cadence(logs, NOW);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		// The March log is excluded, so the span is still 20 days (not ~106) and only 3 logs count.
		expect(result.spanDays).toBe(20);
		expect(result.logsConsidered).toBe(3);
	});

	it('drops a non-finite odometer instead of poisoning the span', () => {
		const logs = [
			createFuelEntry({ id: 1, date: new Date(2026, 4, 26), odometer: 1000 }),
			createFuelEntry({ id: 2, date: new Date(2026, 5, 5), odometer: 1300 }),
			createFuelEntry({ id: 3, date: new Date(2026, 5, 15), odometer: 1700 }),
			createFuelEntry({ id: 4, date: new Date(2026, 5, 12), odometer: Number.NaN })
		];
		const result = cadence(logs, NOW);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.logsConsidered).toBe(3);
		expect(Number.isFinite(result.distancePerDay)).toBe(true);
		expect(result.distancePerDay).toBeCloseTo(35, 6);
	});

	it('is insufficient (no-distance) when the odometer never advances', () => {
		const logs = [
			createFuelEntry({ id: 1, date: new Date(2026, 4, 26), odometer: 1000 }),
			createFuelEntry({ id: 2, date: new Date(2026, 5, 5), odometer: 1000 }),
			createFuelEntry({ id: 3, date: new Date(2026, 5, 15), odometer: 1000 })
		];
		expect(cadence(logs, NOW)).toEqual({ status: 'insufficient', reason: 'no-distance' });
	});

	it('is insufficient (no-distance) when the odometer goes backwards across the window', () => {
		// A typo / rollover / unit-swap on the latest reading: date-ordered net travel is negative, so
		// the rate is not guessable (max − min would wrongly report a confident positive 800/20 here).
		const logs = [
			createFuelEntry({ id: 1, date: new Date(2026, 4, 26), odometer: 1000 }),
			createFuelEntry({ id: 2, date: new Date(2026, 5, 5), odometer: 1700 }),
			createFuelEntry({ id: 3, date: new Date(2026, 5, 15), odometer: 900 })
		];
		expect(cadence(logs, NOW)).toEqual({ status: 'insufficient', reason: 'no-distance' });
	});

	it('ignores a single high odometer outlier (date-ordered net travel, not max − min)', () => {
		// A mid-window fat-finger (9999) must not inflate the rate: net travel is 1500 − 1000 = 500 over
		// 20 days = 25/day, NOT (9999 − 1000) / 20.
		const logs = [
			createFuelEntry({ id: 1, date: new Date(2026, 4, 26), odometer: 1000 }),
			createFuelEntry({ id: 2, date: new Date(2026, 5, 5), odometer: 9999 }),
			createFuelEntry({ id: 3, date: new Date(2026, 5, 15), odometer: 1500 })
		];
		const result = cadence(logs, NOW);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.distancePerDay).toBeCloseTo(500 / 20, 6);
	});

	it('computes in the most-recent log unit when the window mixes km/mi (no raw subtraction)', () => {
		const logs = [
			createFuelEntry({ id: 1, date: new Date(2026, 4, 26), odometer: 1000, distanceUnit: 'km' }),
			createFuelEntry({ id: 2, date: new Date(2026, 5, 5), odometer: 1300, distanceUnit: 'km' }),
			createFuelEntry({ id: 3, date: new Date(2026, 5, 15), odometer: 850, distanceUnit: 'mi' })
		];
		const result = cadence(logs, NOW);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.distanceUnit).toBe('mi');
		expect(result.distancePerDay).toBeGreaterThan(0);
		expect(Number.isFinite(result.distancePerDay)).toBe(true);
	});
});
