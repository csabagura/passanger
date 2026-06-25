import { describe, expect, it } from 'vitest';
import { selectDisplayRateBlend } from './displayRate';
import { mergeHistoryEntries, convertHistorySpendToHome } from './historyEntries';
import type { Expense, FuelLog } from '$lib/db/schema';

function createFuelEntry(overrides: Partial<FuelLog> = {}): FuelLog {
	return {
		id: overrides.id ?? 1,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 2, 10),
		odometer: overrides.odometer ?? 1000,
		quantity: overrides.quantity ?? 40,
		unit: overrides.unit ?? 'L',
		distanceUnit: overrides.distanceUnit ?? 'km',
		totalCost: overrides.totalCost ?? 60,
		currency: overrides.currency,
		calculatedConsumption: overrides.calculatedConsumption ?? 8,
		notes: overrides.notes ?? ''
	};
}

function createMaintenanceEntry(overrides: Partial<Expense> = {}): Expense {
	return {
		id: overrides.id ?? 2,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 2, 10),
		type: overrides.type ?? 'Oil Change',
		odometer: overrides.odometer ?? 1000,
		cost: overrides.cost ?? 120,
		currency: overrides.currency,
		notes: overrides.notes ?? ''
	};
}

describe('selectDisplayRateBlend', () => {
	it('returns null when no foreign entry has a usable rate (no rate → no number)', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({ id: 1, currency: 'Ft', totalCost: 5000 }),
				createFuelEntry({ id: 2, currency: '€', totalCost: 100 })
			],
			[]
		);
		expect(selectDisplayRateBlend(entries, 'Ft', undefined)).toBeNull();
	});

	it('returns null when nothing converts even though a rate map is supplied', () => {
		// A lone home entry makes convertibleEntries > 0 but ratedEntries stays 0 → no blend.
		const entries = mergeHistoryEntries(
			[createFuelEntry({ id: 1, currency: 'Ft', totalCost: 5000 })],
			[]
		);
		expect(selectDisplayRateBlend(entries, 'Ft', { '€': 400 })).toBeNull();
	});

	it('builds the single-currency label "(1 X = Y)" and a total matching the engine', () => {
		const entries = mergeHistoryEntries(
			[createFuelEntry({ id: 1, currency: '€', totalCost: 100 })],
			[createMaintenanceEntry({ id: 2, currency: 'Ft', cost: 5000 })]
		);
		const rates = { '€': 400 };
		const blend = selectDisplayRateBlend(entries, 'Ft', rates);
		expect(blend).not.toBeNull();
		expect(blend?.label).toBe('using your rate (1 € = 400 Ft)');
		// total mirrors convertHistorySpendToHome (100 € × 400 + 5000 Ft at rate 1).
		expect(blend?.total).toBe(convertHistorySpendToHome(entries, 'Ft', rates).total);
		expect(blend?.total).toBe(100 * 400 + 5000);
		expect(blend?.unconvertedEntries).toBe(0);
	});

	it('flips to the inverse direction when the forward rate rounds to a home-zero value', () => {
		// home €, 1 Ft ≈ €0.0025 → "1 Ft = €0.00" is useless, so show "1 € = 400 Ft" instead.
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({ id: 1, currency: '€', totalCost: 50 }),
				createFuelEntry({ id: 2, currency: 'Ft', totalCost: 20000 })
			],
			[]
		);
		const blend = selectDisplayRateBlend(entries, '€', { Ft: 0.0025 });
		expect(blend?.label).toBe('using your rate (1 € = 400 Ft)');
	});

	it('uses the plural "using your rates" when two or more foreign currencies are rated', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({ id: 1, currency: '€', totalCost: 100 }),
				createFuelEntry({ id: 2, currency: '$', totalCost: 80 })
			],
			[createMaintenanceEntry({ id: 3, currency: 'Ft', cost: 5000 })]
		);
		const blend = selectDisplayRateBlend(entries, 'Ft', { '€': 400, $: 350 });
		expect(blend?.label).toBe('using your rates');
		expect(blend?.total).toBe(100 * 400 + 80 * 350 + 5000);
	});

	it('reports unconverted entries when some foreign currency still lacks a rate', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({ id: 1, currency: '€', totalCost: 100 }),
				createFuelEntry({ id: 2, currency: '$', totalCost: 80 })
			],
			[createMaintenanceEntry({ id: 3, currency: 'Ft', cost: 5000 })]
		);
		// Only € is rated → single label, and the $ entry is flagged unconverted.
		const blend = selectDisplayRateBlend(entries, 'Ft', { '€': 400 });
		expect(blend?.label).toBe('using your rate (1 € = 400 Ft)');
		expect(blend?.unconvertedEntries).toBe(1);
	});
});
