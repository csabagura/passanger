import 'fake-indexeddb/auto'; // MUST be first — patches global IndexedDB before db.ts opens
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '$lib/db/db';
import { saveExpense } from '$lib/db/repositories/expenses';
import { saveFuelLog } from '$lib/db/repositories/fuelLogs';
import { saveServiceReminder, getServiceReminderById } from '$lib/db/repositories/serviceReminders';
import { computeReminderStatus } from '$lib/utils/serviceReminder';
import { offerReminderReset } from './reminderResetOffer';
import type { Expense, NewFuelLog } from '$lib/db/schema';

// Story 4.6 (FR-12 loop-close / DEC-6): the match → offer → reset flow, driven over real repos on
// fake-indexeddb with a spy toast. Asserts the offer fires only on a token match, that confirming
// writes the marker and the status recomputes to `ok`, and that declining changes nothing.

const VEHICLE_ID = 1;
const FIXED_TODAY = new Date(2026, 5, 24); // 2026-06-24

function spyToast() {
	return {
		action: vi.fn<(message: string, opts: { label: string; onClick: () => void }) => void>(),
		success: vi.fn<(message: string) => void>(),
		error: vi.fn<(message: string) => void>()
	};
}

function fuelLog(odometer: number): NewFuelLog {
	return {
		vehicleId: VEHICLE_ID,
		date: new Date(2026, 5, 1),
		odometer,
		quantity: 40,
		unit: 'L',
		distanceUnit: 'km',
		totalCost: 60,
		currency: '€',
		calculatedConsumption: 0
	};
}

// A reminder that is currently OVERDUE on distance: lastServiceOdometer 40000 + intervalKm 10000 =
// due at 50000, but the latest fuel odometer is 60000 → kmRemaining -10000.
async function seedOverdueOilReminder() {
	const result = await saveServiceReminder({
		vehicleId: VEHICLE_ID,
		title: 'Oil change',
		intervalKm: 10000,
		lastServiceOdometer: 40000
	});
	if (result.error) throw new Error(result.error.message);
	return result.data;
}

async function saveMatchingExpense(type = 'Oil change'): Promise<Expense> {
	const result = await saveExpense({
		vehicleId: VEHICLE_ID,
		date: FIXED_TODAY,
		type,
		cost: 78,
		currency: '€',
		notes: ''
	});
	if (result.error) throw new Error(result.error.message);
	return result.data;
}

beforeEach(async () => {
	await db.delete();
	await db.open();
});

describe('offerReminderReset — match → offer → reset (FR-12 / DEC-6)', () => {
	it('raises a confirm-never-auto toast for a token-matching expense, naming the reminder', async () => {
		await seedOverdueOilReminder();
		await saveFuelLog(fuelLog(60000));
		const expense = await saveMatchingExpense('Oil change');
		const toast = spyToast();

		await offerReminderReset(expense, toast, { now: () => FIXED_TODAY });

		expect(toast.action).toHaveBeenCalledTimes(1);
		const [message, opts] = toast.action.mock.calls[0];
		expect(message).toBe('Logged. Reset the Oil change reminder?');
		expect(opts.label).toBe('Reset');
		// Nothing is mutated by merely raising the offer (DEC-6 confirm-never-auto).
		expect(toast.success).not.toHaveBeenCalled();
	});

	it('matches case-insensitively on a shared token', async () => {
		const reminder = await seedOverdueOilReminder();
		await saveFuelLog(fuelLog(60000));
		// "OIL filter" shares the "oil" token with "Oil change".
		const expense = await saveMatchingExpense('OIL filter');
		const toast = spyToast();

		await offerReminderReset(expense, toast, { now: () => FIXED_TODAY });

		expect(toast.action).toHaveBeenCalledTimes(1);
		expect(toast.action.mock.calls[0][0]).toContain(reminder.title);
	});

	it('confirming writes the marker and the status recomputes to ok', async () => {
		const reminder = await seedOverdueOilReminder();
		await saveFuelLog(fuelLog(60000));
		const expense = await saveMatchingExpense('Oil change');
		const toast = spyToast();

		// Pre-condition: overdue before the reset.
		const before = await getServiceReminderById(reminder.id);
		expect(before.error).toBeNull();
		expect(computeReminderStatus(before.data!, 60000, FIXED_TODAY).status).toBe('overdue');

		await offerReminderReset(expense, toast, { now: () => FIXED_TODAY });
		// Confirm: invoke the action onClick the toast captured.
		toast.action.mock.calls[0][1].onClick();

		await vi.waitFor(async () => {
			const after = await getServiceReminderById(reminder.id);
			expect(after.error).toBeNull();
			expect(after.data!.lastServiceOdometer).toBe(60000);
			expect(after.data!.lastServiceDate).toEqual(expense.date);
			// lastServiceOdometer 60000 + intervalKm 10000 = due at 70000, current 60000 → 10000 ahead.
			expect(computeReminderStatus(after.data!, 60000, FIXED_TODAY).status).toBe('ok');
		});
		expect(toast.success).toHaveBeenCalledTimes(1);
	});

	it('signals onApplied after a confirmed reset commits (same-tab Up-Next refresh nudge, AC5)', async () => {
		await seedOverdueOilReminder();
		await saveFuelLog(fuelLog(60000));
		const expense = await saveMatchingExpense('Oil change');
		const toast = spyToast();
		const onApplied = vi.fn();

		await offerReminderReset(expense, toast, { now: () => FIXED_TODAY, onApplied });
		// Not called merely by raising the offer.
		expect(onApplied).not.toHaveBeenCalled();

		toast.action.mock.calls[0][1].onClick();
		await vi.waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
	});

	it('does NOT signal onApplied when the reset write fails', async () => {
		const reminder = await seedOverdueOilReminder();
		await saveFuelLog(fuelLog(60000));
		const expense = await saveMatchingExpense('Oil change');
		const toast = spyToast();
		const onApplied = vi.fn();

		await offerReminderReset(expense, toast, { now: () => FIXED_TODAY, onApplied });
		await db.serviceReminders.delete(reminder.id); // → NOT_FOUND on confirm
		toast.action.mock.calls[0][1].onClick();

		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		expect(onApplied).not.toHaveBeenCalled();
	});

	it('does NOT raise an offer for a non-matching expense (silent common path)', async () => {
		await seedOverdueOilReminder();
		await saveFuelLog(fuelLog(60000));
		const expense = await saveMatchingExpense('Insurance');
		const toast = spyToast();

		await offerReminderReset(expense, toast, { now: () => FIXED_TODAY });

		expect(toast.action).not.toHaveBeenCalled();
	});

	it('declining (never invoking onClick) leaves the reminder unchanged', async () => {
		const reminder = await seedOverdueOilReminder();
		await saveFuelLog(fuelLog(60000));
		const expense = await saveMatchingExpense('Oil change');
		const toast = spyToast();

		await offerReminderReset(expense, toast, { now: () => FIXED_TODAY });
		// User ignores the toast — onClick is never invoked.

		const after = await getServiceReminderById(reminder.id);
		expect(after.data!.lastServiceOdometer).toBe(40000);
		expect(after.data!.lastServiceDate).toBeUndefined();
		expect(toast.success).not.toHaveBeenCalled();
	});

	it('offers the single most-urgent reminder when several match (OQ-1)', async () => {
		// An on-track reminder (sharing the "service" token) and an overdue one (sharing "service").
		await saveServiceReminder({
			vehicleId: VEHICLE_ID,
			title: 'Air filter service',
			intervalKm: 100000,
			lastServiceOdometer: 59000 // due at 159000 — far ahead → ok
		});
		await saveServiceReminder({
			vehicleId: VEHICLE_ID,
			title: 'Brake service',
			intervalKm: 1000,
			lastServiceOdometer: 40000 // due at 41000, current 60000 → overdue
		});
		await saveFuelLog(fuelLog(60000));
		const expense = await saveMatchingExpense('General service');
		const toast = spyToast();

		await offerReminderReset(expense, toast, { now: () => FIXED_TODAY });

		expect(toast.action).toHaveBeenCalledTimes(1);
		expect(toast.action.mock.calls[0][0]).toBe('Logged. Reset the Brake service reminder?');
	});

	it('a date-only reset (no usable fuel odometer) still writes lastServiceDate', async () => {
		// A time-based reminder, no fuel logs → currentOdometer undefined → patch is date-only.
		const result = await saveServiceReminder({
			vehicleId: VEHICLE_ID,
			title: 'Oil change',
			intervalDays: 180,
			lastServiceDate: new Date(2025, 0, 1) // long ago → overdue
		});
		if (result.error) throw new Error(result.error.message);
		const expense = await saveMatchingExpense('Oil change');
		const toast = spyToast();

		await offerReminderReset(expense, toast, { now: () => FIXED_TODAY });
		toast.action.mock.calls[0][1].onClick();

		await vi.waitFor(async () => {
			const after = await getServiceReminderById(result.data.id);
			expect(after.data!.lastServiceDate).toEqual(expense.date);
			expect(after.data!.lastServiceOdometer).toBeUndefined();
			expect(computeReminderStatus(after.data!, undefined, FIXED_TODAY).status).toBe('ok');
		});
	});

	it('surfaces an error toast (not success) when the reminder write fails', async () => {
		const reminder = await seedOverdueOilReminder();
		await saveFuelLog(fuelLog(60000));
		const expense = await saveMatchingExpense('Oil change');
		const toast = spyToast();

		await offerReminderReset(expense, toast, { now: () => FIXED_TODAY });
		// Delete the reminder before confirming → updateServiceReminder returns NOT_FOUND.
		await db.serviceReminders.delete(reminder.id);
		toast.action.mock.calls[0][1].onClick();

		await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		expect(toast.success).not.toHaveBeenCalled();
	});
});
