// Predicted service-date model for distance-interval reminders (Story 4.5 / FR-12 prediction, FR-10
// predicted date, FR-19). The NET-NEW glue between two already-shipped pieces:
//   kmRemaining (serviceReminder.computeReminderStatus, Story 3.x)  ÷  cadence().distancePerDay (Story 4.1)
//     → a whole-day horizon → a target Date → a relative phrase ("≈ due in 3 weeks").
//
// Pure read model: no Result<T>, no Svelte, no Dexie, no network. `now` is injectable for tests.
// The engine NEVER guesses (DEC-9/FR-19): every path that can't honestly produce a future date
// returns an explicit `omit` with a reason instead of a fabricated or `NaN` value.

import type { FuelLog, ServiceReminder } from '$lib/db/schema';
import { convertDistanceUnit, isFiniteNumber } from '$lib/utils/calculations';
import { computeReminderStatus } from '$lib/utils/serviceReminder';
import { mostRecentDistanceUnit } from '$lib/utils/reminderLoopClose';
import { cadence } from '$lib/utils/metrics/cadence';
import { m } from '$lib/paraglide/messages';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Beyond ~1 year out a distance-based prediction is too speculative to surface (OQ-5): at that
 * horizon small cadence noise swings the date by weeks, so we omit rather than over-promise.
 */
export const MAX_PREDICTION_DAYS = 365;

/** Calm, honest note shown in place of a date when the cadence is insufficient (AC4, DEC-13). */
export const REMINDER_PREDICTION_INSUFFICIENT_NOTE = m.reminder_prediction_insufficient();

export type ReminderPredictionOmitReason =
	| 'no-distance-interval' // time-only reminder — nothing to predict from distance
	| 'unknown-odometer' // currentOdometer missing → no kmRemaining
	| 'already-overdue' // kmRemaining ≤ 0 → there is no future date to predict
	| 'cadence-insufficient' // not enough recent driving to estimate a km/day rate
	| 'beyond-horizon'; // predicted > MAX_PREDICTION_DAYS out → low confidence

export type ReminderPrediction =
	| { status: 'ok'; date: Date; daysUntilDue: number }
	| { status: 'omit'; reason: ReminderPredictionOmitReason };

/**
 * Predict when a distance-interval reminder comes due, from the vehicle's recent driving cadence.
 *
 * @param reminder The reminder (only distance intervals are predictable here).
 * @param fuelLogs The vehicle's fuel logs (feeds `cadence` + fixes the odometer unit).
 * @param currentOdometer Max odometer across the vehicle's fuel logs (same definition as the
 *   Up-Next card / Settings); `undefined` when no log has a usable odometer.
 * @param now Reference date (default real clock).
 */
export function predictReminderDate(
	reminder: ServiceReminder,
	fuelLogs: FuelLog[],
	currentOdometer: number | undefined,
	now: Date = new Date()
): ReminderPrediction {
	// A time-only reminder has no distance horizon to predict — its remaining-time label suffices.
	if (!isFiniteNumber(reminder.intervalKm) || reminder.intervalKm <= 0) {
		return { status: 'omit', reason: 'no-distance-interval' };
	}

	// Reuse computeReminderStatus's kmRemaining — do NOT re-derive it (single source of truth).
	const { kmRemaining } = computeReminderStatus(reminder, currentOdometer, now, fuelLogs);
	if (kmRemaining === undefined) {
		return { status: 'omit', reason: 'unknown-odometer' };
	}
	if (kmRemaining <= 0) {
		// Already overdue on distance — there is no future date to predict (the status says overdue).
		return { status: 'omit', reason: 'already-overdue' };
	}

	const rate = cadence(fuelLogs, now);
	if (rate.status !== 'ok') {
		return { status: 'omit', reason: 'cadence-insufficient' };
	}

	// Divide in ONE common unit. `kmRemaining` is in the reminder/odometer unit (the most-recent log's
	// unit); convert the cadence rate into it. A missing unit or a non-finite quotient → omit, never ≈NaN.
	const reminderUnit = mostRecentDistanceUnit(fuelLogs);
	if (!reminderUnit) {
		return { status: 'omit', reason: 'cadence-insufficient' };
	}
	const ratePerDay = convertDistanceUnit(rate.distancePerDay, rate.distanceUnit, reminderUnit);
	const rawDays = kmRemaining / ratePerDay;
	if (!isFiniteNumber(rawDays) || rawDays <= 0) {
		return { status: 'omit', reason: 'cadence-insufficient' };
	}

	const daysUntilDue = Math.round(rawDays);
	if (daysUntilDue > MAX_PREDICTION_DAYS) {
		return { status: 'omit', reason: 'beyond-horizon' };
	}

	return {
		status: 'ok',
		daysUntilDue,
		date: new Date(now.getTime() + daysUntilDue * MS_PER_DAY)
	};
}

/**
 * The date dimension's exact due horizon (Story 8.5 / S23-S25 / AD-RT-7) — NOT a cadence estimate
 * (`daysRemaining` is a direct calendar subtraction, computeReminderStatus's baseline + intervalDays
 * minus `now`), so there is no "insufficient evidence" case here, only "no time interval" / "already
 * due or overdue" / "beyond the same horizon the km path is capped at" (S24/S25 — MAX_PREDICTION_DAYS
 * applies to BOTH dimensions, so neither can predict further out than the other).
 */
function dateBasedDaysUntilDue(
	reminder: ServiceReminder,
	currentOdometer: number | undefined,
	now: Date,
	fuelLogs: FuelLog[]
): number | undefined {
	if (!isFiniteNumber(reminder.intervalDays) || reminder.intervalDays <= 0) return undefined;
	const { daysRemaining } = computeReminderStatus(reminder, currentOdometer, now, fuelLogs);
	if (daysRemaining === undefined || daysRemaining <= 0 || daysRemaining > MAX_PREDICTION_DAYS) {
		return undefined;
	}
	return daysRemaining;
}

/**
 * Format a predicted horizon as a calm, approximate relative phrase with the `≈` marker
 * (e.g. "≈ due in 3 weeks" / "≈ due in 5 days" / "≈ due tomorrow"). Reuses `Intl.RelativeTimeFormat`
 * (mirror `recency.ts`, `numeric:'auto'`) — never hand-formats dates. Buckets to whole weeks once the
 * horizon reaches a fortnight, else whole days (DEC-13 voice: lowercase, no exclamation, no urgency).
 */
export function formatPredictedDue(daysUntilDue: number): string {
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	const phrase =
		daysUntilDue >= 14
			? rtf.format(Math.round(daysUntilDue / 7), 'week')
			: rtf.format(daysUntilDue, 'day');
	return m.reminder_prediction_due({ phrase });
}

export interface PredictedDateView {
	/** `date` → render the `≈` phrase; `note` → render the honest insufficient note; `none` → render nothing. */
	kind: 'date' | 'note' | 'none';
	text: string;
}

/**
 * Map a reminder to what its predicted-date row should render on a surface — so components stay dumb.
 * A sufficient prediction shows the `≈` date; an insufficient cadence shows the honest note; every
 * other omit reason (time-only, overdue, unknown odometer) renders nothing extra (the remaining
 * distance/time label already conveys that state — never a blank, a fake date, or `≈ NaN`).
 *
 * Story 8.5 / S23 / AD-RT-7 tie-break: a reminder with BOTH a distance and a time interval has two
 * independent due candidates — the km path (cadence-derived, uncertain) and the date path (exact
 * calendar subtraction, no estimation). The NEARER one is surfaced; ties favor the date prediction,
 * since km-drift interpolation carries more uncertainty than a calendar date. A time-only reminder
 * (no distance interval) is unaffected — its exact days-remaining is already the primary status
 * label, so no separate "≈" row is shown for it (unchanged from Story 4.5).
 */
export function predictedDateView(
	reminder: ServiceReminder,
	fuelLogs: FuelLog[],
	currentOdometer: number | undefined,
	now: Date = new Date()
): PredictedDateView {
	const kmPrediction = predictReminderDate(reminder, fuelLogs, currentOdometer, now);
	if (kmPrediction.status === 'omit' && kmPrediction.reason === 'no-distance-interval') {
		return { kind: 'none', text: '' };
	}

	const dateDays = dateBasedDaysUntilDue(reminder, currentOdometer, now, fuelLogs);

	if (kmPrediction.status === 'ok' && dateDays !== undefined) {
		const daysUntilDue =
			dateDays <= kmPrediction.daysUntilDue ? dateDays : kmPrediction.daysUntilDue;
		return { kind: 'date', text: formatPredictedDue(daysUntilDue) };
	}
	if (dateDays !== undefined) {
		return { kind: 'date', text: formatPredictedDue(dateDays) };
	}
	if (kmPrediction.status === 'ok') {
		return { kind: 'date', text: formatPredictedDue(kmPrediction.daysUntilDue) };
	}
	if (kmPrediction.reason === 'cadence-insufficient') {
		return { kind: 'note', text: m.reminder_prediction_insufficient() };
	}
	return { kind: 'none', text: '' };
}
