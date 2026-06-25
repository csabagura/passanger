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
 * The unit `kmRemaining` and the reminder's odometer fields are expressed in: the most-recent fuel
 * log's distance unit — the unit the driver currently sees and enters values against (the same one
 * `cadence` fixes its rate to). When `cadence` is `ok` the most-recent overall log is necessarily
 * the most-recent in-window log, so this equals `cadence.distanceUnit` — but we convert the rate
 * into this unit explicitly anyway so the division can never silently mix km and mi.
 */
function mostRecentDistanceUnit(fuelLogs: FuelLog[]): 'km' | 'mi' | undefined {
	let latest: FuelLog | undefined;
	for (const log of fuelLogs) {
		if (!isFiniteNumber(log.odometer)) continue;
		if (!latest || log.date.getTime() > latest.date.getTime()) latest = log;
	}
	return latest?.distanceUnit;
}

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
	const { kmRemaining } = computeReminderStatus(reminder, currentOdometer, now);
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
 */
export function predictedDateView(
	reminder: ServiceReminder,
	fuelLogs: FuelLog[],
	currentOdometer: number | undefined,
	now: Date = new Date()
): PredictedDateView {
	const prediction = predictReminderDate(reminder, fuelLogs, currentOdometer, now);
	if (prediction.status === 'ok') {
		return { kind: 'date', text: formatPredictedDue(prediction.daysUntilDue) };
	}
	if (prediction.reason === 'cadence-insufficient') {
		return { kind: 'note', text: m.reminder_prediction_insufficient() };
	}
	return { kind: 'none', text: '' };
}
