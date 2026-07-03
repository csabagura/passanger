import type { FuelUnit } from '$lib/config';
import { DEFAULT_CURRENCY, MIN_INSIGHT_SAMPLE_SIZE } from '$lib/config';
import type { FuelLog } from '$lib/db/schema';
import { getMonthKey, isFiniteNumber } from '$lib/utils/calculations';
import { averageConsumption, costPerDistance } from '$lib/utils/analytics';
import {
	resolveHistoryEntryCurrency,
	summarizeSpendByCurrency,
	type HistoryEntry
} from '$lib/utils/historyEntries';

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
	| {
			status: 'insufficient';
			reason: 'missing-period' | 'no-baseline' | 'no-current' | 'insufficient-sample';
	  };

/**
 * The reusable comparison primitive. Either side being `null`/non-finite yields `missing-period`;
 * either sample-size arg (when provided) being below `MIN_INSIGHT_SAMPLE_SIZE` yields
 * `insufficient-sample` (H19b — a single underlying observation must not produce a confident
 * percentage); a non-positive `previous` (`<= 0`) yields `no-baseline` (a percent change against a
 * zero or negative baseline is meaningless — `0` gives `Infinity`, and a negative baseline
 * sign-flips `percentChange` against `direction` — so downstream shows "log more to see a trend"
 * instead); a non-positive `current` yields `no-current` (H19a — a single 0-cost entry must not
 * read as "down about 100%"). `currentSampleSize`/`previousSampleSize` are optional and
 * backward-compatible — a caller that omits them skips the sample-size gate entirely.
 */
export function comparePeriods(
	current: number | null,
	previous: number | null,
	currentSampleSize?: number,
	previousSampleSize?: number
): PeriodDelta {
	if (!isFiniteNumber(current) || !isFiniteNumber(previous)) {
		return { status: 'insufficient', reason: 'missing-period' };
	}

	if (
		(currentSampleSize !== undefined && currentSampleSize < MIN_INSIGHT_SAMPLE_SIZE) ||
		(previousSampleSize !== undefined && previousSampleSize < MIN_INSIGHT_SAMPLE_SIZE)
	) {
		return { status: 'insufficient', reason: 'insufficient-sample' };
	}

	// A zero OR negative baseline can't anchor a percent change: `0` → `Infinity`, and a negative
	// `previous` (reachable via `spendDelta` on a refund/credit month) sign-flips `percentChange`
	// against `direction`. Treat both as "no baseline yet".
	if (previous <= 0) {
		return { status: 'insufficient', reason: 'no-baseline' };
	}

	// Symmetric guard for the current side (H19a): a zero/negative current (a month whose only
	// entries are 0-cost imports, or a refund-netted month) is insufficient, not a −100% signal.
	if (current <= 0) {
		return { status: 'insufficient', reason: 'no-current' };
	}

	const absoluteChange = current - previous;
	const percentChange = (absoluteChange / previous) * 100;
	const direction = absoluteChange > 0 ? 'up' : absoluteChange < 0 ? 'down' : 'flat';

	return { status: 'ok', current, previous, absoluteChange, percentChange, direction };
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

	// Consumption is currency-independent, so a raw fuel-log count is the correct sample size —
	// no per-currency split needed (unlike spend/cost-per-distance/fuel-price below).
	return comparePeriods(
		averageConsumption(currentLogs, preferredFuelUnit),
		averageConsumption(previousLogs, preferredFuelUnit),
		currentLogs.length,
		previousLogs.length
	);
}

/**
 * Spend delta per currency: this calendar month's month-to-date spend vs the previous month's spend
 * over the SAME day-of-month range (H5), grouped by currency (never summed across currencies). Early
 * in a month, comparing a few days of current spend against the previous month's ENTIRE total produced
 * a large, spurious "down" swing (e.g. "Spending is down about 83%" from 5 days vs 30) — the day-clamp
 * makes this a true like-for-like total. `dayLimit` is today's day-of-month; the previous month's
 * entries are additionally filtered to `getDate() <= dayLimit`, which naturally does nothing extra
 * when the previous month has fewer days than `dayLimit` (e.g. querying on the 31st against a
 * 28/29/30-day previous month — every one of its days already satisfies `<= dayLimit`). A currency
 * present in only one of the two windows yields `insufficient` for that currency (no baseline).
 */
export function spendDelta(
	entries: HistoryEntry[],
	homeCurrency: string = DEFAULT_CURRENCY,
	now: Date = new Date()
): Record<string, PeriodDelta> {
	const { current, previous } = currentAndPreviousMonthKeys(now);
	const dayLimit = now.getDate();
	const currentEntries = entries.filter((entry) => getMonthKey(entry.entry.date) === current);
	const previousEntries = entries.filter(
		(entry) => getMonthKey(entry.entry.date) === previous && entry.entry.date.getDate() <= dayLimit
	);
	const currentSpend = summarizeSpendByCurrency(currentEntries, homeCurrency);
	const previousSpend = summarizeSpendByCurrency(previousEntries, homeCurrency);

	const currencies = new Set([...Object.keys(currentSpend), ...Object.keys(previousSpend)]);
	const result: Record<string, PeriodDelta> = {};
	for (const currency of currencies) {
		// H19b (AC3): "2 observations IN THAT CURRENCY" — count entries resolved to this currency,
		// not the raw window length, so one currency's volume can't mask another's single-data-point.
		const currentSampleSize = currentEntries.filter(
			(entry) => resolveHistoryEntryCurrency(entry, homeCurrency) === currency
		).length;
		const previousSampleSize = previousEntries.filter(
			(entry) => resolveHistoryEntryCurrency(entry, homeCurrency) === currency
		).length;
		result[currency] = comparePeriods(
			currentSpend[currency] ?? null,
			previousSpend[currency] ?? null,
			currentSampleSize,
			previousSampleSize
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
	const currentLogs = fuelLogs.filter((log) => getMonthKey(log.date) === current);
	const previousLogs = fuelLogs.filter((log) => getMonthKey(log.date) === previous);
	const currentRates = costPerDistance(currentLogs, homeCurrency, preferredFuelUnit);
	const previousRates = costPerDistance(previousLogs, homeCurrency, preferredFuelUnit);

	const currencies = new Set([...Object.keys(currentRates), ...Object.keys(previousRates)]);
	const result: Record<string, PeriodDelta> = {};
	for (const currency of currencies) {
		// H19b (AC3): count fuel logs resolved to this currency in each already-date-filtered window,
		// mirroring the `log.currency ?? homeCurrency` grouping `costPerDistance` itself uses.
		const currentSampleSize = currentLogs.filter(
			(log) => (log.currency ?? homeCurrency) === currency
		).length;
		const previousSampleSize = previousLogs.filter(
			(log) => (log.currency ?? homeCurrency) === currency
		).length;
		result[currency] = comparePeriods(
			currentRates[currency]?.costPerDistance ?? null,
			previousRates[currency]?.costPerDistance ?? null,
			currentSampleSize,
			previousSampleSize
		);
	}

	return result;
}
