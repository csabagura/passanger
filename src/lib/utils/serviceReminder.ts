// Pure, deterministic due-status calculation for service reminders.
//
// `today` is always passed in (never read from the clock here) so the function is fully
// testable and side-effect free. Distances use whatever distance unit the vehicle's logs
// use (km or mi); the field is named `intervalKm` for parity with the schema but the math
// is unit-agnostic — the caller supplies a matching odometer.

import type { FuelLog, ServiceReminder } from '$lib/db/schema';
import { REMINDER_DUE_SOON_KM, REMINDER_DUE_SOON_MI, REMINDER_DUE_SOON_DAYS } from '$lib/config';
import { odometerAtDate, mostRecentDistanceUnit } from '$lib/utils/reminderLoopClose';
import { m } from '$lib/paraglide/messages';

export { REMINDER_DUE_SOON_KM, REMINDER_DUE_SOON_MI, REMINDER_DUE_SOON_DAYS };

/**
 * The due-soon threshold in the reminder's OWN distance unit (Story 8.5 / S22 / AD-RT-6) — a
 * distinct round number per unit, not a lossy km→mi conversion. Resolution chain: the reminder's
 * own `distanceUnit` field, else the vehicle's current display unit (most-recent fuel log's
 * `distanceUnit` — same chain the v6 migration backfill uses), else `REMINDER_DUE_SOON_KM` (the
 * pre-8.5 default, when neither signal is available).
 */
export function resolveDueSoonThresholdKm(reminder: ServiceReminder, fuelLogs: FuelLog[]): number {
	const unit = reminder.distanceUnit ?? mostRecentDistanceUnit(fuelLogs);
	return unit === 'mi' ? REMINDER_DUE_SOON_MI : REMINDER_DUE_SOON_KM;
}

export type ReminderStatus = 'ok' | 'due-soon' | 'overdue';

export interface ReminderStatusResult {
	status: ReminderStatus;
	kmRemaining?: number;
	daysRemaining?: number;
	/** The absolute odometer threshold this reminder is due at (baseline + intervalKm), when known —
	 *  independent of whether `currentOdometer` was known (unlike `kmRemaining`). Story 8.5 / AD-RT-4
	 *  dismissal due-instance model consumes this. */
	dueAtOdometer?: number;
	/** The absolute date (YYYY-MM-DD, local) this reminder is due at (baseline + intervalDays), when
	 *  known. Story 8.5 / AD-RT-4 dismissal due-instance model consumes this. */
	dueAtDate?: string;
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
	{ badge: string; readonly label: string }
> = {
	overdue: {
		badge: 'border-destructive/30 bg-destructive/10 text-destructive',
		// Getter so the badge word resolves at the active locale each read (the object is built once
		// at module load, but consumers read `.label` per render).
		get label() {
			return m.reminder_status_overdue();
		}
	},
	'due-soon': {
		badge: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
		get label() {
			return m.reminder_status_due_soon();
		}
	},
	ok: {
		badge: 'border-border bg-muted/40 text-muted-foreground',
		get label() {
			return m.reminder_status_on_track();
		}
	}
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

/** `YYYY-MM-DD` (local calendar date, no time-of-day) — the due-instance dismissal model's exact
 *  comparison key (Story 8.5 / AD-RT-4). Lexicographic string comparison sorts correctly. */
export function toDateOnlyString(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
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
 * - `kmRemaining` = baselineOdometer + intervalKm − currentOdometer, only when `intervalKm` and
 *   `currentOdometer` are known. `baselineOdometer` is `lastServiceOdometer` when present; when
 *   absent, it anchors to the vehicle's odometer interpolated at the reminder's `createdAt` (H11 /
 *   AD-RT-3, `odometerAtDate`) — `undefined` only when that interpolation itself has no signal
 *   (the vehicle has zero fuel logs).
 * - `daysRemaining` = whole days between (baselineDate + intervalDays) and `today`, only when
 *   `intervalDays` is known. `baselineDate` is `lastServiceDate` when present; when absent, it
 *   anchors to the reminder's `createdAt` (H11 / AD-RT-3) — never "no signal" unless `createdAt`
 *   itself is missing (pre-v6 unmigrated data, not expected in practice).
 * - `status` is `overdue` if any computed remaining ≤ 0, `due-soon` if any is within its
 *   threshold (km ≤ the unit-resolved due-soon threshold — `REMINDER_DUE_SOON_KM`/`_MI` per S22/
 *   AD-RT-6 — or days ≤ `REMINDER_DUE_SOON_DAYS`), else `ok`.
 */
export function computeReminderStatus(
	reminder: ServiceReminder,
	currentOdometer: number | undefined,
	today: Date,
	fuelLogs: FuelLog[] = []
): ReminderStatusResult {
	let kmRemaining: number | undefined;
	let dueAtOdometer: number | undefined;
	if (isUsablePositive(reminder.intervalKm)) {
		const baselineOdometer = isUsablePositive(reminder.lastServiceOdometer)
			? reminder.lastServiceOdometer
			: reminder.createdAt !== undefined
				? odometerAtDate(fuelLogs, reminder.createdAt)
				: undefined;
		if (baselineOdometer !== undefined) {
			dueAtOdometer = baselineOdometer + reminder.intervalKm;
			if (typeof currentOdometer === 'number' && Number.isFinite(currentOdometer)) {
				kmRemaining = dueAtOdometer - currentOdometer;
			}
		}
	}

	let daysRemaining: number | undefined;
	let dueAtDate: string | undefined;
	if (isUsablePositive(reminder.intervalDays)) {
		const baselineDate: Date | undefined =
			reminder.lastServiceDate instanceof Date && !Number.isNaN(reminder.lastServiceDate.getTime())
				? reminder.lastServiceDate
				: reminder.createdAt !== undefined
					? new Date(reminder.createdAt)
					: undefined;
		if (baselineDate !== undefined) {
			const due = new Date(baselineDate);
			due.setDate(due.getDate() + reminder.intervalDays);
			daysRemaining = wholeDaysBetween(today, due);
			dueAtDate = toDateOnlyString(due);
		}
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
		const kmDueSoon =
			kmRemaining !== undefined && kmRemaining <= resolveDueSoonThresholdKm(reminder, fuelLogs);
		const daysDueSoon = daysRemaining !== undefined && daysRemaining <= REMINDER_DUE_SOON_DAYS;
		status = kmDueSoon || daysDueSoon ? 'due-soon' : 'ok';
	}

	return {
		status,
		kmRemaining,
		daysRemaining,
		dueAtOdometer,
		dueAtDate,
		label: buildLabel(status, kmRemaining, daysRemaining)
	};
}

/** Localised "{n} km" fragment (number formatted en-US via formatCount, passed as a param). */
function kmFragment(value: number): string {
	return m.reminder_distance_km({ km: formatCount(value) });
}

/** Localised "{n} day(s)" fragment (plural selected on the absolute count). HU keeps the noun
 *  singular after a numeral, so its plural variants are authored natively. */
function daysFragment(value: number): string {
	return m.reminder_days_count({ count: Math.abs(value) });
}

function buildLabel(
	status: ReminderStatus,
	kmRemaining: number | undefined,
	daysRemaining: number | undefined
): string {
	if (kmRemaining === undefined && daysRemaining === undefined) {
		return m.reminder_no_due_date();
	}

	// Build the per-dimension fragments, then hand the joined value to a single wrapper template so
	// the surrounding words never glue around translated text (HU word order differs — the wrapper
	// places {value} natively). The " / " between dimensions is a neutral separator, not copy.
	if (status === 'overdue') {
		// Report whichever dimension(s) crossed zero, most-overdue first isn't needed —
		// just show each overdue dimension; if only one is overdue, show that one.
		const parts: string[] = [];
		if (kmRemaining !== undefined && kmRemaining <= 0) {
			parts.push(kmFragment(kmRemaining));
		}
		if (daysRemaining !== undefined && daysRemaining <= 0) {
			parts.push(daysFragment(daysRemaining));
		}
		return m.reminder_overdue_by({ value: parts.join(' / ') });
	}

	// ok or due-soon: show remaining across whichever dimensions are known.
	const parts: string[] = [];
	if (kmRemaining !== undefined) {
		parts.push(kmFragment(kmRemaining));
	}
	if (daysRemaining !== undefined) {
		parts.push(daysFragment(daysRemaining));
	}
	return m.reminder_due_in({ value: parts.join(' / ') });
}

/**
 * Select the reminders that need attention — `overdue` and `due-soon` only (never `ok`) —
 * ordered overdue-first then due-soon, preserving the input order within each group.
 * Deterministic without comparing across units (km vs days).
 */
export function selectDueReminders(
	reminders: ServiceReminder[],
	currentOdometer: number | undefined,
	today: Date,
	fuelLogs: FuelLog[] = []
): DueReminder[] {
	const overdue: DueReminder[] = [];
	const dueSoon: DueReminder[] = [];
	for (const reminder of reminders) {
		const status = computeReminderStatus(reminder, currentOdometer, today, fuelLogs);
		if (status.status === 'overdue') {
			overdue.push({ reminder, status });
		} else if (status.status === 'due-soon') {
			dueSoon.push({ reminder, status });
		}
	}
	return [...overdue, ...dueSoon];
}
