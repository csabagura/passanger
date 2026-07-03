import { db } from '../db';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { ServiceReminder, NewServiceReminder } from '../schema';
import {
	validateNewServiceReminder,
	validatePartialServiceReminder,
	hasAtLeastOneInterval
} from '../validators/rowValidation';
import { runWrite, encodeSentinel } from '../writeSkeleton';
import { clearDismissal } from '$lib/utils/reminderDismissal';

// Story 8.5 / AD-RT-4: editing any of a reminder's schedule-bearing fields invalidates a stale
// localStorage dismissal marker — it was recorded against the OLD due instance, and can no longer
// be trusted to represent what the user actually dismissed.
const SCHEDULE_FIELDS = [
	'intervalKm',
	'intervalDays',
	'lastServiceOdometer',
	'lastServiceDate'
] as const;

function touchesSchedule(changes: Partial<NewServiceReminder>): boolean {
	return SCHEDULE_FIELDS.some((field) => field in changes);
}

export class ServiceReminderRepository {
	async saveServiceReminder(reminder: NewServiceReminder): Promise<Result<ServiceReminder>> {
		return runWrite(
			() => validateNewServiceReminder(reminder),
			async () => {
				const id = await db.serviceReminders.add({ ...reminder } as ServiceReminder);
				const saved = await db.serviceReminders.get(id as number);
				if (!saved) throw encodeSentinel('SAVE_FAILED', 'Record not found after insert');
				return saved;
			},
			'SAVE_FAILED'
		);
	}

	async getServiceReminderById(id: number): Promise<Result<ServiceReminder>> {
		try {
			const reminder = await db.serviceReminders.get(id);
			if (!reminder) return err('NOT_FOUND', `ServiceReminder ${id} not found`);
			return ok(reminder);
		} catch (e) {
			return err('GET_FAILED', String(e));
		}
	}

	async getServiceRemindersForVehicle(vehicleId: number): Promise<Result<ServiceReminder[]>> {
		try {
			const reminders = await db.serviceReminders.where('vehicleId').equals(vehicleId).toArray();
			return ok(reminders);
		} catch (e) {
			return err('GET_FAILED', String(e));
		}
	}

	async updateServiceReminder(
		id: number,
		changes: Partial<NewServiceReminder>
	): Promise<Result<ServiceReminder>> {
		const result = await runWrite(
			() => validatePartialServiceReminder(changes),
			() =>
				db.transaction('rw', db.serviceReminders, async () => {
					const existing = await db.serviceReminders.get(id);
					if (!existing) throw encodeSentinel('NOT_FOUND', `ServiceReminder ${id} not found`);

					// S13 / ADR-006 AD-WB-6: reject a change that would leave the reminder with no
					// interval. This is a cross-field invariant over the RESULTING record, so it
					// needs the existing row — object spread correctly applies an explicit `undefined`
					// in `changes` (clearing the key) when merging.
					const merged = { ...existing, ...changes };
					if (!hasAtLeastOneInterval(merged)) {
						throw encodeSentinel(
							'VALIDATION_ERROR',
							'At least one interval (distance or time) is required'
						);
					}

					const count = await db.serviceReminders.update(id, changes);
					if (count === 0) throw encodeSentinel('NOT_FOUND', `ServiceReminder ${id} not found`);
					const updated = await db.serviceReminders.get(id);
					if (!updated) throw encodeSentinel('UPDATE_FAILED', 'Record not found after update');
					return updated;
				}),
			'UPDATE_FAILED'
		);
		// Story 8.5 / AD-RT-4: a stale dismissal marker cannot survive a schedule edit — clear it
		// AFTER the write commits (never on a failed/rejected write).
		if (!result.error && touchesSchedule(changes)) {
			clearDismissal(id);
		}
		return result;
	}

	async deleteServiceReminder(id: number): Promise<Result<void>> {
		return runWrite(
			() => null,
			() =>
				db.transaction('rw', db.serviceReminders, async () => {
					const existing = await db.serviceReminders.get(id);
					if (!existing) throw encodeSentinel('NOT_FOUND', `ServiceReminder ${id} not found`);
					await db.serviceReminders.delete(id);
				}),
			'DELETE_FAILED'
		);
	}
}

export const serviceReminderRepository = new ServiceReminderRepository();

// Convenience function exports — delegate to repository instance.
export const saveServiceReminder = (reminder: NewServiceReminder) =>
	serviceReminderRepository.saveServiceReminder(reminder);
export const getServiceReminderById = (id: number) =>
	serviceReminderRepository.getServiceReminderById(id);
export const getServiceRemindersForVehicle = (vehicleId: number) =>
	serviceReminderRepository.getServiceRemindersForVehicle(vehicleId);
export const updateServiceReminder = (id: number, changes: Partial<NewServiceReminder>) =>
	serviceReminderRepository.updateServiceReminder(id, changes);
export const deleteServiceReminder = (id: number) =>
	serviceReminderRepository.deleteServiceReminder(id);
