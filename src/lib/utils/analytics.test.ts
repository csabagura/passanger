import { describe, expect, it } from 'vitest';
import type { Expense, FuelLog } from '$lib/db/schema';
import { LITERS_PER_GALLON, KILOMETERS_PER_MILE } from '$lib/utils/calculations';
import { mergeHistoryEntries, type HistoryEntry } from '$lib/utils/historyEntries';
import {
	averageConsumption,
	consumptionTrend,
	costPerDistance,
	fuelVsMaintenanceSplit,
	monthlySpendByCurrency
} from './analytics';

function createFuelEntry(overrides: Partial<FuelLog> = {}): FuelLog {
	return {
		id: overrides.id ?? 9,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 2, 10, 12, 0, 0, 0),
		odometer: overrides.odometer ?? 87400,
		quantity: overrides.quantity ?? 42,
		unit: overrides.unit ?? 'L',
		distanceUnit: overrides.distanceUnit ?? 'km',
		totalCost: overrides.totalCost ?? 78,
		currency: overrides.currency,
		calculatedConsumption: overrides.calculatedConsumption ?? 7.2,
		notes: overrides.notes ?? ''
	};
}

function createMaintenanceEntry(overrides: Partial<Expense> = {}): Expense {
	return {
		id: overrides.id ?? 12,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 2, 10, 12, 0, 0, 0),
		type: overrides.type ?? 'Oil Change',
		odometer: overrides.odometer ?? 87400,
		cost: overrides.cost ?? 78,
		currency: overrides.currency,
		notes: overrides.notes ?? ''
	};
}

function formatMonthLabel(date: Date): string {
	return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
}

describe('monthlySpendByCurrency', () => {
	it('returns an empty array for no entries', () => {
		expect(monthlySpendByCurrency([], '€')).toEqual([]);
	});

	it('buckets a single entry into one month', () => {
		const entries = mergeHistoryEntries(
			[createFuelEntry({ id: 1, date: new Date(2026, 2, 10), totalCost: 78, currency: '€' })],
			[]
		);
		const buckets = monthlySpendByCurrency(entries, '€');
		expect(buckets).toEqual([
			{
				monthKey: '2026-03',
				label: formatMonthLabel(new Date(2026, 2, 10)),
				byCurrency: { '€': 78 }
			}
		]);
	});

	it('orders months oldest to newest regardless of input order', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({ id: 1, date: new Date(2026, 2, 10), totalCost: 50, currency: '€' }),
				createFuelEntry({ id: 2, date: new Date(2025, 11, 5), totalCost: 30, currency: '€' }),
				createFuelEntry({ id: 3, date: new Date(2026, 0, 20), totalCost: 40, currency: '€' })
			],
			[]
		);
		expect(monthlySpendByCurrency(entries, '€').map((bucket) => bucket.monthKey)).toEqual([
			'2025-12',
			'2026-01',
			'2026-03'
		]);
	});

	it('keeps currencies separate within a month and never sums across them', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({ id: 1, date: new Date(2026, 2, 10), totalCost: 78, currency: '€' }),
				createFuelEntry({ id: 2, date: new Date(2026, 2, 15), totalCost: 20000, currency: 'Ft' })
			],
			[createMaintenanceEntry({ id: 3, date: new Date(2026, 2, 20), cost: 22, currency: '€' })]
		);
		const buckets = monthlySpendByCurrency(entries, '€');
		expect(buckets).toHaveLength(1);
		expect(buckets[0].byCurrency).toEqual({ '€': 100, Ft: 20000 });
	});

	it('attributes legacy entries (no currency) to the home currency', () => {
		const entries = mergeHistoryEntries(
			[createFuelEntry({ id: 1, date: new Date(2026, 2, 10), totalCost: 78 })],
			[]
		);
		expect(monthlySpendByCurrency(entries, 'Ft')[0].byCurrency).toEqual({ Ft: 78 });
	});

	it('combines fuel and maintenance spend in the same month and currency', () => {
		const entries = mergeHistoryEntries(
			[createFuelEntry({ id: 1, date: new Date(2026, 2, 10), totalCost: 78, currency: '€' })],
			[createMaintenanceEntry({ id: 2, date: new Date(2026, 2, 12), cost: 120, currency: '€' })]
		);
		expect(monthlySpendByCurrency(entries, '€')[0].byCurrency).toEqual({ '€': 198 });
	});
});

describe('consumptionTrend', () => {
	it('returns an empty array for no fuel logs', () => {
		expect(consumptionTrend([], 'L/100km')).toEqual([]);
	});

	it('orders points oldest to newest by date then id', () => {
		const logs = [
			createFuelEntry({ id: 5, date: new Date(2026, 2, 12), calculatedConsumption: 8 }),
			createFuelEntry({ id: 4, date: new Date(2026, 2, 10), calculatedConsumption: 7 }),
			createFuelEntry({ id: 9, date: new Date(2026, 2, 12), calculatedConsumption: 9 })
		];
		const trend = consumptionTrend(logs, 'L/100km');
		expect(trend.map((point) => point.consumption)).toEqual([7, 8, 9]);
	});

	it('excludes logs with zero or negative consumption', () => {
		const logs = [
			createFuelEntry({ id: 1, date: new Date(2026, 2, 1), calculatedConsumption: 0 }),
			createFuelEntry({ id: 2, date: new Date(2026, 2, 2), calculatedConsumption: -3 }),
			createFuelEntry({ id: 3, date: new Date(2026, 2, 3), calculatedConsumption: 6.5 })
		];
		const trend = consumptionTrend(logs, 'L/100km');
		expect(trend).toHaveLength(1);
		expect(trend[0].consumption).toBe(6.5);
	});

	it('keeps L/100km values unchanged for a single L log under L/100km preference', () => {
		const trend = consumptionTrend(
			[createFuelEntry({ id: 1, unit: 'L', distanceUnit: 'km', calculatedConsumption: 7.5 })],
			'L/100km'
		);
		expect(trend).toHaveLength(1);
		expect(trend[0].consumption).toBeCloseTo(7.5, 6);
	});

	it('converts a stored L/100km value to MPG when MPG is preferred', () => {
		const conversionFactor = (LITERS_PER_GALLON * 100) / KILOMETERS_PER_MILE;
		const trend = consumptionTrend(
			[createFuelEntry({ id: 1, unit: 'L', distanceUnit: 'km', calculatedConsumption: 7.5 })],
			'MPG'
		);
		expect(trend[0].consumption).toBeCloseTo(conversionFactor / 7.5, 6);
	});

	it('converts a stored MPG value to L/100km when L/100km is preferred', () => {
		const conversionFactor = (LITERS_PER_GALLON * 100) / KILOMETERS_PER_MILE;
		const trend = consumptionTrend(
			[createFuelEntry({ id: 1, unit: 'gal', distanceUnit: 'mi', calculatedConsumption: 30 })],
			'L/100km'
		);
		expect(trend[0].consumption).toBeCloseTo(conversionFactor / 30, 6);
	});

	it('keeps MPG values unchanged for a gal log under MPG preference', () => {
		const trend = consumptionTrend(
			[createFuelEntry({ id: 1, unit: 'gal', distanceUnit: 'mi', calculatedConsumption: 32 })],
			'MPG'
		);
		expect(trend[0].consumption).toBeCloseTo(32, 6);
	});
});

describe('fuelVsMaintenanceSplit', () => {
	it('returns an empty object for no entries', () => {
		expect(fuelVsMaintenanceSplit([], '€')).toEqual({});
	});

	it('splits a single fuel entry', () => {
		const entries: HistoryEntry[] = [
			{ kind: 'fuel', entry: createFuelEntry({ totalCost: 78, currency: '€' }) }
		];
		expect(fuelVsMaintenanceSplit(entries, '€')).toEqual({ '€': { fuel: 78, maintenance: 0 } });
	});

	it('splits fuel and maintenance within one currency', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({ id: 1, totalCost: 78, currency: '€' }),
				createFuelEntry({ id: 2, totalCost: 44, currency: '€' })
			],
			[createMaintenanceEntry({ id: 3, cost: 120, currency: '€' })]
		);
		expect(fuelVsMaintenanceSplit(entries, '€')).toEqual({
			'€': { fuel: 122, maintenance: 120 }
		});
	});

	it('keeps currencies separate', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({ id: 1, totalCost: 78, currency: '€' }),
				createFuelEntry({ id: 2, totalCost: 20000, currency: 'Ft' })
			],
			[createMaintenanceEntry({ id: 3, cost: 5000, currency: 'Ft' })]
		);
		expect(fuelVsMaintenanceSplit(entries, '€')).toEqual({
			'€': { fuel: 78, maintenance: 0 },
			Ft: { fuel: 20000, maintenance: 5000 }
		});
	});

	it('attributes legacy entries to the home currency', () => {
		const entries = mergeHistoryEntries(
			[createFuelEntry({ id: 1, totalCost: 78 })],
			[createMaintenanceEntry({ id: 2, cost: 30 })]
		);
		expect(fuelVsMaintenanceSplit(entries, 'Ft')).toEqual({
			Ft: { fuel: 78, maintenance: 30 }
		});
	});
});

describe('costPerDistance', () => {
	it('returns an empty object for no fuel logs', () => {
		expect(costPerDistance([], '€', 'L/100km')).toEqual({});
	});

	it('omits logs with no derivable distance (zero consumption)', () => {
		const logs = [
			createFuelEntry({ id: 1, calculatedConsumption: 0, totalCost: 50, currency: '€' })
		];
		expect(costPerDistance(logs, '€', 'L/100km')).toEqual({});
	});

	it('computes cost per km for L logs under the metric preference', () => {
		// 50 L at 10 L/100km => 500 km. 75 EUR over 500 km => 0.15 EUR/km.
		const logs = [
			createFuelEntry({
				id: 1,
				unit: 'L',
				distanceUnit: 'km',
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 75,
				currency: '€'
			})
		];
		const result = costPerDistance(logs, '€', 'L/100km');
		expect(result['€'].distanceUnit).toBe('km');
		expect(result['€'].totalDistance).toBeCloseTo(500, 6);
		expect(result['€'].totalCost).toBe(75);
		expect(result['€'].costPerDistance).toBeCloseTo(0.15, 6);
	});

	it('computes cost per mi for gal logs under the imperial preference', () => {
		// 10 gal at 25 MPG => 250 mi. 50 USD over 250 mi => 0.2 USD/mi.
		const logs = [
			createFuelEntry({
				id: 1,
				unit: 'gal',
				distanceUnit: 'mi',
				quantity: 10,
				calculatedConsumption: 25,
				totalCost: 50,
				currency: '$'
			})
		];
		const result = costPerDistance(logs, '$', 'MPG');
		expect(result['$'].distanceUnit).toBe('mi');
		expect(result['$'].totalDistance).toBeCloseTo(250, 6);
		expect(result['$'].costPerDistance).toBeCloseTo(0.2, 6);
	});

	it('converts mixed distance units to the preferred unit and keeps currencies separate', () => {
		const logs = [
			createFuelEntry({
				id: 1,
				unit: 'L',
				distanceUnit: 'km',
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 75,
				currency: '€'
			}),
			createFuelEntry({
				id: 2,
				unit: 'gal',
				distanceUnit: 'mi',
				quantity: 10,
				calculatedConsumption: 25,
				totalCost: 40,
				currency: '€'
			})
		];
		// km log => 500 km; mi log => 250 mi => 250 * 1.609344 km. Combined in EUR.
		const expectedDistance = 500 + 250 * KILOMETERS_PER_MILE;
		const result = costPerDistance(logs, '€', 'L/100km');
		expect(result['€'].totalCost).toBe(115);
		expect(result['€'].totalDistance).toBeCloseTo(expectedDistance, 6);
		expect(result['€'].costPerDistance).toBeCloseTo(115 / expectedDistance, 6);
	});

	it('attributes legacy logs to the home currency', () => {
		const logs = [
			createFuelEntry({
				id: 1,
				unit: 'L',
				distanceUnit: 'km',
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 75
			})
		];
		const result = costPerDistance(logs, 'Ft', 'L/100km');
		expect(Object.keys(result)).toEqual(['Ft']);
		expect(result.Ft.costPerDistance).toBeCloseTo(0.15, 6);
	});
});

describe('averageConsumption', () => {
	it('returns null for no fuel logs', () => {
		expect(averageConsumption([], 'L/100km')).toBeNull();
	});

	it('returns null when the only fill has no derivable distance (genuine first log)', () => {
		const logs = [createFuelEntry({ id: 1, calculatedConsumption: 0 })];
		expect(averageConsumption(logs, 'L/100km')).toBeNull();
	});

	it('is volume-weighted (Σvolume / Σdistance), not a mean of per-tank values, for L logs', () => {
		// log1: 50 L at 10 L/100km => 500 km. log2: 40 L at 8 L/100km => 500 km.
		// Σ = 90 L over 1000 km => (90 / 1000) * 100 = 9.0 L/100km.
		const logs = [
			createFuelEntry({
				id: 1,
				unit: 'L',
				distanceUnit: 'km',
				quantity: 50,
				calculatedConsumption: 10
			}),
			createFuelEntry({
				id: 2,
				unit: 'L',
				distanceUnit: 'km',
				quantity: 40,
				calculatedConsumption: 8
			})
		];
		expect(averageConsumption(logs, 'L/100km')).toBeCloseTo(9.0, 6);
	});

	it('computes MPG (Σmiles / Σgallons) for gal logs under the imperial preference', () => {
		// log1: 10 gal at 25 MPG => 250 mi. log2: 10 gal at 20 MPG => 200 mi.
		// Σ = 450 mi over 20 gal => 22.5 MPG.
		const logs = [
			createFuelEntry({
				id: 1,
				unit: 'gal',
				distanceUnit: 'mi',
				quantity: 10,
				calculatedConsumption: 25
			}),
			createFuelEntry({
				id: 2,
				unit: 'gal',
				distanceUnit: 'mi',
				quantity: 10,
				calculatedConsumption: 20
			})
		];
		expect(averageConsumption(logs, 'MPG')).toBeCloseTo(22.5, 6);
	});

	it('normalizes mixed L/gal + km/mi rows to the L/100km display unit before summing', () => {
		const logs = [
			createFuelEntry({
				id: 1,
				unit: 'L',
				distanceUnit: 'km',
				quantity: 50,
				calculatedConsumption: 10
			}),
			createFuelEntry({
				id: 2,
				unit: 'gal',
				distanceUnit: 'mi',
				quantity: 10,
				calculatedConsumption: 25
			})
		];
		// km log: 500 km, 50 L. mi log: 250 mi => 250 * 1.609344 km; 10 gal => 10 * 3.785411784 L.
		const totalLiters = 50 + 10 * LITERS_PER_GALLON;
		const totalKm = 500 + 250 * KILOMETERS_PER_MILE;
		expect(averageConsumption(logs, 'L/100km')).toBeCloseTo((totalLiters / totalKm) * 100, 6);
	});

	it('ignores non-derivable fills while still aggregating the derivable ones', () => {
		const logs = [
			createFuelEntry({ id: 1, calculatedConsumption: 0 }), // dropped
			createFuelEntry({
				id: 2,
				unit: 'L',
				distanceUnit: 'km',
				quantity: 50,
				calculatedConsumption: 10
			}),
			createFuelEntry({
				id: 3,
				unit: 'L',
				distanceUnit: 'km',
				quantity: 40,
				calculatedConsumption: 8
			})
		];
		expect(averageConsumption(logs, 'L/100km')).toBeCloseTo(9.0, 6);
	});
});

describe('PREP-1 non-finite guard (Story 4.1)', () => {
	// The older `<= 0` convention leaked NaN/Infinity (`NaN <= 0 → false`), rendering dead €NaN /
	// "NaN L/100km". A non-finite row must now be skipped cleanly, leaving the good rows aggregated.
	it('costPerDistance skips a row with a non-finite consumption rather than emitting NaN', () => {
		const logs = [
			createFuelEntry({ id: 1, calculatedConsumption: Number.NaN, totalCost: 100, currency: '€' }),
			createFuelEntry({
				id: 2,
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 100,
				currency: '€'
			})
		];
		const result = costPerDistance(logs, '€');
		expect(Number.isFinite(result['€'].costPerDistance)).toBe(true);
		expect(result['€'].costPerDistance).toBeCloseTo(0.2, 9); // only the good row counts
	});

	it('costPerDistance skips a row with a non-finite totalCost', () => {
		const logs = [
			createFuelEntry({
				id: 1,
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: Number.POSITIVE_INFINITY,
				currency: '€'
			}),
			createFuelEntry({
				id: 2,
				quantity: 50,
				calculatedConsumption: 10,
				totalCost: 100,
				currency: '€'
			})
		];
		const result = costPerDistance(logs, '€');
		expect(Number.isFinite(result['€'].costPerDistance)).toBe(true);
		expect(result['€'].costPerDistance).toBeCloseTo(0.2, 9);
	});

	it('averageConsumption skips non-finite consumption/quantity rows', () => {
		const logs = [
			createFuelEntry({ id: 1, calculatedConsumption: Number.NaN }),
			createFuelEntry({ id: 2, quantity: Number.POSITIVE_INFINITY, calculatedConsumption: 10 }),
			createFuelEntry({ id: 3, quantity: 50, calculatedConsumption: 10 })
		];
		const result = averageConsumption(logs, 'L/100km');
		expect(result).not.toBeNull();
		expect(Number.isFinite(result as number)).toBe(true);
		expect(result).toBeCloseTo(10, 6); // only the good row counts
	});
});
