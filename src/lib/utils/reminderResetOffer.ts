// Story 4.6 (FR-12 loop-close / DEC-6): the match → offer → reset orchestration. Side-effecting
// (reads/writes repositories, raises a toast) so it lives apart from the PURE `reminderLoopClose.ts`
// helpers it composes. The root layout owns the wiring — it passes the shared `toast` channel and
// the real repos run over IndexedDB — but the logic lives here so it is testable with real repos
// over fake-indexeddb plus a spy toast, without rendering the whole shell.
//
// `toast` and `now` are injected (the layout passes the singleton + the real clock; tests pass a
// spy + a fixed date). The repositories are imported directly because the integration test drives
// the real ones over fake-indexeddb — exactly the boundary the story asks to exercise.

import {
	getServiceRemindersForVehicle,
	updateServiceReminder
} from '$lib/db/repositories/serviceReminders';
import { getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
import { computeReminderStatus, type ReminderStatus } from '$lib/utils/serviceReminder';
import {
	expenseMatchesReminder,
	resetMarkerPatch,
	currentOdometerFromLogs
} from '$lib/utils/reminderLoopClose';
import type { ToastApi } from '$lib/state/toast';
import type { Expense } from '$lib/db/schema';
import { m } from '$lib/paraglide/messages';

type OfferToast = Pick<ToastApi, 'action' | 'success' | 'error'>;

export interface OfferReminderResetOptions {
	/** Injectable clock for deterministic tests; defaults to the real clock. */
	now?: () => Date;
	/**
	 * Called after a confirmed reset COMMITS. The layout uses it to nudge the same-tab reactive
	 * `dataRevision` so the Home Up-Next card re-reads and re-derives the now-`ok` status immediately
	 * (AC5). The repo's `notifyDataChanged()` only reaches OTHER tabs — a BroadcastChannel never
	 * self-delivers — so the originating tab needs this local signal to recompute without navigating.
	 */
	onApplied?: () => void;
}

// Most-urgent-first ranking when several reminders match one expense (OQ-1): overdue → due-soon → ok.
const REMINDER_STATUS_PRIORITY: Record<ReminderStatus, number> = {
	overdue: 0,
	'due-soon': 1,
	ok: 2
};

/**
 * On an Expense CREATE save whose `type` token-matches a reminder `title`, OFFER (confirm, never
 * auto) to reset that reminder's last-service marker. No match → silent (the common path). If
 * several match, the single most-urgent is offered. Confirming writes the marker via
 * `updateServiceReminder` and signals `onApplied` so the surface recomputes the status to `ok`
 * immediately; declining (letting the toast expire) writes nothing.
 */
export async function offerReminderReset(
	expense: Expense,
	toast: OfferToast,
	options: OfferReminderResetOptions = {}
): Promise<void> {
	const now = options.now ?? (() => new Date());
	const remindersResult = await getServiceRemindersForVehicle(expense.vehicleId);
	if (remindersResult.error) return;
	const matches = remindersResult.data.filter((reminder) =>
		expenseMatchesReminder(expense.type, reminder.title)
	);
	if (matches.length === 0) return;

	// One-shot fuel read for the current odometer (max finite log odometer — NOT expense.odometer,
	// which is optional). Used to rank matches by urgency; the actual write re-derives it fresh below.
	const fuelResult = await getAllFuelLogs(expense.vehicleId);
	const currentOdometer = fuelResult.error ? undefined : currentOdometerFromLogs(fuelResult.data);

	// Array#sort is stable, so input order is preserved within a status tier.
	const today = now();
	const target = [...matches]
		.map((reminder) => ({
			reminder,
			status: computeReminderStatus(reminder, currentOdometer, today).status
		}))
		.sort(
			(a, b) => REMINDER_STATUS_PRIORITY[a.status] - REMINDER_STATUS_PRIORITY[b.status]
		)[0].reminder;

	// Re-entrancy guard (mirrors history/+page.svelte): a rapid double-tap can't fire two resets.
	// Cleared only on failure so a retry stays possible; on success the toast dismisses.
	let resetInFlight = false;
	toast.action(m.reset_offer({ title: target.title }), {
		label: m.reset_action_label(),
		onClick: () => {
			if (resetInFlight) return;
			resetInFlight = true;
			void applyReset();
		}
	});

	async function applyReset(): Promise<void> {
		// Re-derive the odometer at confirm time so a fuel log added during the toast window is
		// reflected. The patch is built from plain primitives only (a Dexie Date + a number) — never a
		// $state proxy or a reminder row — to respect the Dexie write boundary (Story 2.5/4.5).
		const logs = await getAllFuelLogs(expense.vehicleId);
		const odometer = logs.error ? undefined : currentOdometerFromLogs(logs.data);
		const result = await updateServiceReminder(target.id, resetMarkerPatch(expense.date, odometer));
		if (result.error) {
			toast.error(m.reset_error());
			resetInFlight = false;
			return;
		}
		// Same-tab nudge so the Home Up-Next card re-reads and recomputes to `ok` without navigating
		// (the cross-tab notifyDataChanged in the repo never reaches this tab).
		options.onApplied?.();
		toast.success(m.reset_success({ title: target.title }));
	}
}
