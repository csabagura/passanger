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
		const logs = [
			createFuelEntry({ id: 1, date: JUNE, calculatedConsumption: 8 }),
			createFuelEntry({ id: 2, date: MAY, calculatedConsumption: 7 })
		];
		const result = consumptionDelta(logs, 'L/100km', NOW);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.current).toBeCloseTo(8, 6);
		expect(result.previous).toBeCloseTo(7, 6);
		expect(result.direction).toBe('up');
	});

	it('combines mixed L/gal rows within a month (volume-weighted)', () => {
		// Two June L-logs averaging-weighted; one May log as baseline. Mainly asserts no throw + ok.
		const logs = [
			createFuelEntry({ id: 1, date: JUNE, calculatedConsumption: 8, quantity: 40 }),
			createFuelEntry({ id: 2, date: JUNE, calculatedConsumption: 6, quantity: 40 }),
			createFuelEntry({ id: 3, date: MAY, calculatedConsumption: 7 })
		];
		const result = consumptionDelta(logs, 'L/100km', NOW);
		expect(result.status).toBe('ok');
	});

	it('skips a non-finite consumption row rather than emitting NaN', () => {
		const logs = [
			createFuelEntry({ id: 1, date: JUNE, calculatedConsumption: Number.NaN }),
			createFuelEntry({ id: 2, date: JUNE, calculatedConsumption: 8 }),
			createFuelEntry({ id: 3, date: MAY, calculatedConsumption: 7 })
		];
		const result = consumptionDelta(logs, 'L/100km', NOW);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(Number.isFinite(result.current)).toBe(true);
		expect(result.current).toBeCloseTo(8, 6);
	});
});

describe('spendDelta', () => {
	it('isolates currencies and never sums across them', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({ id: 1, date: JUNE, totalCost: 100, currency: '€' }),
				createFuelEntry({ id: 2, date: JUNE, totalCost: 50, currency: '$' }),
				createFuelEntry({ id: 3, date: MAY, totalCost: 80, currency: '€' })
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
				createMaintenanceEntry({ id: 1, date: JUNE, cost: 120, currency: undefined }),
				createMaintenanceEntry({ id: 2, date: MAY, cost: 100, currency: undefined })
			]
		);
		const result = spendDelta(entries, '€', NOW);
		expect(result['€']?.status).toBe('ok');
		if (result['€']?.status !== 'ok') return;
		expect(result['€'].absoluteChange).toBe(20);
	});

	it('treats a negative previous-month net (refund/credit) as no-baseline, not a sign-flipped percent', () => {
		// May nets −30 (a 50 charge then an 80 refund); June is +10. comparePeriods(10, −30) must be
		// no-baseline — never `direction: 'up'` with a negative percentChange.
		const entries = mergeHistoryEntries(
			[],
			[
				createMaintenanceEntry({ id: 1, date: MAY, cost: 50, currency: '€' }),
				createMaintenanceEntry({ id: 2, date: MAY, cost: -80, currency: '€' }),
				createMaintenanceEntry({ id: 3, date: JUNE, cost: 10, currency: '€' })
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
});

describe('costPerDistanceDelta', () => {
	it('compares fuel cost-per-distance per currency month-over-month', () => {
		// distance for an L log = (quantity / consumption) * 100. With quantity 50, consumption 10 →
		// 500 km. costPerDistance = totalCost / 500.
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
});
