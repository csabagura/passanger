import { describe, expect, it } from 'vitest';
import type { Expense, FuelLog } from '$lib/db/schema';
import { mergeHistoryEntries } from '$lib/utils/historyEntries';
import { comparePeriods, consumptionDelta, spendDelta, costPerDistanceDelta } from './periodDelta';

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

function createMaintenanceEntry(overrides: Partial<Expense> = {}): Expense {
	return {
		id: overrides.id ?? 12,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 5, 10, 12, 0, 0, 0),
		type: overrides.type ?? 'Oil Change',
		odometer: overrides.odometer ?? 87400,
		cost: overrides.cost ?? 78,
		currency: overrides.currency,
		notes: overrides.notes ?? ''
	};
}

// Reference "now" — June 2026. Current calendar month = June (month index 5), previous = May (4).
const NOW = new Date(2026, 5, 15, 9, 0, 0, 0);
const JUNE = new Date(2026, 5, 10);
const MAY = new Date(2026, 4, 10);

describe('comparePeriods', () => {
	it('is insufficient (missing-period) when either side is null', () => {
		expect(comparePeriods(null, 5)).toEqual({ status: 'insufficient', reason: 'missing-period' });
		expect(comparePeriods(5, null)).toEqual({ status: 'insufficient', reason: 'missing-period' });
	});

	it('is insufficient (missing-period) when either side is non-finite', () => {
		expect(comparePeriods(Number.NaN, 5)).toEqual({
			status: 'insufficient',
			reason: 'missing-period'
		});
		expect(comparePeriods(5, Number.POSITIVE_INFINITY)).toEqual({
			status: 'insufficient',
			reason: 'missing-period'
		});
	});

	it('is insufficient (no-baseline) when previous is 0', () => {
		expect(comparePeriods(6, 0)).toEqual({ status: 'insufficient', reason: 'no-baseline' });
	});

	it('is insufficient (no-baseline) when previous is negative', () => {
		// A refund/credit can net a previous-month spend negative; a percent vs a negative baseline
		// would sign-flip against `direction` (e.g. up-but-negative-percent), so treat it as no baseline.
		expect(comparePeriods(6, -5)).toEqual({ status: 'insufficient', reason: 'no-baseline' });
		expect(comparePeriods(-10, -30)).toEqual({ status: 'insufficient', reason: 'no-baseline' });
	});

	it('is insufficient (no-current) when current is zero or negative (H19a regression)', () => {
		// A single 0-cost entry used to read as ok/−100% → "Spending is down about 100% this month".
		// A percent change to a non-positive current is as meaningless as one from a non-positive
		// baseline — symmetric guard.
		expect(comparePeriods(0, 300)).toEqual({ status: 'insufficient', reason: 'no-current' });
		expect(comparePeriods(-10, 30)).toEqual({ status: 'insufficient', reason: 'no-current' });
	});

	it('reports an upward change with signed absolute + percent', () => {
		expect(comparePeriods(6, 5)).toEqual({
			status: 'ok',
			current: 6,
			previous: 5,
			absoluteChange: 1,
			percentChange: 20,
			direction: 'up'
		});
	});

	it('reports a downward change with negative signs', () => {
		const result = comparePeriods(4, 5);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.absoluteChange).toBe(-1);
		expect(result.percentChange).toBe(-20);
		expect(result.direction).toBe('down');
	});

	it('reports flat when there is no change', () => {
		expect(comparePeriods(5, 5)).toEqual({
			status: 'ok',
			current: 5,
			previous: 5,
			absoluteChange: 0,
			percentChange: 0,
			direction: 'flat'
		});
	});
});

describe('consumptionDelta', () => {
	it('is insufficient with no logs', () => {
		expect(consumptionDelta([], 'L/100km', NOW)).toEqual({
			status: 'insufficient',
			reason: 'missing-period'
		});
	});

	it('is insufficient with only the current month (no prior baseline)', () => {
		const logs = [createFuelEntry({ id: 1, date: JUNE, calculatedConsumption: 7 })];
		expect(consumptionDelta(logs, 'L/100km', NOW)).toEqual({
			status: 'insufficient',
			reason: 'missing-period'
		});
	});

	it('compares the current calendar month against the previous one', () => {
		// 2 logs per month (H19b sample-size gate) — duplicating an identical log preserves the
		// volume-weighted average unchanged.
		const logs = [
			createFuelEntry({ id: 1, date: JUNE, calculatedConsumption: 8 }),
			createFuelEntry({ id: 2, date: JUNE, calculatedConsumption: 8 }),
			createFuelEntry({ id: 3, date: MAY, calculatedConsumption: 7 }),
			createFuelEntry({ id: 4, date: MAY, calculatedConsumption: 7 })
		];
		const result = consumptionDelta(logs, 'L/100km', NOW);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.current).toBeCloseTo(8, 6);
		expect(result.previous).toBeCloseTo(7, 6);
		expect(result.direction).toBe('up');
	});

	it('combines mixed L/gal rows within a month (volume-weighted)', () => {
		// Two June L-logs averaging-weighted; two May logs as baseline (H19b sample-size gate).
		const logs = [
			createFuelEntry({ id: 1, date: JUNE, calculatedConsumption: 8, quantity: 40 }),
			createFuelEntry({ id: 2, date: JUNE, calculatedConsumption: 6, quantity: 40 }),
			createFuelEntry({ id: 3, date: MAY, calculatedConsumption: 7 }),
			createFuelEntry({ id: 4, date: MAY, calculatedConsumption: 7 })
		];
		const result = consumptionDelta(logs, 'L/100km', NOW);
		expect(result.status).toBe('ok');
	});

	it('skips a non-finite consumption row rather than emitting NaN', () => {
		const logs = [
			createFuelEntry({ id: 1, date: JUNE, calculatedConsumption: Number.NaN }),
			createFuelEntry({ id: 2, date: JUNE, calculatedConsumption: 8 }),
			createFuelEntry({ id: 3, date: MAY, calculatedConsumption: 7 }),
			createFuelEntry({ id: 4, date: MAY, calculatedConsumption: 7 })
		];
		const result = consumptionDelta(logs, 'L/100km', NOW);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(Number.isFinite(result.current)).toBe(true);
		expect(result.current).toBeCloseTo(8, 6);
	});

	it('is insufficient (insufficient-sample) when a side has only a single fill-up (H19b)', () => {
		const logs = [
			createFuelEntry({ id: 1, date: JUNE, calculatedConsumption: 8 }),
			createFuelEntry({ id: 2, date: JUNE, calculatedConsumption: 8 }),
			createFuelEntry({ id: 3, date: MAY, calculatedConsumption: 7 }) // only 1 in May
		];
		expect(consumptionDelta(logs, 'L/100km', NOW)).toEqual({
			status: 'insufficient',
			reason: 'insufficient-sample'
		});
	});
});

describe('spendDelta', () => {
	it('isolates currencies and never sums across them', () => {
		// 2 entries per currency/period (H19b sample-size gate) — split totals so the sums are unchanged.
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({ id: 1, date: JUNE, totalCost: 60, currency: '€' }),
				createFuelEntry({ id: 2, date: JUNE, totalCost: 40, currency: '€' }),
				createFuelEntry({ id: 3, date: JUNE, totalCost: 50, currency: '$' }),
				createFuelEntry({ id: 4, date: MAY, totalCost: 50, currency: '€' }),
				createFuelEntry({ id: 5, date: MAY, totalCost: 30, currency: '€' })
			],
			[]
		);
		const result = spendDelta(entries, '€', NOW);
		expect(result['€']).toEqual({
			status: 'ok',
			current: 100,
			previous: 80,
			absoluteChange: 20,
			percentChange: 25,
			direction: 'up'
		});
		// $ exists only in the current month → no baseline.
		expect(result['$']).toEqual({ status: 'insufficient', reason: 'missing-period' });
	});

	it('attributes legacy no-currency rows to the home currency', () => {
		const entries = mergeHistoryEntries(
			[],
			[
				createMaintenanceEntry({ id: 1, date: JUNE, cost: 70, currency: undefined }),
				createMaintenanceEntry({ id: 2, date: JUNE, cost: 50, currency: undefined }),
				createMaintenanceEntry({ id: 3, date: MAY, cost: 60, currency: undefined }),
				createMaintenanceEntry({ id: 4, date: MAY, cost: 40, currency: undefined })
			]
		);
		const result = spendDelta(entries, '€', NOW);
		expect(result['€']?.status).toBe('ok');
		if (result['€']?.status !== 'ok') return;
		expect(result['€'].absoluteChange).toBe(20);
	});

	it('treats a negative previous-month net (refund/credit) as no-baseline, not a sign-flipped percent', () => {
		// May nets −30 (a 50 charge then an 80 refund); June is +10 (split 2 ways, H19b sample-size
		// gate). comparePeriods(10, −30) must be no-baseline — never `direction: 'up'` with a negative
		// percentChange.
		const entries = mergeHistoryEntries(
			[],
			[
				createMaintenanceEntry({ id: 1, date: MAY, cost: 50, currency: '€' }),
				createMaintenanceEntry({ id: 2, date: MAY, cost: -80, currency: '€' }),
				createMaintenanceEntry({ id: 3, date: JUNE, cost: 4, currency: '€' }),
				createMaintenanceEntry({ id: 4, date: JUNE, cost: 6, currency: '€' })
			]
		);
		expect(spendDelta(entries, '€', NOW)['€']).toEqual({
			status: 'insufficient',
			reason: 'no-baseline'
		});
	});

	it('returns no entries when there is no spend at all', () => {
		expect(spendDelta([], '€', NOW)).toEqual({});
	});

	it('is insufficient (insufficient-sample) when a currency has only a single entry on one side (H19b)', () => {
		const entries = mergeHistoryEntries(
			[],
			[
				createMaintenanceEntry({ id: 1, date: JUNE, cost: 60, currency: '€' }),
				createMaintenanceEntry({ id: 2, date: JUNE, cost: 40, currency: '€' }),
				createMaintenanceEntry({ id: 3, date: MAY, cost: 80, currency: '€' }) // only 1 in May
			]
		);
		expect(spendDelta(entries, '€', NOW)['€']).toEqual({
			status: 'insufficient',
			reason: 'insufficient-sample'
		});
	});

	it('H5: compares current month-to-date against the previous month over the same day range, not the full previous month', () => {
		// NOW is June 15 → dayLimit 15. Only May 1-15 entries should count toward the previous total.
		// Under the old (pre-fix) full-month comparison, May's full 300 vs June's 50 would have reported
		// a spurious "down about 83%". With the day clamp, May 1-15 is only 40, so June's 50 is UP.
		// 2 entries per window (H19b sample-size gate); the out-of-range May-20 entry doesn't count
		// toward either the total or the sample size.
		const entries = mergeHistoryEntries(
			[],
			[
				createMaintenanceEntry({ id: 1, date: new Date(2026, 4, 8), cost: 15, currency: '€' }), // May 8, within range
				createMaintenanceEntry({ id: 2, date: new Date(2026, 4, 10), cost: 25, currency: '€' }), // May 10, within range
				createMaintenanceEntry({ id: 3, date: new Date(2026, 4, 20), cost: 260, currency: '€' }), // May 20, OUT of range
				createMaintenanceEntry({ id: 4, date: new Date(2026, 5, 5), cost: 20, currency: '€' }), // June 5
				createMaintenanceEntry({ id: 5, date: new Date(2026, 5, 6), cost: 30, currency: '€' }) // June 6, current month-to-date
			]
		);
		const result = spendDelta(entries, '€', NOW);
		expect(result['€']).toEqual({
			status: 'ok',
			current: 50,
			previous: 40,
			absoluteChange: 10,
			percentChange: 25,
			direction: 'up'
		});
	});

	it('H5: clamps the day-of-month filter when the current day exceeds the previous month length', () => {
		// Querying on July 31 against June (30 days) — every June entry satisfies `<= 31` unclamped by
		// throwing or matching nothing; the previous window is effectively the whole month.
		const JULY_31 = new Date(2026, 6, 31, 9, 0, 0, 0);
		const entries = mergeHistoryEntries(
			[],
			[
				createMaintenanceEntry({ id: 1, date: new Date(2026, 5, 1), cost: 30, currency: '€' }),
				createMaintenanceEntry({ id: 2, date: new Date(2026, 5, 30), cost: 30, currency: '€' }),
				createMaintenanceEntry({ id: 3, date: new Date(2026, 6, 15), cost: 40, currency: '€' }),
				createMaintenanceEntry({ id: 4, date: new Date(2026, 6, 20), cost: 50, currency: '€' })
			]
		);
		const result = spendDelta(entries, '€', JULY_31);
		expect(result['€']).toEqual({
			status: 'ok',
			current: 90,
			previous: 60,
			absoluteChange: 30,
			percentChange: 50,
			direction: 'up'
		});
	});
});

describe('costPerDistanceDelta', () => {
	it('compares fuel cost-per-distance per currency month-over-month', () => {
		// distance for an L log = (quantity / consumption) * 100. With quantity 50, consumption 10 →
		// 500 km. costPerDistance = totalCost / 500. 2 logs per month (H19b sample-size gate) —
		// duplicating an identical log doubles both totalCost and totalDistance, preserving the ratio.
		const logs = [
			createFuelEntry({
				id: 1,
				date: JUNE,
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 100,
				currency: '€'
			}),
			createFuelEntry({
				id: 2,
				date: JUNE,
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 100,
				currency: '€'
			}),
			createFuelEntry({
				id: 3,
				date: MAY,
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 80,
				currency: '€'
			}),
			createFuelEntry({
				id: 4,
				date: MAY,
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 80,
				currency: '€'
			})
		];
		const result = costPerDistanceDelta(logs, '€', 'L/100km', NOW);
		expect(result['€']?.status).toBe('ok');
		if (result['€']?.status !== 'ok') return;
		expect(result['€'].current).toBeCloseTo(100 / 500, 6);
		expect(result['€'].previous).toBeCloseTo(80 / 500, 6);
		expect(result['€'].direction).toBe('up');
	});

	it('is insufficient for a currency present in only one month', () => {
		const logs = [
			createFuelEntry({
				id: 1,
				date: JUNE,
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 100,
				currency: '€'
			})
		];
		const result = costPerDistanceDelta(logs, '€', 'L/100km', NOW);
		expect(result['€']).toEqual({ status: 'insufficient', reason: 'missing-period' });
	});

	it('is insufficient (insufficient-sample) when a currency has only a single fill-up on one side (H19b)', () => {
		const logs = [
			createFuelEntry({
				id: 1,
				date: JUNE,
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 100,
				currency: '€'
			}),
			createFuelEntry({
				id: 2,
				date: JUNE,
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 100,
				currency: '€'
			}),
			createFuelEntry({
				id: 3,
				date: MAY,
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 80,
				currency: '€'
			}) // only 1 in May
		];
		expect(costPerDistanceDelta(logs, '€', 'L/100km', NOW)['€']).toEqual({
			status: 'insufficient',
			reason: 'insufficient-sample'
		});
	});
});
