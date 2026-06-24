import type { FuelUnit } from '$lib/config';
import { DEFAULT_CURRENCY } from '$lib/config';
import type { FuelLog } from '$lib/db/schema';
import {
	convertConsumptionUnit,
	getDistanceUnitForFuelUnit,
	getVolumeUnitForFuelUnit,
	isFiniteNumber,
	KILOMETERS_PER_MILE,
	LITERS_PER_GALLON
} from '$lib/utils/calculations';
import { resolveHistoryEntryCurrency, type HistoryEntry } from '$lib/utils/historyEntries';

/**
 * Pure analytics helpers for the Analytics page. No Svelte, no DB — these only
 * transform already-loaded history data into chart-ready series.
 *
 * Currencies are NEVER summed across one another: the app is offline-first and
 * makes no network calls (CSP `connect-src 'none'`), so no FX rate exists. Every
 * spend aggregate is therefore reported per currency.
 */

export interface MonthlySpendBucket {
	/** Sortable `YYYY-MM` key for the calendar month. */
	monthKey: string;
	/** Human label such as "March 2026". */
	label: string;
	/** Spend in that month, grouped by currency (never summed across currencies). */
	byCurrency: Record<string, number>;
}

export interface ConsumptionTrendPoint {
	/** The fuel log's date. */
	date: Date;
	/** Short human label such as "10 Mar". */
	label: string;
	/** Consumption converted to the preferred display unit (L/100km value or MPG value). */
	consumption: number;
}

export interface FuelMaintenanceSplit {
	fuel: number;
	maintenance: number;
}

export interface CostPerDistanceEntry {
	/** Cost per unit distance (per km or per mi depending on `distanceUnit`). */
	costPerDistance: number;
	/** Total spend on fuel in this currency over the measured distance. */
	totalCost: number;
	/** Total measured distance in `distanceUnit`. */
	totalDistance: number;
	/** The distance unit the rate is expressed in. */
	distanceUnit: 'km' | 'mi';
}

function getHistoryEntryCost(entry: HistoryEntry): number {
	return entry.kind === 'fuel' ? entry.entry.totalCost : entry.entry.cost;
}

function getMonthKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(date: Date, locale: Intl.LocalesArgument = undefined): string {
	return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
}

function formatDayLabel(date: Date, locale: Intl.LocalesArgument = undefined): string {
	return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
}

/**
 * Distance covered by a single fill-up, derived from its consumption + quantity,
 * expressed in the log's own `distanceUnit`. Returns null when it can't be derived
 * (no/zero consumption — e.g. the first-ever log, or a non-trip fill-up).
 */
function getFuelEntryDistance(entry: FuelLog): number | null {
	// PREP-1: reject non-finite as well as non-positive. The older `<= 0` convention leaks `NaN`
	// (`NaN <= 0 → false`), which propagates into `€NaN` / `NaN L/100km`. `isFiniteNumber` closes that.
	if (
		!isFiniteNumber(entry.calculatedConsumption) ||
		entry.calculatedConsumption <= 0 ||
		!isFiniteNumber(entry.quantity) ||
		entry.quantity <= 0
	) {
		return null;
	}

	return entry.unit === 'L'
		? (entry.quantity / entry.calculatedConsumption) * 100
		: entry.calculatedConsumption * entry.quantity;
}

function convertDistanceToUnit(
	distance: number,
	fromUnit: 'km' | 'mi',
	toUnit: 'km' | 'mi'
): number {
	if (fromUnit === toUnit) {
		return distance;
	}

	return fromUnit === 'km' ? distance / KILOMETERS_PER_MILE : distance * KILOMETERS_PER_MILE;
}

function convertVolumeToUnit(volume: number, fromUnit: 'L' | 'gal', toUnit: 'L' | 'gal'): number {
	if (fromUnit === toUnit) {
		return volume;
	}

	return fromUnit === 'L' ? volume / LITERS_PER_GALLON : volume * LITERS_PER_GALLON;
}

/**
 * Spend per calendar month, grouped by currency. Ordered OLDEST → NEWEST so the
 * series reads left-to-right as a timeline bar chart. Legacy entries with no
 * currency are attributed to `homeCurrency`.
 */
export function monthlySpendByCurrency(
	entries: HistoryEntry[],
	homeCurrency: string = DEFAULT_CURRENCY,
	locale: Intl.LocalesArgument = undefined
): MonthlySpendBucket[] {
	const bucketsByKey = new Map<string, MonthlySpendBucket>();

	for (const entry of entries) {
		const date = entry.entry.date;
		const monthKey = getMonthKey(date);
		let bucket = bucketsByKey.get(monthKey);
		if (!bucket) {
			bucket = { monthKey, label: formatMonthLabel(date, locale), byCurrency: {} };
			bucketsByKey.set(monthKey, bucket);
		}

		const currency = resolveHistoryEntryCurrency(entry, homeCurrency);
		bucket.byCurrency[currency] = (bucket.byCurrency[currency] ?? 0) + getHistoryEntryCost(entry);
	}

	return [...bucketsByKey.values()].sort((left, right) =>
		left.monthKey < right.monthKey ? -1 : left.monthKey > right.monthKey ? 1 : 0
	);
}

/**
 * Consumption series for fuel logs, converted to the preferred display unit.
 * Ordered OLDEST → NEWEST by date (ties broken by id) so the line reads
 * left-to-right chronologically. Logs with consumption <= 0 are skipped (they
 * have no usable trend value — e.g. the first-ever fill-up).
 */
export function consumptionTrend(
	fuelLogs: FuelLog[],
	preferredFuelUnit: FuelUnit = 'L/100km',
	locale: Intl.LocalesArgument = undefined
): ConsumptionTrendPoint[] {
	const displayUnit = getVolumeUnitForFuelUnit(preferredFuelUnit);

	return fuelLogs
		.filter((log) => log.calculatedConsumption > 0)
		.slice()
		.sort((left, right) => {
			const dateDifference = left.date.getTime() - right.date.getTime();
			return dateDifference !== 0 ? dateDifference : left.id - right.id;
		})
		.map((log) => ({
			date: log.date,
			label: formatDayLabel(log.date, locale),
			consumption: convertConsumptionUnit(log.calculatedConsumption, log.unit, displayUnit)
		}))
		.filter((point) => point.consumption > 0);
}

/**
 * Total spend split into fuel vs maintenance, grouped by currency. Currencies are
 * never summed together. Legacy entries with no currency map to `homeCurrency`.
 */
export function fuelVsMaintenanceSplit(
	entries: HistoryEntry[],
	homeCurrency: string = DEFAULT_CURRENCY
): Record<string, FuelMaintenanceSplit> {
	const byCurrency: Record<string, FuelMaintenanceSplit> = {};

	for (const entry of entries) {
		const currency = resolveHistoryEntryCurrency(entry, homeCurrency);
		const split = (byCurrency[currency] ??= { fuel: 0, maintenance: 0 });
		if (entry.kind === 'fuel') {
			split.fuel += entry.entry.totalCost;
		} else {
			split.maintenance += entry.entry.cost;
		}
	}

	return byCurrency;
}

/**
 * Overall fuel cost per unit distance, grouped by currency. Distances are
 * converted to the distance unit implied by `preferredFuelUnit` (km for
 * L/100km, mi for MPG) so a single rate per currency is reported. Only fuel
 * logs whose distance can be derived (consumption > 0) contribute. Currencies
 * are kept separate. Currencies with no measurable distance are omitted.
 */
export function costPerDistance(
	fuelLogs: FuelLog[],
	homeCurrency: string = DEFAULT_CURRENCY,
	preferredFuelUnit: FuelUnit = 'L/100km'
): Record<string, CostPerDistanceEntry> {
	const distanceUnit = getDistanceUnitForFuelUnit(preferredFuelUnit);
	const totals = new Map<string, { totalCost: number; totalDistance: number }>();

	for (const log of fuelLogs) {
		const distance = getFuelEntryDistance(log);
		if (distance === null || !isFiniteNumber(log.totalCost)) {
			continue;
		}

		const currency = log.currency ?? homeCurrency;
		const totalsForCurrency = totals.get(currency) ?? { totalCost: 0, totalDistance: 0 };
		totalsForCurrency.totalCost += log.totalCost;
		totalsForCurrency.totalDistance += convertDistanceToUnit(
			distance,
			log.distanceUnit,
			distanceUnit
		);
		totals.set(currency, totalsForCurrency);
	}

	const result: Record<string, CostPerDistanceEntry> = {};
	for (const [currency, { totalCost, totalDistance }] of totals) {
		if (!isFiniteNumber(totalDistance) || totalDistance <= 0 || !isFiniteNumber(totalCost)) {
			continue;
		}

		result[currency] = {
			costPerDistance: totalCost / totalDistance,
			totalCost,
			totalDistance,
			distanceUnit
		};
	}

	return result;
}

/**
 * Overall volume-weighted fuel consumption, expressed in the display unit implied
 * by `preferredFuelUnit` — L/100km (volume in L over distance in km) or MPG
 * (distance in mi over volume in gal). Mirrors `costPerDistance`'s methodology: a
 * true overall rate (Σvolume / Σdistance), NOT a mean of per-tank values. Only
 * fuel logs whose distance is derivable (consumption > 0) contribute, and each
 * fill's volume + distance are normalized to the display unit before summing, so
 * mixed L/gal rows combine correctly. Consumption is currency-independent, so —
 * unlike `costPerDistance` — this returns a single value (or `null` when no fill
 * has a derivable distance / the totals are non-positive). Pure: no DB, no Svelte.
 */
export function averageConsumption(
	fuelLogs: FuelLog[],
	preferredFuelUnit: FuelUnit = 'L/100km'
): number | null {
	const distanceUnit = getDistanceUnitForFuelUnit(preferredFuelUnit);
	const volumeUnit = getVolumeUnitForFuelUnit(preferredFuelUnit);

	let totalVolume = 0;
	let totalDistance = 0;

	for (const log of fuelLogs) {
		const distance = getFuelEntryDistance(log);
		if (distance === null) {
			continue;
		}

		totalVolume += convertVolumeToUnit(log.quantity, log.unit, volumeUnit);
		totalDistance += convertDistanceToUnit(distance, log.distanceUnit, distanceUnit);
	}

	if (
		!isFiniteNumber(totalDistance) ||
		totalDistance <= 0 ||
		!isFiniteNumber(totalVolume) ||
		totalVolume <= 0
	) {
		return null;
	}

	return volumeUnit === 'L' ? (totalVolume / totalDistance) * 100 : totalDistance / totalVolume;
}
