// @vitest-environment node
import 'fake-indexeddb/auto'; // MUST be first import — patches global IndexedDB
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from './db';
import { exportVehicleTables, importVehicleShare } from './vehicleShare';
import type { VehicleShareData } from '$lib/utils/vehicleShare';
import type { Vehicle, FuelLog, Expense } from './schema';
import { MAX_VEHICLES } from '$lib/config';

async function clearDb() {
	await db.vehicles.clear();
	await db.fuelLogs.clear();
	await db.expenses.clear();
	await db.serviceReminders.clear();
}

beforeEach(clearDb);
afterEach(clearDb);

function makeShareData(overrides: Partial<VehicleShareData> = {}): VehicleShareData {
	return {
		vehicle: { id: 7, name: 'My Civic', make: 'Honda', model: 'Civic', year: 2018 },
		fuelLogs: [
			{
				id: 10,
				vehicleId: 7,
				date: new Date('2026-01-02T08:00:00.000Z'),
				odometer: 1000,
				quantity: 40,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 80,
				currency: '€',
				calculatedConsumption: 6.5
			}
		],
		expenses: [
			{
				id: 20,
				vehicleId: 7,
				date: new Date('2026-01-03T09:00:00.000Z'),
				type: 'Oil Change',
				odometer: 1100,
				cost: 50,
				currency: '€'
			}
		],
		serviceReminders: [
			{
				id: 30,
				vehicleId: 7,
				title: 'Oil change',
				intervalKm: 10000,
				lastServiceOdometer: 1000,
				lastClosedByExpenseId: 20 // ← points at expense id 20 in THIS payload
			}
		],
		...overrides
	};
}

describe('exportVehicleTables', () => {
	it('reads exactly one vehicle plus only ITS owned rows', async () => {
		const v1 = (await db.vehicles.add({
			name: 'A',
			make: 'Honda',
			model: 'Civic'
		} as Vehicle)) as number;
		const v2 = (await db.vehicles.add({
			name: 'B',
			make: 'Ford',
			model: 'Focus'
		} as Vehicle)) as number;
		await db.fuelLogs.add({
			vehicleId: v1,
			date: new Date('2026-01-02'),
			odometer: 1000,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 80,
			calculatedConsumption: 6
		} as FuelLog);
		await db.fuelLogs.add({
			vehicleId: v2,
			date: new Date('2026-01-02'),
			odometer: 500,
			quantity: 20,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 40,
			calculatedConsumption: 5
		} as FuelLog);

		const result = await exportVehicleTables(v1);
		expect(result.error).toBeNull();
		expect(result.data?.vehicle.id).toBe(v1);
		expect(result.data?.fuelLogs).toHaveLength(1);
		expect(result.data?.fuelLogs[0].vehicleId).toBe(v1);
	});

	it('returns NOT_FOUND for a missing vehicle', async () => {
		const result = await exportVehicleTables(999);
		expect(result.error?.code).toBe('NOT_FOUND');
	});

	it('blocks export when a row fails validation (corrupt data never ships)', async () => {
		const v1 = (await db.vehicles.add({
			name: 'A',
			make: 'Honda',
			model: 'Civic'
		} as Vehicle)) as number;
		// A negative quantity fails validateNewFuelLog.
		await db.fuelLogs.add({
			vehicleId: v1,
			date: new Date('2026-01-02'),
			odometer: 1000,
			quantity: -5,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 80,
			calculatedConsumption: 6
		} as FuelLog);

		const result = await exportVehicleTables(v1);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toMatch(/Export blocked/);
	});
});

describe('importVehicleShare — remap write', () => {
	it('creates a NEW vehicle with a fresh id and remaps all child vehicleId FKs', async () => {
		// Seed an existing vehicle so the imported one cannot accidentally reuse id 7 from the payload.
		const existing = (await db.vehicles.add({
			name: 'Existing',
			make: 'Ford',
			model: 'Focus'
		} as Vehicle)) as number;

		const result = await importVehicleShare(makeShareData());
		expect(result.error).toBeNull();
		const newId = result.data!.vehicleId;
		expect(newId).not.toBe(7); // regenerated, not the payload's id
		expect(newId).not.toBe(existing);

		const fuel = await db.fuelLogs.toArray();
		const expenses = await db.expenses.toArray();
		expect(fuel).toHaveLength(1);
		expect(fuel[0].vehicleId).toBe(newId);
		expect(fuel[0].id).not.toBe(10); // primary key regenerated
		expect(expenses[0].vehicleId).toBe(newId);
	});

	// THE CRUX (AC3) — red-green lock on lastClosedByExpenseId remapping.
	it('remaps ServiceReminder.lastClosedByExpenseId through the NEW expense ids', async () => {
		// Seed rows so the new expense id is guaranteed NOT to equal the payload's expense id (20).
		await db.expenses.add({
			vehicleId: 999,
			date: new Date('2026-01-01'),
			type: 'Seed',
			cost: 1
		} as Expense);

		const result = await importVehicleShare(makeShareData());
		expect(result.error).toBeNull();

		const reminders = await db.serviceReminders.toArray();
		const importedExpense = (await db.expenses.toArray()).find((e) => e.type === 'Oil Change')!;

		expect(importedExpense.id).not.toBe(20); // the expense got a new id
		expect(reminders[0].lastClosedByExpenseId).toBe(importedExpense.id); // remapped to it
		expect(reminders[0].lastClosedByExpenseId).not.toBe(20); // NOT the stale payload id
	});

	it('drops lastClosedByExpenseId when it cannot be mapped to an imported expense', async () => {
		const data = makeShareData();
		// Reminder references an expense id NOT present in the payload's expenses.
		data.serviceReminders[0].lastClosedByExpenseId = 4242;
		const result = await importVehicleShare(data);
		expect(result.error).toBeNull();

		const reminders = await db.serviceReminders.toArray();
		expect(reminders[0].lastClosedByExpenseId).toBeUndefined();
	});

	it('enforces MAX_VEHICLES via the in-transaction active-vehicle count', async () => {
		for (let i = 0; i < MAX_VEHICLES; i++) {
			await db.vehicles.add({ name: `V${i}`, make: 'Honda', model: 'Civic' } as Vehicle);
		}
		const result = await importVehicleShare(makeShareData());
		expect(result.error?.code).toBe('MAX_VEHICLES');
		// Rolled back — no partial vehicle/children written.
		expect(await db.vehicles.count()).toBe(MAX_VEHICLES);
		expect(await db.fuelLogs.count()).toBe(0);
	});

	it('does NOT count archived vehicles toward the cap (an archived slot is free)', async () => {
		for (let i = 0; i < MAX_VEHICLES; i++) {
			await db.vehicles.add({
				name: `V${i}`,
				make: 'Honda',
				model: 'Civic',
				isArchived: true,
				archivedAt: 1
			} as Vehicle);
		}
		const result = await importVehicleShare(makeShareData());
		expect(result.error).toBeNull();
	});

	it('imports the vehicle as ACTIVE even if the payload marked it archived', async () => {
		const data = makeShareData();
		(data.vehicle as Vehicle).isArchived = true;
		(data.vehicle as Vehicle).archivedAt = 12345;
		const result = await importVehicleShare(data);
		expect(result.error).toBeNull();
		const imported = await db.vehicles.get(result.data!.vehicleId);
		expect(imported?.isArchived).toBeUndefined();
		expect(imported?.archivedAt).toBeUndefined();
	});

	it('signals a data change on success (additive merge, not a restore)', async () => {
		const { getDataGeneration } = await import('$lib/utils/tabSync');
		const before = getDataGeneration();
		await importVehicleShare(makeShareData());
		expect(getDataGeneration()).toBe(before + 1);
	});
});
