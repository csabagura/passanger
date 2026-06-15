// @vitest-environment node
import 'fake-indexeddb/auto'; // MUST be first import — patches global IndexedDB
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import {
	saveServiceReminder,
	getServiceReminderById,
	getServiceRemindersForVehicle,
	updateServiceReminder,
	deleteServiceReminder
} from './serviceReminders';

beforeEach(async () => {
	await db.delete();
	await db.open();
});

describe('ServiceReminderRepository', () => {
	describe('saveServiceReminder — validation', () => {
		it('rejects empty title', async () => {
			const result = await saveServiceReminder({ vehicleId: 1, title: '', intervalKm: 10000 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects whitespace-only title', async () => {
			const result = await saveServiceReminder({ vehicleId: 1, title: '   ', intervalKm: 10000 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects a non-positive vehicleId', async () => {
			const result = await saveServiceReminder({ vehicleId: 0, title: 'Oil', intervalKm: 10000 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects a reminder with no interval at all', async () => {
			const result = await saveServiceReminder({ vehicleId: 1, title: 'Oil' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects a non-positive distance interval', async () => {
			const result = await saveServiceReminder({ vehicleId: 1, title: 'Oil', intervalKm: 0 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects a non-finite distance interval', async () => {
			const result = await saveServiceReminder({
				vehicleId: 1,
				title: 'Oil',
				intervalKm: Number.POSITIVE_INFINITY
			});
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects a non-positive time interval', async () => {
			const result = await saveServiceReminder({ vehicleId: 1, title: 'Oil', intervalDays: -5 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects a non-positive lastServiceOdometer', async () => {
			const result = await saveServiceReminder({
				vehicleId: 1,
				title: 'Oil',
				intervalKm: 10000,
				lastServiceOdometer: 0
			});
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects an invalid lastServiceDate', async () => {
			const result = await saveServiceReminder({
				vehicleId: 1,
				title: 'Oil',
				intervalDays: 365,
				lastServiceDate: new Date('not-a-date')
			});
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});
	});

	describe('saveServiceReminder', () => {
		it('saves a km-only reminder and returns it with a generated id', async () => {
			const result = await saveServiceReminder({
				vehicleId: 1,
				title: 'Oil change',
				intervalKm: 10000
			});
			expect(result.error).toBeNull();
			expect(typeof result.data?.id).toBe('number');
			expect(result.data?.title).toBe('Oil change');
			expect(result.data?.intervalKm).toBe(10000);
		});

		it('saves a days-only reminder', async () => {
			const result = await saveServiceReminder({
				vehicleId: 1,
				title: 'Insurance',
				intervalDays: 365
			});
			expect(result.error).toBeNull();
			expect(result.data?.intervalDays).toBe(365);
			expect(result.data?.intervalKm).toBeUndefined();
		});

		it('saves a reminder with both intervals plus baselines and notes', async () => {
			const lastServiceDate = new Date(2025, 0, 10);
			const result = await saveServiceReminder({
				vehicleId: 2,
				title: 'Timing belt',
				intervalKm: 100000,
				intervalDays: 1825,
				lastServiceOdometer: 80000,
				lastServiceDate,
				notes: 'Big job'
			});
			expect(result.error).toBeNull();
			expect(result.data?.intervalKm).toBe(100000);
			expect(result.data?.intervalDays).toBe(1825);
			expect(result.data?.lastServiceOdometer).toBe(80000);
			expect(result.data?.lastServiceDate?.getTime()).toBe(lastServiceDate.getTime());
			expect(result.data?.notes).toBe('Big job');
		});
	});

	describe('getServiceReminderById', () => {
		it('returns the reminder when found', async () => {
			const saved = await saveServiceReminder({ vehicleId: 1, title: 'Oil', intervalKm: 10000 });
			const result = await getServiceReminderById(saved.data!.id);
			expect(result.error).toBeNull();
			expect(result.data?.id).toBe(saved.data!.id);
		});

		it('returns NOT_FOUND when id does not exist', async () => {
			const result = await getServiceReminderById(999);
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});
	});

	describe('getServiceRemindersForVehicle', () => {
		it('returns empty array when none exist for the vehicle', async () => {
			const result = await getServiceRemindersForVehicle(1);
			expect(result.error).toBeNull();
			expect(result.data).toEqual([]);
		});

		it('returns only reminders belonging to the given vehicle', async () => {
			await saveServiceReminder({ vehicleId: 1, title: 'Oil', intervalKm: 10000 });
			await saveServiceReminder({ vehicleId: 1, title: 'Tyres', intervalKm: 40000 });
			await saveServiceReminder({ vehicleId: 2, title: 'Insurance', intervalDays: 365 });
			const result = await getServiceRemindersForVehicle(1);
			expect(result.error).toBeNull();
			expect(result.data).toHaveLength(2);
			expect(result.data?.every((r) => r.vehicleId === 1)).toBe(true);
		});
	});

	describe('updateServiceReminder — validation', () => {
		it('rejects empty title in changes', async () => {
			const saved = await saveServiceReminder({ vehicleId: 1, title: 'Oil', intervalKm: 10000 });
			const result = await updateServiceReminder(saved.data!.id, { title: '' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects a non-positive interval in changes', async () => {
			const saved = await saveServiceReminder({ vehicleId: 1, title: 'Oil', intervalKm: 10000 });
			const result = await updateServiceReminder(saved.data!.id, { intervalKm: -1 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('returns NOT_FOUND when id does not exist', async () => {
			const result = await updateServiceReminder(999, { title: 'Ghost' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});
	});

	describe('updateServiceReminder', () => {
		it('persists a title change while preserving other fields', async () => {
			const saved = await saveServiceReminder({
				vehicleId: 1,
				title: 'Oil',
				intervalKm: 10000
			});
			const updated = await updateServiceReminder(saved.data!.id, { title: 'Oil + filter' });
			expect(updated.error).toBeNull();
			expect(updated.data?.title).toBe('Oil + filter');
			expect(updated.data?.intervalKm).toBe(10000);
		});

		it('updates the last-service baselines', async () => {
			const saved = await saveServiceReminder({
				vehicleId: 1,
				title: 'Oil',
				intervalKm: 10000
			});
			const lastServiceDate = new Date(2026, 2, 1);
			const updated = await updateServiceReminder(saved.data!.id, {
				lastServiceOdometer: 62000,
				lastServiceDate
			});
			expect(updated.error).toBeNull();
			expect(updated.data?.lastServiceOdometer).toBe(62000);
			expect(updated.data?.lastServiceDate?.getTime()).toBe(lastServiceDate.getTime());
		});
	});

	describe('deleteServiceReminder', () => {
		it('removes the record so a subsequent get returns NOT_FOUND', async () => {
			const saved = await saveServiceReminder({
				vehicleId: 1,
				title: 'Oil',
				intervalKm: 10000
			});
			const deleteResult = await deleteServiceReminder(saved.data!.id);
			expect(deleteResult.error).toBeNull();
			const fetched = await getServiceReminderById(saved.data!.id);
			expect(fetched.error?.code).toBe('NOT_FOUND');
		});

		it('returns ok for a non-existent id (Dexie delete is idempotent)', async () => {
			const result = await deleteServiceReminder(999);
			expect(result.error).toBeNull();
		});
	});
});
