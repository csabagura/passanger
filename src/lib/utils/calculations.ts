import type { FuelUnit } from '$lib/config';

export const LITERS_PER_GALLON = 3.785411784;
export const KILOMETERS_PER_MILE = 1.609344;
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

export function formatCurrency(value: number, currency: string): string {
	return `${currency}${value.toFixed(2)}`;
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
