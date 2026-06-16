// @vitest-environment node
import 'fake-indexeddb/auto'; // MUST be first import — patches global IndexedDB
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from './db';
import { exportAllTables, restoreAllTables, type BackupData } from './backup';
import type { Vehicle, FuelLog, Expense, ServiceReminder } from './schema';

const quotaError = new DOMException('The quota has been exceeded.', 'QuotaExceededError');

const vehicles: Vehicle[] = [
	{ id: 1, name: 'Car', make: 'Honda', model: 'Civic', year: 2018 },
	{ id: 2, name: 'Van', make: 'Ford', model: 'Transit' }
];

const fuelLogs: FuelLog[] = [
	{
		id: 10,
		vehicleId: 1,
		date: new Date('2026-01-02T08:00:00.000Z'),
		odometer: 1000,
		quantity: 40,
		unit: 'L',
		distanceUnit: 'km',
		totalCost: 80,
		currency: '€',
		calculatedConsumption: 6.5,
		notes: 'first fill'
	}
];

const expenses: Expense[] = [
	{
		id: 20,
		vehicleId: 1,
		date: new Date('2026-01-03T09:00:00.000Z'),
		type: 'Oil Change',
		odometer: 1100,
		cost: 50,
		currency: '€'
	}
];

const serviceReminders: ServiceReminder[] = [
	{
		id: 30,
		vehicleId: 1,
		title: 'Oil change',
		intervalKm: 10000,
		lastServiceOdometer: 1000,
		lastServiceDate: new Date('2026-01-02T08:00:00.000Z')
	}
];

function fullBackup(): BackupData {
	return {
		vehicles: structuredClone(vehicles),
		fuelLogs: structuredClone(fuelLogs),
		expenses: structuredClone(expenses),
		serviceReminders: structuredClone(serviceReminders)
	};
}

beforeEach(async () => {
	await db.delete();
	await db.open();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('exportAllTables', () => {
	it('reads every table in full', async () => {
		await db.vehicles.bulkPut(vehicles);
		await db.fuelLogs.bulkPut(fuelLogs);
		await db.expenses.bulkPut(expenses);
		await db.serviceReminders.bulkPut(serviceReminders);

		const result = await exportAllTables();
		expect(result.error).toBeNull();
		expect(result.data?.vehicles).toHaveLength(2);
		expect(result.data?.fuelLogs).toHaveLength(1);
		expect(result.data?.expenses).toHaveLength(1);
		expect(result.data?.serviceReminders).toHaveLength(1);
		// Date objects survive a toArray read.
		expect(result.data?.fuelLogs[0].date).toBeInstanceOf(Date);
	});

	it('returns empty arrays when the DB is empty', async () => {
		const result = await exportAllTables();
		expect(result.error).toBeNull();
		expect(result.data).toEqual({
			vehicles: [],
			fuelLogs: [],
			expenses: [],
			serviceReminders: []
		});
	});

	it('maps a read failure to GET_FAILED', async () => {
		vi.spyOn(db.vehicles, 'toArray').mockRejectedValueOnce(new Error('read fault'));
		const result = await exportAllTables();
		expect(result.error?.code).toBe('GET_FAILED');
	});
});

describe('restoreAllTables', () => {
	it('clears existing rows then inserts the backup, preserving ids and FKs', async () => {
		// Pre-existing data that must be wiped — note an id that is NOT in the backup.
		await db.vehicles.bulkPut([{ id: 99, name: 'Old', make: 'Old', model: 'Old' }]);
		await db.fuelLogs.bulkPut([
			{
				id: 999,
				vehicleId: 99,
				date: new Date('2020-01-01T00:00:00.000Z'),
				odometer: 1,
				quantity: 1,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 1,
				calculatedConsumption: 0
			}
		]);

		const result = await restoreAllTables(fullBackup());
		expect(result.error).toBeNull();
		expect(result.data).toEqual({
			vehicles: 2,
			fuelLogs: 1,
			expenses: 1,
			serviceReminders: 1
		});

		// Old rows gone.
		expect(await db.vehicles.get(99)).toBeUndefined();
		expect(await db.fuelLogs.get(999)).toBeUndefined();

		// Inbound ids preserved exactly.
		const allVehicles = await db.vehicles.toArray();
		expect(allVehicles.map((v) => v.id).sort((a, b) => a - b)).toEqual([1, 2]);
		const restoredLog = await db.fuelLogs.get(10);
		expect(restoredLog?.vehicleId).toBe(1); // FK intact
		expect(restoredLog?.currency).toBe('€');
		const restoredReminder = await db.serviceReminders.get(30);
		expect(restoredReminder?.vehicleId).toBe(1);
	});

	it('restores into an empty DB without error', async () => {
		const result = await restoreAllTables(fullBackup());
		expect(result.error).toBeNull();
		expect(await db.vehicles.count()).toBe(2);
	});

	it('rolls back atomically when a write fails partway — no partial dataset', async () => {
		// Seed an existing dataset that must remain intact after a failed restore.
		await db.vehicles.bulkPut([{ id: 7, name: 'Keep', make: 'Keep', model: 'Keep' }]);
		await db.expenses.bulkPut([
			{ id: 8, vehicleId: 7, date: new Date('2025-05-05T00:00:00.000Z'), type: 'Toll', cost: 3 }
		]);

		// Fail on the LAST table's write so earlier clears/puts are also rolled back.
		const spy = vi
			.spyOn(db.serviceReminders, 'bulkPut')
			.mockRejectedValueOnce(new Error('mid-restore boom'));

		const result = await restoreAllTables(fullBackup());
		expect(result.error?.code).toBe('SAVE_FAILED');
		expect(spy).toHaveBeenCalled();

		// Everything rolled back to the original seeded state — restore wrote nothing.
		expect(await db.vehicles.toArray()).toEqual([
			{ id: 7, name: 'Keep', make: 'Keep', model: 'Keep' }
		]);
		expect(await db.fuelLogs.count()).toBe(0);
		expect(await db.expenses.count()).toBe(1);
		expect(await db.serviceReminders.count()).toBe(0);
	});

	it('maps a storage-quota failure to QUOTA_EXCEEDED', async () => {
		vi.spyOn(db.fuelLogs, 'bulkPut').mockRejectedValueOnce(quotaError);
		const result = await restoreAllTables(fullBackup());
		expect(result.error?.code).toBe('QUOTA_EXCEEDED');
	});

	it('maps a non-quota failure to SAVE_FAILED', async () => {
		vi.spyOn(db.fuelLogs, 'bulkPut').mockRejectedValueOnce(new Error('disk on fire'));
		const result = await restoreAllTables(fullBackup());
		expect(result.error?.code).toBe('SAVE_FAILED');
	});
});
