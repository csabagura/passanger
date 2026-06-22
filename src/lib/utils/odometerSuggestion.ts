/**
 * Story 2.2 — Smart defaults on Capture (FR-4).
 *
 * Pure odometer-suggestion + sanity-classification helpers. No Svelte/Dexie imports
 * (mirrors the `calculations.ts` / `fuelLogTimeline.ts` pure-util style; AD-5 "pure
 * modules in utils"). The Fuel form feeds these the vehicle's historical inter-fill
 * odometer deltas (already loaded for the timeline) to (a) suggest the next reading and
 * (b) decide when to show a calm, NON-blocking sanity warning.
 *
 * The implausibly-high thresholds live in `$lib/config` (no magic values inline).
 */
import { ODOMETER_IMPLAUSIBLE_DELTA_MULTIPLIER, ODOMETER_IMPLAUSIBLE_MIN_DELTA } from '$lib/config';

/**
 * Median of the POSITIVE deltas (non-positive and non-finite values are filtered out
 * first, so corrupt NaN/Infinity readings never yield a NaN suggestion). Returns
 * `undefined` when no positive deltas remain. Even count → average of the two middle
 * values.
 */
export function medianDelta(deltas: number[]): number | undefined {
	const positive = deltas
		.filter((delta) => Number.isFinite(delta) && delta > 0)
		.sort((a, b) => a - b);
	if (positive.length === 0) {
		return undefined;
	}

	const middle = Math.floor(positive.length / 2);
	return positive.length % 2 === 0
		? (positive[middle - 1] + positive[middle]) / 2
		: positive[middle];
}

/**
 * Suggested next odometer = `previousOdometer + medianDelta(deltas)`, rounded to an
 * integer, when BOTH a `previousOdometer` and a positive `medianDelta` exist. Otherwise
 * `undefined` (so 0 or 1 prior logs ⇒ no suggestion — honest, no magic constant, and
 * never pre-fills a value that would itself warn).
 */
export function suggestNextOdometer(
	previousOdometer: number | undefined,
	deltas: number[]
): number | undefined {
	if (previousOdometer === undefined) {
		return undefined;
	}

	const median = medianDelta(deltas);
	if (median === undefined) {
		return undefined;
	}

	return Math.round(previousOdometer + median);
}

export type OdometerAnomaly = 'below-previous' | 'implausibly-high' | null;

/**
 * Classify an entered odometer against the previous reading for a NON-blocking sanity
 * warning:
 *   - `null` when there is no comparable `previousOdometer` (nothing to compare to);
 *   - `'below-previous'` when `value <= previousOdometer`;
 *   - `'implausibly-high'` when `(value - previousOdometer)` exceeds
 *     `max(typicalDelta * MULTIPLIER, MIN_DELTA)` — when `typicalDelta` is `undefined`,
 *     the absolute `MIN_DELTA` floor is used alone;
 *   - else `null`.
 */
export function classifyOdometer(
	value: number,
	previousOdometer: number | undefined,
	typicalDelta: number | undefined
): OdometerAnomaly {
	if (previousOdometer === undefined) {
		return null;
	}

	if (value <= previousOdometer) {
		return 'below-previous';
	}

	const threshold =
		typicalDelta === undefined
			? ODOMETER_IMPLAUSIBLE_MIN_DELTA
			: Math.max(
					typicalDelta * ODOMETER_IMPLAUSIBLE_DELTA_MULTIPLIER,
					ODOMETER_IMPLAUSIBLE_MIN_DELTA
				);

	return value - previousOdometer > threshold ? 'implausibly-high' : null;
}
