import { describe, expect, it } from 'vitest';
import type { Expense, FuelLog } from '$lib/db/schema';
import { costPerDistance } from '$lib/utils/analytics';
import { costOfOwnership } from './costOfOwnership';

function createFuelEntry(overrides: Partial<FuelLog> = {}): FuelLog {
	return {
		id: overrides.id ?? 9,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 5, 10, 12, 0, 0, 0),
		odometer: overrides.odometer ?? 87400,
		quantity: overrides.quantity ?? 50,
		unit: overrides.unit ?? 'L',
		distanceUnit: overrides.distanceUnit ?? 'km',
		totalCost: overrides.totalCost ?? 100,
		currency: overrides.currency,
		calculatedConsumption: overrides.calculatedConsumption ?? 10,
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
		cost: overrides.cost ?? 50,
		currency: overrides.currency,
		notes: overrides.notes ?? ''
	};
}

// quantity 50 @ consumption 10 → distance 500 km; totalCost 100 → costPerDistance 0.2.
const FUEL = [createFuelEntry({ id: 1, currency: '€' })];

describe('costOfOwnership', () => {
	it('fuel-only is methodologically identical to costPerDistance', () => {
		const own = costOfOwnership(FUEL, [], { homeCurrency: '€' });
		const cpd = costPerDistance(FUEL, '€');
		expect(own['€'].costPerDistance).toBeCloseTo(cpd['€'].costPerDistance, 9);
		expect(own['€'].costPerDistance).toBeCloseTo(0.2, 9);
		expect(own['€'].fuelCost).toBe(100);
		expect(own['€'].maintenanceCost).toBe(0);
		expect(own['€'].totalCost).toBe(100);
		expect(own['€'].totalDistance).toBeCloseTo(500, 6);
		expect(own['€'].distanceUnit).toBe('km');
	});

	it('combined adds in-currency maintenance over the same fuel-measured distance', () => {
		const expenses = [createMaintenanceEntry({ id: 2, cost: 50, currency: '€' })];
		const own = costOfOwnership(FUEL, expenses, { homeCurrency: '€', includeMaintenance: true });
		expect(own['€'].fuelCost).toBe(100);
		expect(own['€'].maintenanceCost).toBe(50);
		expect(own['€'].totalCost).toBe(150);
		expect(own['€'].costPerDistance).toBeCloseTo(150 / 500, 9); // 0.3
	});

	it('omits a maintenance-only currency (no fuel-measured distance, no fabricated denominator)', () => {
		const expenses = [createMaintenanceEntry({ id: 2, cost: 999, currency: '$' })];
		const own = costOfOwnership(FUEL, expenses, { homeCurrency: '€', includeMaintenance: true });
		expect(Object.keys(own)).toEqual(['€']);
		expect(own['$']).toBeUndefined();
		// The € rate is untouched by the foreign-currency maintenance.
		expect(own['€'].maintenanceCost).toBe(0);
		expect(own['€'].costPerDistance).toBeCloseTo(0.2, 9);
	});

	it('falls back to the home currency for legacy no-currency rows', () => {
		const fuel = [createFuelEntry({ id: 1, currency: undefined })];
		const expenses = [createMaintenanceEntry({ id: 2, cost: 50, currency: undefined })];
		const own = costOfOwnership(fuel, expenses, { homeCurrency: '€', includeMaintenance: true });
		expect(own['€'].fuelCost).toBe(100);
		expect(own['€'].maintenanceCost).toBe(50);
	});

	it('handles mixed distance units without throwing', () => {
		const fuel = [
			createFuelEntry({ id: 1, currency: '€', distanceUnit: 'km' }),
			createFuelEntry({
				id: 2,
				currency: '€',
				distanceUnit: 'mi',
				unit: 'gal',
				quantity: 12,
				calculatedConsumption: 40,
				totalCost: 60
			})
		];
		const own = costOfOwnership(fuel, [], { homeCurrency: '€' });
		expect(own['€'].costPerDistance).toBeGreaterThan(0);
		expect(Number.isFinite(own['€'].costPerDistance)).toBe(true);
	});

	it('skips a non-finite maintenance cost rather than corrupting the total', () => {
		const expenses = [
			createMaintenanceEntry({ id: 2, cost: Number.NaN, currency: '€' }),
			createMaintenanceEntry({ id: 3, cost: 50, currency: '€' })
		];
		const own = costOfOwnership(FUEL, expenses, { homeCurrency: '€', includeMaintenance: true });
		expect(own['€'].maintenanceCost).toBe(50);
		expect(Number.isFinite(own['€'].costPerDistance)).toBe(true);
	});
});
