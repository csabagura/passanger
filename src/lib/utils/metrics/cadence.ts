import type { FuelLog } from '$lib/db/schema';
import { CADENCE_WINDOW_DAYS, CADENCE_MIN_LOGS, CADENCE_MIN_SPAN_DAYS } from '$lib/config';
import { isFiniteNumber, KILOMETERS_PER_MILE } from '$lib/utils/calculations';
import { wholeCalendarDaysBetween } from '$lib/utils/metrics/recency';

/**
 * Derived-metrics engine — driving cadence (Story 4.1 / FR-19, DEC-9).
 *
 * Estimates distance-per-day from the odometer span across fuel logs in the trailing
 * `CADENCE_WINDOW_DAYS` (90) days. It reports a rate ONLY with enough evidence — at least
 * `CADENCE_MIN_LOGS` (3) in-window logs spanning at least `CADENCE_MIN_SPAN_DAYS` (14) calendar
 * days — otherwise an explicit `insufficient` result (never a guess, never `NaN`/`Infinity`).
 * Consumed by Story 4.5's predicted-date math; this story builds only the km/day estimator.
 *
 * Pure: no Svelte, no DB; injectable `now`. The rate is in the logs' native distance unit — units
 * are never mixed by subtracting raw odometers; the most-recent in-window log fixes the unit and the
 * others are converted into it (OQ-2).
 */

export type CadenceResult =
	| {
			status: 'ok';
			/** Distance covered per calendar day over the window, in `distanceUnit`. */
			distancePerDay: number;
			/** The unit the rate is expressed in (the most-recent in-window log's unit). */
			distanceUnit: 'km' | 'mi';
			/** How many in-window logs contributed. */
			logsConsidered: number;
			/** Calendar-day span between the earliest and latest in-window log. */
			spanDays: number;
	  }
	| {
			status: 'insufficient';
			reason: 'too-few-logs' | 'span-too-short' | 'no-distance';
	  };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

export function cadence(fuelLogs: FuelLog[], now: Date = new Date()): CadenceResult {
	const windowStart = now.getTime() - CADENCE_WINDOW_DAYS * MS_PER_DAY;

	// In-window logs with a usable (finite) odometer (PREP-1: a corrupt/legacy NaN odometer is dropped
	// rather than poisoning the span via Math.max/min). Keep the window inclusive of `now`.
	const inWindow = fuelLogs.filter(
		(log) =>
			isFiniteNumber(log.odometer) &&
			log.date.getTime() >= windowStart &&
			log.date.getTime() <= now.getTime()
	);

	if (inWindow.length < CADENCE_MIN_LOGS) {
		return { status: 'insufficient', reason: 'too-few-logs' };
	}

	// Identify the earliest- and latest-dated in-window logs. The latest log fixes the rate's unit;
	// both odometers are converted into it so a mixed-unit (imported/legacy) window stays coherent.
	let earliestLog = inWindow[0];
	let latestLog = inWindow[0];
	for (const log of inWindow) {
		if (log.date.getTime() < earliestLog.date.getTime()) earliestLog = log;
		if (log.date.getTime() > latestLog.date.getTime()) latestLog = log;
	}
	const distanceUnit = latestLog.distanceUnit;

	const spanDays = wholeCalendarDaysBetween(earliestLog.date, latestLog.date);
	if (spanDays < CADENCE_MIN_SPAN_DAYS) {
		return { status: 'insufficient', reason: 'span-too-short' };
	}

	// Net forward travel = latest − earliest odometer in DATE order. NOT max − min: that would count a
	// backwards/typo/rollover reading or a single high outlier as real distance. A non-positive net
	// means the odometer didn't advance across the window — not a guessable rate.
	const startOdometer = convertDistanceToUnit(
		earliestLog.odometer,
		earliestLog.distanceUnit,
		distanceUnit
	);
	const endOdometer = convertDistanceToUnit(
		latestLog.odometer,
		latestLog.distanceUnit,
		distanceUnit
	);
	const distance = endOdometer - startOdometer;
	const distancePerDay = distance / spanDays;
	if (!isFiniteNumber(distancePerDay) || distancePerDay <= 0) {
		return { status: 'insufficient', reason: 'no-distance' };
	}

	return {
		status: 'ok',
		distancePerDay,
		distanceUnit,
		logsConsidered: inWindow.length,
		spanDays
	};
}
