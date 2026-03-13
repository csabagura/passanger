// @vitest-environment node
import 'fake-indexeddb/auto'; // MUST be first import — patches global IndexedDB
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../db';
import {
	saveFuelLog,
	getFuelLogById,
	getAllFuelLogs,
	updateFuelLog,
	updateFuelLogsAtomic,
	deleteFuelLog
} from './fuelLogs';
import type { NewFuelLog } from '../schema';

// Factory functions — Dexie v4 mutates the input object after add() to set the id.
// Always create fresh objects per test to avoid cross-test contamination.
const makeLog = (): NewFuelLog => ({
	vehicleId: 1,
	date: new Date('2025-01-15'),
	odometer: 50000,
	quantity: 40.5,
	unit: 'L',
	distanceUnit: 'km',
	totalCost: 68.45,
	calculatedConsumption: 7.2,
	notes: 'Full tank at Shell'
});

const makeGalLog = (): NewFuelLog => ({
	vehicleId: 1,
	date: new Date('2025-02-01'),
	odometer: 51000,
	quantity: 12.3,
	unit: 'gal',
	distanceUnit: 'mi',
	totalCost: 45.0,
	calculatedConsumption: 35.8
});

beforeEach(async () => {
	await db.delete();
	await db.open();
});

describe('FuelLogRepository', () => {
	describe('saveFuelLog — validation', () => {
		it('rejects non-positive vehicleId', async () => {
			const result = await saveFuelLog({ ...makeLog(), vehicleId: 0 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects invalid date (non-Date value)', async () => {
			const result = await saveFuelLog({ ...makeLog(), date: new Date('not-a-date') });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects negative odometer', async () => {
			const result = await saveFuelLog({ ...makeLog(), odometer: -1 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects zero quantity', async () => {
			const result = await saveFuelLog({ ...makeLog(), quantity: 0 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects NaN quantity', async () => {
			const result = await saveFuelLog({ ...makeLog(), quantity: NaN });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects invalid unit', async () => {
			const result = await saveFuelLog({ ...makeLog(), unit: 'ml' as 'L' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects negative totalCost', async () => {
			const result = await saveFuelLog({ ...makeLog(), totalCost: -5 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects negative calculatedConsumption', async () => {
			const result = await saveFuelLog({ ...makeLog(), calculatedConsumption: -1 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects Infinity odometer', async () => {
			const result = await saveFuelLog({ ...makeLog(), odometer: Infinity });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects -Infinity odometer', async () => {
			const result = await saveFuelLog({ ...makeLog(), odometer: -Infinity });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects Infinity quantity', async () => {
			const result = await saveFuelLog({ ...makeLog(), quantity: Infinity });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects Infinity totalCost', async () => {
			const result = await saveFuelLog({ ...makeLog(), totalCost: Infinity });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects Infinity calculatedConsumption', async () => {
			const result = await saveFuelLog({ ...makeLog(), calculatedConsumption: Infinity });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});
	});

	describe('updateFuelLog — validation', () => {
		it('rejects zero quantity in changes', async () => {
			const saved = await saveFuelLog(makeLog());
			const result = await updateFuelLog(saved.data!.id, { quantity: 0 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects invalid unit in changes', async () => {
			const saved = await saveFuelLog(makeLog());
			const result = await updateFuelLog(saved.data!.id, { unit: 'km' as 'L' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects Infinity quantity in changes', async () => {
			const saved = await saveFuelLog(makeLog());
			const result = await updateFuelLog(saved.data!.id, { quantity: Infinity });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects Infinity totalCost in changes', async () => {
			const saved = await saveFuelLog(makeLog());
			const result = await updateFuelLog(saved.data!.id, { totalCost: Infinity });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});
	});

	describe('saveFuelLog', () => {
		it('returns ok with saved fuel log including id', async () => {
			const result = await saveFuelLog(makeLog());
			expect(result.error).toBeNull();
			expect(result.data?.id).toBeDefined();
			expect(typeof result.data?.id).toBe('number');
			expect(result.data?.vehicleId).toBe(1);
			expect(result.data?.quantity).toBe(40.5);
			expect(result.data?.unit).toBe('L');
		});

		it('stores calculatedConsumption field correctly', async () => {
			const result = await saveFuelLog(makeLog());
			expect(result.error).toBeNull();
			expect(result.data?.calculatedConsumption).toBe(7.2);
		});

		it('stores notes field correctly', async () => {
			const result = await saveFuelLog(makeLog());
			expect(result.error).toBeNull();
			expect(result.data?.notes).toBe('Full tank at Shell');
		});

		it('saves with gal unit', async () => {
			const result = await saveFuelLog(makeGalLog());
			expect(result.error).toBeNull();
			expect(result.data?.unit).toBe('gal');
			expect(result.data?.calculatedConsumption).toBe(35.8);
		});

		it('saves without optional notes', async () => {
			const result = await saveFuelLog(makeGalLog());
			expect(result.error).toBeNull();
			expect(result.data?.notes).toBeUndefined();
		});
	});

	describe('getFuelLogById', () => {
		it('returns the fuel log when found', async () => {
			const saved = await saveFuelLog(makeLog());
			const result = await getFuelLogById(saved.data!.id);
			expect(result.error).toBeNull();
			expect(result.data?.id).toBe(saved.data!.id);
			expect(result.data?.quantity).toBe(40.5);
		});

		it('returns err with NOT_FOUND when id does not exist', async () => {
			const result = await getFuelLogById(999);
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});
	});

	describe('getAllFuelLogs', () => {
		it('returns empty array when no records', async () => {
			const result = await getAllFuelLogs();
			expect(result.error).toBeNull();
			expect(result.data).toEqual([]);
		});

		it('returns all fuel logs when no vehicleId filter', async () => {
			await saveFuelLog(makeLog());
			await saveFuelLog({ ...makeGalLog(), vehicleId: 2 });
			const result = await getAllFuelLogs();
			expect(result.error).toBeNull();
			expect(result.data).toHaveLength(2);
		});

		it('filters by vehicleId when provided', async () => {
			await saveFuelLog({ ...makeLog(), vehicleId: 1, odometer: 50000 });
			await saveFuelLog({ ...makeLog(), vehicleId: 1, odometer: 51000 });
			await saveFuelLog({ ...makeGalLog(), vehicleId: 2 });
			const result = await getAllFuelLogs(1);
			expect(result.error).toBeNull();
			expect(result.data).toHaveLength(2);
			expect(result.data?.every((l) => l.vehicleId === 1)).toBe(true);
		});

		it('returns empty array for vehicleId with no logs', async () => {
			await saveFuelLog(makeLog()); // vehicleId: 1
			const result = await getAllFuelLogs(99);
			expect(result.error).toBeNull();
			expect(result.data).toEqual([]);
		});
	});

	describe('updateFuelLog', () => {
		it('persists quantity change while preserving other fields', async () => {
			const saved = await saveFuelLog(makeLog());
			const updated = await updateFuelLog(saved.data!.id, { quantity: 55.0 });
			expect(updated.error).toBeNull();
			expect(updated.data?.quantity).toBe(55.0);
			expect(updated.data?.vehicleId).toBe(1);
			expect(updated.data?.unit).toBe('L');
		});

		it('returns err with NOT_FOUND when id does not exist', async () => {
			const result = await updateFuelLog(999, { quantity: 10 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});
	});

	describe('updateFuelLogsAtomic', () => {
		it('updates the requested logs inside a single transaction', async () => {
			const first = await saveFuelLog(makeLog());
			const second = await saveFuelLog({
				...makeLog(),
				odometer: 51000,
				calculatedConsumption: 8.1
			});

			const result = await updateFuelLogsAtomic([
				{ id: first.data!.id, changes: { quantity: 41 } },
				{ id: second.data!.id, changes: { calculatedConsumption: 7.8 } }
			]);

			expect(result.error).toBeNull();
			expect(result.data).toHaveLength(2);

			const refreshedFirst = await getFuelLogById(first.data!.id);
			const refreshedSecond = await getFuelLogById(second.data!.id);
			expect(refreshedFirst.data?.quantity).toBe(41);
			expect(refreshedSecond.data?.calculatedConsumption).toBe(7.8);
		});

		it('rolls back earlier updates when any later patch fails', async () => {
			const first = await saveFuelLog(makeLog());
			const second = await saveFuelLog({
				...makeLog(),
				odometer: 51000,
				calculatedConsumption: 8.1
			});

			const result = await updateFuelLogsAtomic([
				{ id: first.data!.id, changes: { quantity: 41 } },
				{ id: second.data!.id + 999, changes: { calculatedConsumption: 7.8 } }
			]);

			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');

			const refreshedFirst = await getFuelLogById(first.data!.id);
			const refreshedSecond = await getFuelLogById(second.data!.id);
			expect(refreshedFirst.data?.quantity).toBe(40.5);
			expect(refreshedSecond.data?.calculatedConsumption).toBe(8.1);
		});
	});

	describe('deleteFuelLog', () => {
		it('removes the record and recalculates the immediate successor inside one transaction', async () => {
			const first = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-10'),
				odometer: 100,
				quantity: 10,
				totalCost: 20,
				calculatedConsumption: 0
			});
			const deleted = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-11'),
				odometer: 200,
				quantity: 10,
				totalCost: 20,
				calculatedConsumption: 10
			});
			const successor = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-12'),
				odometer: 300,
				quantity: 10,
				totalCost: 20,
				calculatedConsumption: 10
			});

			const deleteResult = await deleteFuelLog(deleted.data!.id);
			expect(deleteResult.error).toBeNull();
			expect(deleteResult.data?.deletedLogId).toBe(deleted.data!.id);
			expect(deleteResult.data?.updatedLogs).toHaveLength(1);
			expect(deleteResult.data?.updatedLogs[0].id).toBe(successor.data!.id);
			expect(deleteResult.data?.updatedLogs[0].calculatedConsumption).toBeCloseTo(5);

			const fetched = await getFuelLogById(deleted.data!.id);
			expect(fetched.error?.code).toBe('NOT_FOUND');
			const refreshedFirst = await getFuelLogById(first.data!.id);
			const refreshedSuccessor = await getFuelLogById(successor.data!.id);
			expect(refreshedFirst.error).toBeNull();
			expect(refreshedSuccessor.data?.calculatedConsumption).toBeCloseTo(5);
		});

		it('returns NOT_FOUND when the target fuel log does not exist', async () => {
			const result = await deleteFuelLog(999);
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});

		it('rolls back the delete when a successor update fails', async () => {
			const first = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-10'),
				odometer: 100,
				quantity: 10,
				totalCost: 20,
				calculatedConsumption: 0
			});
			const deleted = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-11'),
				odometer: 200,
				quantity: 10,
				totalCost: 20,
				calculatedConsumption: 10
			});
			const successor = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-12'),
				odometer: 300,
				quantity: 10,
				totalCost: 20,
				calculatedConsumption: 10
			});

			const updateSpy = vi
				.spyOn(db.fuelLogs, 'update')
				.mockRejectedValue(new Error('Simulated successor update failure'));

			try {
				const deleteResult = await deleteFuelLog(deleted.data!.id);
				expect(deleteResult.data).toBeNull();
				expect(deleteResult.error?.code).toBe('DELETE_FAILED');

				const refreshedDeleted = await getFuelLogById(deleted.data!.id);
				const refreshedSuccessor = await getFuelLogById(successor.data!.id);
				const allLogs = await getAllFuelLogs(first.data!.vehicleId);

				expect(refreshedDeleted.error).toBeNull();
				expect(refreshedSuccessor.data?.calculatedConsumption).toBe(10);
				expect(allLogs.data).toHaveLength(3);
			} finally {
				updateSpy.mockRestore();
			}
		});
	});

	describe('data integrity — no partial record on failed save (AC5 / NFR7)', () => {
		it('validation failure leaves no record in the database', async () => {
			const invalidLog = { ...makeLog(), quantity: -1 };
			const result = await saveFuelLog(invalidLog);

			expect(result.error?.code).toBe('VALIDATION_ERROR');

			// Verify the DB is pristine — no partial record was inserted
			const allLogs = await getAllFuelLogs();
			expect(allLogs.data).toHaveLength(0);
		});

		it('saved record is fully intact (no partial fields) after add+readback', async () => {
			const log = makeLog();
			const result = await saveFuelLog(log);

			expect(result.error).toBeNull();
			const saved = result.data!;

			// All mandatory fields must be persisted exactly
			expect(saved.vehicleId).toBe(log.vehicleId);
			expect(saved.odometer).toBe(log.odometer);
			expect(saved.quantity).toBe(log.quantity);
			expect(saved.unit).toBe(log.unit);
			expect(saved.distanceUnit).toBe(log.distanceUnit);
			expect(saved.totalCost).toBe(log.totalCost);
			expect(saved.calculatedConsumption).toBe(log.calculatedConsumption);
		});
	});

	describe('data integrity — saved data survives DB/app-shell recreate (AC1 / NFR7)', () => {
		it('saved fuel log remains readable after DB is closed and reopened', async () => {
			const saved = await saveFuelLog(makeLog());
			const savedId = saved.data!.id;

			// Simulate DB/app-shell recreate by closing and reopening the Dexie instance
			db.close();
			await db.open();

			const fetched = await getFuelLogById(savedId);
			expect(fetched.error).toBeNull();
			expect(fetched.data?.id).toBe(savedId);
			expect(fetched.data?.quantity).toBe(40.5);
			expect(fetched.data?.vehicleId).toBe(1);
		});

		it('multiple saved entries all survive a DB recreate', async () => {
			await saveFuelLog(makeLog());
			await saveFuelLog({ ...makeGalLog(), odometer: 52000 });

			db.close();
			await db.open();

			const allLogs = await getAllFuelLogs();
			expect(allLogs.error).toBeNull();
			expect(allLogs.data).toHaveLength(2);
		});

		it('saved entry data is unchanged (not mutated) after DB recreate', async () => {
			const original = makeLog();
			const saved = await saveFuelLog(original);
			const savedId = saved.data!.id;

			db.close();
			await db.open();

			const fetched = await getFuelLogById(savedId);
			expect(fetched.data?.odometer).toBe(original.odometer);
			expect(fetched.data?.totalCost).toBe(original.totalCost);
			expect(fetched.data?.notes).toBe(original.notes);
		});
	});
});
