import type { FuelUnit } from '$lib/config';
import { ZERO_DECIMAL_CURRENCIES, SUFFIX_CURRENCIES } from '$lib/config';

export const LITERS_PER_GALLON = 3.785411784; // US gallon
export const LITERS_PER_UK_GALLON = 4.54609; // Story 8.3 AC7 — aCar UK-gallon parse-time conversion
export const KILOMETERS_PER_MILE = 1.609344;

/**
 * The one shared non-finite guard for the canonical math (PREP-1, Story 4.1). `NaN`/`Infinity`
 * leak through the older `<= 0` convention (`NaN <= 0 → false`), which renders a dead `€NaN` /
 * `NaN L/100km` and corrupts the dismissal-window math. Centralising the check here — mirroring the
 * `convertConsumptionUnit` `Number.isFinite` idiom below — lets analytics, the metrics engine, the
 * Up-Next odometer derivation, and the dismissal-shape validation all reject corrupt/legacy rows the
 * same way instead of scattering `Number.isFinite` calls. Narrows the type so callers keep `number`.
 */
export function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Convert a distance between km and mi (Story 4.5). The single shared, exported version of the
 * `convertDistanceToUnit` helper that previously lived privately in `cadence.ts`/`analytics.ts`/
 * `historyEntries.ts` — extracted so the reminder-prediction math can divide `kmRemaining` by the
 * cadence rate in one common unit (never mixing km/mi). Identity when units match.
 */
export function convertDistanceUnit(distance: number, from: 'km' | 'mi', to: 'km' | 'mi'): number {
	if (from === to) return distance;
	return from === 'km' ? distance / KILOMETERS_PER_MILE : distance * KILOMETERS_PER_MILE;
}
const MPG_L_PER_100KM_CONVERSION_FACTOR = (LITERS_PER_GALLON * 100) / KILOMETERS_PER_MILE;

/**
 * Calculate fuel consumption based on distance and fuel quantity
 * @param currentOdometer Current odometer reading
 * @param previousOdometer Previous odometer reading (or 0/undefined for first entry)
 * @param quantity Fuel quantity in liters or gallons
 * @param unit 'L' for liters (L/100km) or 'gal' for gallons (MPG)
 * @returns Calculated consumption value, or 0 if invalid inputs
 */
export function calculateConsumption(
	currentOdometer: number,
	previousOdometer: number | undefined | null,
	quantity: number,
	unit: 'L' | 'gal'
): number {
	// First-ever entry (no previous log): previousOdometer is undefined, null, or 0
	if (previousOdometer === undefined || previousOdometer === null || previousOdometer === 0) {
		return 0;
	}

	// Calculate distance traveled
	const distance = currentOdometer - previousOdometer;

	// Return 0 for invalid scenarios
	if (distance <= 0 || quantity <= 0) {
		return 0;
	}

	// Calculate based on unit
	if (unit === 'L') {
		// L/100km formula: (quantity / distance) * 100
		return (quantity / distance) * 100;
	} else {
		// MPG formula: distance / quantity
		return distance / quantity;
	}
}

/**
 * Format consumption value as human-readable string
 * @param consumption Consumption value to format
 * @param unit 'L' for liters (L/100km) or 'gal' for gallons (MPG)
 * @returns Formatted string like "7.0 L/100km" or "57.1 MPG"
 */
export function formatConsumption(consumption: number, unit: 'L' | 'gal'): string {
	const rounded = Math.round(consumption * 10) / 10;

	if (unit === 'L') {
		return `${rounded.toFixed(1)} L/100km`;
	} else {
		return `${rounded.toFixed(1)} MPG`;
	}
}

// Format a monetary amount in the given currency. `currency` is the literal display
// string the user chose (e.g. '€', 'EUR ', 'Ft'); we keep it verbatim and only adjust
// the decimal places and symbol position for known currencies. Unknown/custom currencies
// keep the historical behavior (prefix, two decimals).
export function formatCurrency(value: number, currency: string): string {
	// Non-finite input (NaN/±Infinity from corrupt or legacy rows) must never render as '€NaN' —
	// and a fabricated 0 would be dishonest. Em dash is the app's insufficient-data voice.
	if (!Number.isFinite(value)) {
		return '—';
	}
	const key = currency.trim().toUpperCase();
	const decimals = ZERO_DECIMAL_CURRENCIES.has(key) ? 0 : 2;
	const amount = value.toFixed(decimals);

	if (SUFFIX_CURRENCIES.has(key)) {
		return `${amount} ${currency.trim()}`;
	}

	return `${currency}${amount}`;
}

/** Calendar `YYYY-MM` key for `date`, shared by the analytics/insight/metrics call sites (Story 8.4). */
export function getMonthKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getVolumeUnitForFuelUnit(fuelUnit: FuelUnit): 'L' | 'gal' {
	return fuelUnit === 'MPG' ? 'gal' : 'L';
}

export function getDistanceUnitForFuelUnit(fuelUnit: FuelUnit): 'km' | 'mi' {
	return fuelUnit === 'MPG' ? 'mi' : 'km';
}

export function convertConsumptionUnit(
	consumption: number,
	fromUnit: 'L' | 'gal',
	toUnit: 'L' | 'gal'
): number {
	if (!Number.isFinite(consumption) || consumption <= 0) {
		return 0;
	}

	if (fromUnit === toUnit) {
		return consumption;
	}

	return MPG_L_PER_100KM_CONVERSION_FACTOR / consumption;
}

export function formatConsumptionForDisplay(
	consumption: number,
	storedUnit: 'L' | 'gal',
	preferredFuelUnit: FuelUnit
): string {
	const displayUnit = getVolumeUnitForFuelUnit(preferredFuelUnit);
	const displayConsumption = convertConsumptionUnit(consumption, storedUnit, displayUnit);

	return formatConsumption(displayConsumption, displayUnit);
}
