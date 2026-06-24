import type { FuelUnit } from '$lib/config';
import { DEFAULT_CURRENCY } from '$lib/config';
import type { Expense, FuelLog } from '$lib/db/schema';
import { isFiniteNumber } from '$lib/utils/calculations';
import { costPerDistance } from '$lib/utils/analytics';

/**
 * Derived-metrics engine — cost of ownership (Story 4.1 / FR-19, DEC-9).
 *
 * A cost-per-distance figure per currency, FUEL-ONLY by default (methodologically identical to
 * `analytics.ts#costPerDistance` — it delegates, so the two can never drift) and a combined
 * fuel+maintenance figure on request (`includeMaintenance`). The combined branch adds in-currency
 * maintenance cost to the numerator over the SAME fuel-measured distance (maintenance has no
 * odometer-derived distance of its own). A currency with maintenance but no fuel-measured distance is
 * OMITTED — no fabricated denominator. Currencies are never summed (offline, no FX).
 *
 * Kept DISTINCT from `costPerDistance` (Home's Hero stays fuel-only, Story 3.4) — this never modifies it.
 * Pure: no Svelte, no DB.
 */

export interface CostOfOwnershipEntry {
	/** Cost per unit distance (numerator ÷ measured distance), in `distanceUnit`. */
	costPerDistance: number;
	/** The numerator: `fuelCost + maintenanceCost`. */
	totalCost: number;
	/** Fuel spend in this currency over the measured distance (== `costPerDistance`'s totalCost). */
	fuelCost: number;
	/** In-currency maintenance spend folded in (0 unless `includeMaintenance`). */
	maintenanceCost: number;
	/** Total fuel-measured distance in `distanceUnit`. */
	totalDistance: number;
	/** The distance unit the rate is expressed in. */
	distanceUnit: 'km' | 'mi';
}

export interface CostOfOwnershipOptions {
	homeCurrency?: string;
	fuelUnit?: FuelUnit;
	/** When true, add in-currency maintenance cost to the numerator. Default false (fuel-only). */
	includeMaintenance?: boolean;
}

export function costOfOwnership(
	fuelLogs: FuelLog[],
	expenses: Expense[],
	{
		homeCurrency = DEFAULT_CURRENCY,
		fuelUnit = 'L/100km',
		includeMaintenance = false
	}: CostOfOwnershipOptions = {}
): Record<string, CostOfOwnershipEntry> {
	// Fuel-only rate + measured distance per currency — the authoritative methodology (delegated).
	const fuelRates = costPerDistance(fuelLogs, homeCurrency, fuelUnit);

	// Maintenance totals per currency (only needed for the combined branch). Legacy no-currency rows
	// fall back to the home currency; a non-finite cost is skipped (PREP-1).
	const maintenanceByCurrency: Record<string, number> = {};
	if (includeMaintenance) {
		for (const expense of expenses) {
			if (!isFiniteNumber(expense.cost)) {
				continue;
			}
			const currency = expense.currency ?? homeCurrency;
			maintenanceByCurrency[currency] = (maintenanceByCurrency[currency] ?? 0) + expense.cost;
		}
	}

	// Only currencies with a fuel-measured distance can carry a rate (costPerDistance already omits the
	// rest). A maintenance-only currency therefore never appears — no fabricated denominator.
	const result: Record<string, CostOfOwnershipEntry> = {};
	for (const [currency, entry] of Object.entries(fuelRates)) {
		const fuelCost = entry.totalCost;
		const maintenanceCost = includeMaintenance ? (maintenanceByCurrency[currency] ?? 0) : 0;
		const totalCost = fuelCost + maintenanceCost;

		result[currency] = {
			costPerDistance: totalCost / entry.totalDistance,
			totalCost,
			fuelCost,
			maintenanceCost,
			totalDistance: entry.totalDistance,
			distanceUnit: entry.distanceUnit
		};
	}

	return result;
}
