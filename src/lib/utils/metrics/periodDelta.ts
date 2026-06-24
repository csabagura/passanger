import type { FuelUnit } from '$lib/config';
import { DEFAULT_CURRENCY } from '$lib/config';
import type { FuelLog } from '$lib/db/schema';
import { isFiniteNumber } from '$lib/utils/calculations';
import { averageConsumption, costPerDistance } from '$lib/utils/analytics';
import { summarizeSpendByCurrency, type HistoryEntry } from '$lib/utils/historyEntries';

/**
 * Derived-metrics engine — month-over-month deltas (Story 4.1 / FR-19, DEC-9).
 *
 * The delta period is the CALENDAR MONTH (DEC-9): "the current calendar month vs the previous
 * calendar month". Each comparison is an explicit discriminated result — `{ status: 'ok', … }` when
 * both periods have a comparable value, or `{ status: 'insufficient' }` when a baseline is missing —
 * so callers (4.2 trend chip, 4.3 Insight) never have to disambiguate a real `0` from "no data".
 *
 * Pure: no Svelte, no DB, no clock read except the injectable `now` default. Returns raw data /
 * discriminated unions, NOT `Result<T>` (the engine's read-model convention — see `analytics.ts`).
 * Spend/cost are NEVER summed across currencies (offline, no FX).
 */

export type PeriodDelta =
	| {
			status: 'ok';
			/** The current calendar month's value. */
			current: number;
			/** The previous calendar month's value (the baseline). */
			previous: number;
			/** Signed `current − previous`. */
			absoluteChange: number;
			/** Signed `(absoluteChange / previous) * 100`. */
			percentChange: number;
			/** Sign of `absoluteChange`; `0 → 'flat'`. (A flat band, if any, is a downstream decision.) */
			direction: 'up' | 'down' | 'flat';
	  }
	| { status: 'insufficient'; reason: 'missing-period' | 'no-baseline' };

/**
 * The reusable comparison primitive. Either side being `null`/non-finite yields `missing-period`; a
 * non-positive `previous` (`<= 0`) yields `no-baseline` (a percent change against a zero or negative
 * baseline is meaningless — `0` gives `Infinity`, and a negative baseline sign-flips `percentChange`
 * against `direction` — so downstream shows "log more to see a trend" instead).
 */
export function comparePeriods(current: number | null, previous: number | null): PeriodDelta {
	if (!isFiniteNumber(current) || !isFiniteNumber(previous)) {
		return { status: 'insufficient', reason: 'missing-period' };
	}

	// A zero OR negative baseline can't anchor a percent change: `0` → `Infinity`, and a negative
	// `previous` (reachable via `spendDelta` on a refund/credit month) sign-flips `percentChange`
	// against `direction`. Treat both as "no baseline yet".
	if (previous <= 0) {
		return { status: 'insufficient', reason: 'no-baseline' };
	}

	const absoluteChange = current - previous;
	const percentChange = (absoluteChange / previous) * 100;
	const direction = absoluteChange > 0 ? 'up' : absoluteChange < 0 ? 'down' : 'flat';

	return { status: 'ok', current, previous, absoluteChange, percentChange, direction };
}

function getMonthKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Calendar-month keys for the month containing `now` and the immediately preceding month. */
function currentAndPreviousMonthKeys(now: Date): { current: string; previous: string } {
	return {
		current: getMonthKey(now),
		previous: getMonthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))
	};
}

/**
 * Volume-weighted consumption delta: this calendar month's overall consumption vs last month's,
 * each computed via `averageConsumption` (so mixed L/gal rows combine correctly and a non-finite
 * row is skipped by PREP-1). Consumption is currency-independent, so this is a single delta.
 */
export function consumptionDelta(
	fuelLogs: FuelLog[],
	preferredFuelUnit: FuelUnit = 'L/100km',
	now: Date = new Date()
): PeriodDelta {
	const { current, previous } = currentAndPreviousMonthKeys(now);
	const currentLogs = fuelLogs.filter((log) => getMonthKey(log.date) === current);
	const previousLogs = fuelLogs.filter((log) => getMonthKey(log.date) === previous);

	return comparePeriods(
		averageConsumption(currentLogs, preferredFuelUnit),
		averageConsumption(previousLogs, preferredFuelUnit)
	);
}

/**
 * Spend delta per currency: this calendar month's spend vs last month's, grouped by currency
 * (never summed across currencies). A currency present in only one of the two months yields
 * `insufficient` for that currency (no baseline to compare against).
 */
export function spendDelta(
	entries: HistoryEntry[],
	homeCurrency: string = DEFAULT_CURRENCY,
	now: Date = new Date()
): Record<string, PeriodDelta> {
	const { current, previous } = currentAndPreviousMonthKeys(now);
	const currentSpend = summarizeSpendByCurrency(
		entries.filter((entry) => getMonthKey(entry.entry.date) === current),
		homeCurrency
	);
	const previousSpend = summarizeSpendByCurrency(
		entries.filter((entry) => getMonthKey(entry.entry.date) === previous),
		homeCurrency
	);

	const currencies = new Set([...Object.keys(currentSpend), ...Object.keys(previousSpend)]);
	const result: Record<string, PeriodDelta> = {};
	for (const currency of currencies) {
		result[currency] = comparePeriods(
			currentSpend[currency] ?? null,
			previousSpend[currency] ?? null
		);
	}

	return result;
}

/**
 * Cost-per-distance delta per currency (OQ-1 / PREP-4): this calendar month's fuel cost-per-distance
 * vs last month's, per currency, via the same `costPerDistance` methodology. Built here so Story 4.2's
 * Hero trend — which reflects the toggled cost/consumption metric — needn't re-bucket the data.
 */
export function costPerDistanceDelta(
	fuelLogs: FuelLog[],
	homeCurrency: string = DEFAULT_CURRENCY,
	preferredFuelUnit: FuelUnit = 'L/100km',
	now: Date = new Date()
): Record<string, PeriodDelta> {
	const { current, previous } = currentAndPreviousMonthKeys(now);
	const currentRates = costPerDistance(
		fuelLogs.filter((log) => getMonthKey(log.date) === current),
		homeCurrency,
		preferredFuelUnit
	);
	const previousRates = costPerDistance(
		fuelLogs.filter((log) => getMonthKey(log.date) === previous),
		homeCurrency,
		preferredFuelUnit
	);

	const currencies = new Set([...Object.keys(currentRates), ...Object.keys(previousRates)]);
	const result: Record<string, PeriodDelta> = {};
	for (const currency of currencies) {
		result[currency] = comparePeriods(
			currentRates[currency]?.costPerDistance ?? null,
			previousRates[currency]?.costPerDistance ?? null
		);
	}

	return result;
}
