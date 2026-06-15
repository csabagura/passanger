import { db } from '../db';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { ServiceReminder, NewServiceReminder } from '../schema';
import { isQuotaExceededError, QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE } from '../dbErrors';

function isPositiveFinite(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validateNewServiceReminder(reminder: NewServiceReminder): string | null {
	if (!Number.isInteger(reminder.vehicleId) || reminder.vehicleId <= 0)
		return 'vehicleId must be a positive integer';
	if (!reminder.title || reminder.title.trim() === '') return 'Reminder title is required';

	const hasKm = reminder.intervalKm !== undefined;
	const hasDays = reminder.intervalDays !== undefined;
	if (!hasKm && !hasDays) return 'At least one interval (distance or time) is required';
	if (hasKm && !isPositiveFinite(reminder.intervalKm))
		return 'Distance interval must be a positive finite number';
	if (hasDays && !isPositiveFinite(reminder.intervalDays))
		return 'Time interval must be a positive finite number';

	if (reminder.lastServiceOdometer !== undefined && !isPositiveFinite(reminder.lastServiceOdometer))
		return 'Last service odometer must be a positive finite number';
	if (
		reminder.lastServiceDate !== undefined &&
		(!(reminder.lastServiceDate instanceof Date) ||
			Number.isNaN(reminder.lastServiceDate.getTime()))
	)
		return 'Last service date must be a valid Date';

	return null;
}

function validatePartialServiceReminder(changes: Partial<NewServiceReminder>): string | null {
	if (
		'vehicleId' in changes &&
		(!Number.isInteger(changes.vehicleId) || (changes.vehicleId as number) <= 0)
	)
		return 'vehicleId must be a positive integer';
	if ('title' in changes && (!changes.title || changes.title.trim() === ''))
		return 'Reminder title cannot be empty';

	// Treat an explicit `undefined` as "clearing" the interval; only a present value is validated.
	if (
		'intervalKm' in changes &&
		changes.intervalKm !== undefined &&
		!isPositiveFinite(changes.intervalKm)
	)
		return 'Distance interval must be a positive finite number';
	if (
		'intervalDays' in changes &&
		changes.intervalDays !== undefined &&
		!isPositiveFinite(changes.intervalDays)
	)
		return 'Time interval must be a positive finite number';

	if (
		'lastServiceOdometer' in changes &&
		changes.lastServiceOdometer !== undefined &&
		!isPositiveFinite(changes.lastServiceOdometer)
	)
		return 'Last service odometer must be a positive finite number';
	if (
		'lastServiceDate' in changes &&
		changes.lastServiceDate !== undefined &&
		(!(changes.lastServiceDate instanceof Date) ||
			Number.isNaN((changes.lastServiceDate as Date).getTime()))
	)
		return 'Last service date must be a valid Date';

	return null;
}

export class ServiceReminderRepository {
	async saveServiceReminder(reminder: NewServiceReminder): Promise<Result<ServiceReminder>> {
		const validationError = validateNewServiceReminder(reminder);
		if (validationError) return err('VALIDATION_ERROR', validationError);
		try {
			const id = await db.serviceReminders.add({ ...reminder } as ServiceReminder);
			const saved = await db.serviceReminders.get(id as number);
			if (!saved) return err('SAVE_FAILED', 'Record not found after insert');
			return ok(saved);
		} catch (e) {
			if (isQuotaExceededError(e)) return err(QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE);
			return err('SAVE_FAILED', String(e));
		}
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
		const validationError = validatePartialServiceReminder(changes);
		if (validationError) return err('VALIDATION_ERROR', validationError);
		try {
			const count = await db.serviceReminders.update(id, changes);
			if (count === 0) return err('NOT_FOUND', `ServiceReminder ${id} not found`);
			const updated = await db.serviceReminders.get(id);
			if (!updated) return err('UPDATE_FAILED', 'Record not found after update');
			return ok(updated);
		} catch (e) {
			if (isQuotaExceededError(e)) return err(QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE);
			return err('UPDATE_FAILED', String(e));
		}
	}

	async deleteServiceReminder(id: number): Promise<Result<void>> {
		try {
			await db.serviceReminders.delete(id);
			return ok(undefined);
		} catch (e) {
			return err('DELETE_FAILED', String(e));
		}
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
