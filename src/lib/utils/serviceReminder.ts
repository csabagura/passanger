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

/**
 * Badge presentation (Tailwind classes + short badge label) per status. Shared by the
 * Settings reminders list and the /log due-soon card so the styling stays in one place.
 * Note: `label` here is the short badge word ("Overdue"), distinct from the per-reminder
 * human label on `ReminderStatusResult` ("Overdue by 120 km").
 */
export const REMINDER_STATUS_PRESENTATION: Record<
	ReminderStatus,
	{ badge: string; label: string }
> = {
	overdue: {
		badge: 'border-destructive/30 bg-destructive/10 text-destructive',
		label: 'Overdue'
	},
	'due-soon': { badge: 'border-amber-500/30 bg-amber-500/10 text-amber-600', label: 'Due soon' },
	ok: { badge: 'border-border bg-muted/40 text-muted-foreground', label: 'On track' }
};

export interface DueReminder {
	reminder: ServiceReminder;
	status: ReminderStatusResult;
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

/**
 * Select the reminders that need attention — `overdue` and `due-soon` only (never `ok`) —
 * ordered overdue-first then due-soon, preserving the input order within each group.
 * Deterministic without comparing across units (km vs days).
 */
export function selectDueReminders(
	reminders: ServiceReminder[],
	currentOdometer: number | undefined,
	today: Date
): DueReminder[] {
	const overdue: DueReminder[] = [];
	const dueSoon: DueReminder[] = [];
	for (const reminder of reminders) {
		const status = computeReminderStatus(reminder, currentOdometer, today);
		if (status.status === 'overdue') {
			overdue.push({ reminder, status });
		} else if (status.status === 'due-soon') {
			dueSoon.push({ reminder, status });
		}
	}
	return [...overdue, ...dueSoon];
}
