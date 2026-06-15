// Pure, deterministic due-status calculation for service reminders.
//
// `today` is always passed in (never read from the clock here) so the function is fully
// testable and side-effect free. Distances use whatever distance unit the vehicle's logs
// use (km or mi); the field is named `intervalKm` for parity with the schema but the math
// is unit-agnostic — the caller supplies a matching odometer.

import type { ServiceReminder } from '$lib/db/schema';
import { REMINDER_DUE_SOON_KM, REMINDER_DUE_SOON_DAYS } from '$lib/config';

export { REMINDER_DUE_SOON_KM, REMINDER_DUE_SOON_DAYS };

export type ReminderStatus = 'ok' | 'due-soon' | 'overdue';

export interface ReminderStatusResult {
	status: ReminderStatus;
	kmRemaining?: number;
	daysRemaining?: number;
	label: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole-day difference between two dates, counted from local midnight (ignores time-of-day). */
function wholeDaysBetween(from: Date, to: Date): number {
	const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
	const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
	return Math.round((toMidnight - fromMidnight) / MS_PER_DAY);
}

function isUsablePositive(value: number | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Format a number with thousands grouping for the human-readable label. */
function formatCount(value: number): string {
	return Math.abs(value).toLocaleString('en-US');
}

/**
 * Compute the due status of a reminder relative to the current odometer and `today`.
 *
 * - `kmRemaining` = lastServiceOdometer + intervalKm − currentOdometer, only when
 *   `intervalKm` and `currentOdometer` are both known (lastServiceOdometer defaults to 0).
 * - `daysRemaining` = whole days between (lastServiceDate + intervalDays) and `today`,
 *   only when `intervalDays` and `lastServiceDate` are both known.
 * - `status` is `overdue` if any computed remaining ≤ 0, `due-soon` if any is within its
 *   threshold (km ≤ REMINDER_DUE_SOON_KM or days ≤ REMINDER_DUE_SOON_DAYS), else `ok`.
 */
export function computeReminderStatus(
	reminder: ServiceReminder,
	currentOdometer: number | undefined,
	today: Date
): ReminderStatusResult {
	let kmRemaining: number | undefined;
	if (
		isUsablePositive(reminder.intervalKm) &&
		typeof currentOdometer === 'number' &&
		Number.isFinite(currentOdometer)
	) {
		const base = isUsablePositive(reminder.lastServiceOdometer) ? reminder.lastServiceOdometer : 0;
		kmRemaining = base + reminder.intervalKm - currentOdometer;
	}

	let daysRemaining: number | undefined;
	if (
		isUsablePositive(reminder.intervalDays) &&
		reminder.lastServiceDate instanceof Date &&
		!Number.isNaN(reminder.lastServiceDate.getTime())
	) {
		const due = new Date(reminder.lastServiceDate);
		due.setDate(due.getDate() + reminder.intervalDays);
		daysRemaining = wholeDaysBetween(today, due);
	}

	const remainings: number[] = [];
	if (kmRemaining !== undefined) remainings.push(kmRemaining);
	if (daysRemaining !== undefined) remainings.push(daysRemaining);

	let status: ReminderStatus;
	if (remainings.length === 0) {
		// No actionable signal (e.g. interval set but the dependent input is missing).
		status = 'ok';
	} else if (remainings.some((value) => value <= 0)) {
		status = 'overdue';
	} else {
		const kmDueSoon = kmRemaining !== undefined && kmRemaining <= REMINDER_DUE_SOON_KM;
		const daysDueSoon = daysRemaining !== undefined && daysRemaining <= REMINDER_DUE_SOON_DAYS;
		status = kmDueSoon || daysDueSoon ? 'due-soon' : 'ok';
	}

	return {
		status,
		kmRemaining,
		daysRemaining,
		label: buildLabel(status, kmRemaining, daysRemaining)
	};
}

function pluralizeDays(days: number): string {
	return Math.abs(days) === 1 ? 'day' : 'days';
}

function buildLabel(
	status: ReminderStatus,
	kmRemaining: number | undefined,
	daysRemaining: number | undefined
): string {
	if (kmRemaining === undefined && daysRemaining === undefined) {
		return 'No due date yet';
	}

	if (status === 'overdue') {
		// Report whichever dimension(s) crossed zero, most-overdue first isn't needed —
		// just show each overdue dimension; if only one is overdue, show that one.
		const parts: string[] = [];
		if (kmRemaining !== undefined && kmRemaining <= 0) {
			parts.push(`${formatCount(kmRemaining)} km`);
		}
		if (daysRemaining !== undefined && daysRemaining <= 0) {
			parts.push(`${formatCount(daysRemaining)} ${pluralizeDays(daysRemaining)}`);
		}
		return `Overdue by ${parts.join(' / ')}`;
	}

	// ok or due-soon: show remaining across whichever dimensions are known.
	const parts: string[] = [];
	if (kmRemaining !== undefined) {
		parts.push(`${formatCount(kmRemaining)} km`);
	}
	if (daysRemaining !== undefined) {
		parts.push(`${formatCount(daysRemaining)} ${pluralizeDays(daysRemaining)}`);
	}
	return `Due in ${parts.join(' / ')}`;
}
