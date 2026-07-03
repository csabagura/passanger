// @vitest-environment node
import 'fake-indexeddb/auto'; // MUST be first import — patches global IndexedDB
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../db';
import {
	saveFuelLog,
	getFuelLogById,
	getAllFuelLogs,
	updateFuelLogWithTimeline,
	deleteFuelLog,
	restoreFuelLog
} from './fuelLogs';
import type { FuelLog, NewFuelLog } from '../schema';

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

	describe('updateFuelLogWithTimeline — validation', () => {
		it('rejects zero quantity', async () => {
			const saved = await saveFuelLog(makeLog());
			const result = await updateFuelLogWithTimeline({ ...saved.data!, quantity: 0 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects an unpaired unit/distanceUnit combination', async () => {
			const saved = await saveFuelLog(makeLog());
			const result = await updateFuelLogWithTimeline({
				...saved.data!,
				unit: 'gal',
				distanceUnit: 'km'
			});
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects Infinity quantity', async () => {
			const saved = await saveFuelLog(makeLog());
			const result = await updateFuelLogWithTimeline({ ...saved.data!, quantity: Infinity });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects Infinity totalCost', async () => {
			const saved = await saveFuelLog(makeLog());
			const result = await updateFuelLogWithTimeline({ ...saved.data!, totalCost: Infinity });
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

		it('ADR-006 AD-WB-1: calculatedConsumption is engine-computed in-transaction, not trusted from the caller — a first-ever fill (no anchor) always computes 0 regardless of what the caller passed', async () => {
			const result = await saveFuelLog(makeLog());
			expect(result.error).toBeNull();
			expect(result.data?.calculatedConsumption).toBe(0);
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
			expect(result.data?.calculatedConsumption).toBe(0);
		});

		it('ADR-006 AD-WB-1: computes real consumption against a fresh-read prior fill (not a caller-supplied value)', async () => {
			await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-10'),
				odometer: 100,
				quantity: 10,
				calculatedConsumption: 999 // caller-supplied — must be IGNORED
			});
			const second = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-11'),
				odometer: 200,
				quantity: 10,
				calculatedConsumption: 999 // caller-supplied — must be IGNORED
			});
			expect(second.error).toBeNull();
			// distance 100, litres 10 -> 10 L/100km, NOT the caller's 999.
			expect(second.data?.calculatedConsumption).toBeCloseTo(10);
		});

		it('ADR-006 AD-WB-1: a backdated/interleaved insert recomputes and persists the affected successor', async () => {
			const first = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-10'),
				odometer: 100,
				quantity: 10
			});
			const last = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-12'),
				odometer: 300,
				quantity: 10
			});
			// last's pre-insert consumption: distance 200 (300-100), litres 10 -> 5 L/100km.
			expect((await getFuelLogById(last.data!.id)).data?.calculatedConsumption).toBeCloseTo(5);

			// Backdated insert BETWEEN first and last splits the span: first->middle (100->200,
			// litres 10 -> 10) and middle->last (200->300, litres 10 -> 10). last's stored value
			// must be recomputed from 5 to 10 as a side effect of this insert, even though the
			// caller only asked to save the middle row.
			await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-11'),
				odometer: 200,
				quantity: 10
			});

			const refreshedFirst = await getFuelLogById(first.data!.id);
			const refreshedLast = await getFuelLogById(last.data!.id);
			expect(refreshedFirst.data?.calculatedConsumption).toBe(0); // still the anchor, unaffected
			expect(refreshedLast.data?.calculatedConsumption).toBeCloseTo(10);
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

	describe('updateFuelLogWithTimeline (ADR-006 AD-WB-1 — repo-owned create/update timeline boundary)', () => {
		it('persists a field change while preserving other fields', async () => {
			const saved = await saveFuelLog(makeLog());
			const result = await updateFuelLogWithTimeline({ ...saved.data!, quantity: 55.0 });
			expect(result.error).toBeNull();
			const editedRow = result.data?.find((log) => log.id === saved.data!.id);
			expect(editedRow?.quantity).toBe(55.0);
			expect(editedRow?.vehicleId).toBe(1);
			expect(editedRow?.unit).toBe('L');
		});

		it('returns NOT_FOUND when id does not exist', async () => {
			const saved = await saveFuelLog(makeLog());
			const result = await updateFuelLogWithTimeline({ ...saved.data!, id: 999 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});

		it('rejects a vehicleId change rather than silently dropping the edit (ADR-006 — the timeline query uses the NEW vehicleId and would otherwise never find this row)', async () => {
			const saved = await saveFuelLog(makeLog());
			const original = saved.data!;

			const result = await updateFuelLogWithTimeline({ ...original, vehicleId: 2, quantity: 99 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');

			// The row is untouched — neither the vehicleId nor the attempted quantity change landed.
			const refreshed = await getFuelLogById(original.id);
			expect(refreshed.data?.vehicleId).toBe(1);
			expect(refreshed.data?.quantity).toBe(original.quantity);
		});

		it('persists a currency-only edit end-to-end (H1 regression)', async () => {
			const saved = await saveFuelLog({ ...makeLog(), currency: '€' });
			const original = saved.data!;

			const result = await updateFuelLogWithTimeline({ ...original, currency: 'Ft' });
			expect(result.error).toBeNull();

			const refreshed = await getFuelLogById(original.id);
			expect(refreshed.data?.currency).toBe('Ft');
		});

		it('recomputes and persists a successor whose span the edit affects', async () => {
			const first = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-10'),
				odometer: 100,
				quantity: 10
			});
			const middle = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-11'),
				odometer: 200,
				quantity: 10
			});
			const last = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-12'),
				odometer: 300,
				quantity: 10
			});
			// Pre-edit: last spans 200->300 (distance 100), litres 10 -> 10 L/100km.
			expect((await getFuelLogById(last.data!.id)).data?.calculatedConsumption).toBeCloseTo(10);

			// Editing middle's odometer shrinks the middle->last span.
			const result = await updateFuelLogWithTimeline({ ...middle.data!, odometer: 250 });
			expect(result.error).toBeNull();

			const refreshedLast = await getFuelLogById(last.data!.id);
			// last now spans 250->300 (distance 50), litres 10 -> 20 L/100km.
			expect(refreshedLast.data?.calculatedConsumption).toBeCloseTo(20);
			expect((await getFuelLogById(first.data!.id)).data?.calculatedConsumption).toBe(0);
			expect(result.data!.some((log) => log.id === last.data!.id)).toBe(true);
		});

		it('ADR-006 AD-WB-1 (H14/S12 — the concurrent-write edit test): recomputes a successor added by a concurrent write, which no caller-supplied timeline snapshot could have known about', async () => {
			// updateFuelLogWithTimeline takes NO timeline/plan parameter — it can only see the
			// timeline by fresh-reading at commit time. This test proves that fresh-read actually
			// happens: a row created AFTER the edited row was fetched (simulating a second tab or
			// the documented dual-mounted page+CaptureSheet writing between "mount" and "save") is
			// still correctly recomputed. This is the exact TOCTOU the old client-built-plan +
			// updateFuelLogsAtomic pattern could not close (a plan built from a stale snapshot simply
			// never contained this row's id, so it was never recomputed).
			const first = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-10'),
				odometer: 100,
				quantity: 10
			});
			const middle = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-11'),
				odometer: 200,
				quantity: 10
			});
			void first;

			// The "concurrent write" — lands in the DB after `middle` was captured by the test/caller.
			const concurrent = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-12'),
				odometer: 300,
				quantity: 10
			});
			expect((await getFuelLogById(concurrent.data!.id)).data?.calculatedConsumption).toBeCloseTo(
				10
			);

			const result = await updateFuelLogWithTimeline({ ...middle.data!, odometer: 250 });
			expect(result.error).toBeNull();

			// concurrent (invisible to any pre-captured snapshot) IS recomputed: 250->300 (distance
			// 50), litres 10 -> 20 L/100km — proof the plan came from a fresh read, not a stale one.
			const refreshedConcurrent = await getFuelLogById(concurrent.data!.id);
			expect(refreshedConcurrent.data?.calculatedConsumption).toBeCloseTo(20);
			expect(result.data!.some((log) => log.id === concurrent.data!.id)).toBe(true);
		});

		it('rolls back the edited row when a successor update fails (atomicity)', async () => {
			const middle = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-11'),
				odometer: 200,
				quantity: 10
			});
			const last = await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-12'),
				odometer: 300,
				quantity: 10
			});

			const updateSpy = vi
				.spyOn(db.fuelLogs, 'update')
				.mockRejectedValue(new Error('Simulated successor update failure'));

			try {
				const result = await updateFuelLogWithTimeline({ ...middle.data!, odometer: 250 });
				expect(result.data).toBeNull();
				expect(result.error?.code).toBe('UPDATE_FAILED');

				// Nothing was persisted — the edited row's OWN change rolled back too, one transaction.
				const refreshedMiddle = await getFuelLogById(middle.data!.id);
				const refreshedLast = await getFuelLogById(last.data!.id);
				expect(refreshedMiddle.data?.odometer).toBe(200);
				expect(refreshedLast.data?.calculatedConsumption).toBeCloseTo(10);
			} finally {
				updateSpy.mockRestore();
			}
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

	describe('restoreFuelLog (Story 2.5 — reversible delete)', () => {
		// Build a 3-fill timeline (first/middle/last), capture each scenario's pre-delete state, then
		// assert a delete→restore round-trip returns the timeline byte-identical (id + consumption).
		async function seedTimeline(): Promise<FuelLog[]> {
			await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-10'),
				odometer: 100,
				quantity: 10,
				totalCost: 20,
				calculatedConsumption: 0
			});
			await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-11'),
				odometer: 200,
				quantity: 10,
				totalCost: 20,
				calculatedConsumption: 10
			});
			await saveFuelLog({
				...makeLog(),
				date: new Date('2025-01-12'),
				odometer: 300,
				quantity: 10,
				totalCost: 20,
				calculatedConsumption: 10
			});
			const all = await getAllFuelLogs(1);
			return (all.data ?? []).slice().sort((a, b) => a.id - b.id);
		}

		function snapshotConsumptions(logs: FuelLog[]): Array<[number, number]> {
			return logs
				.slice()
				.sort((a, b) => a.id - b.id)
				.map((log) => [log.id, log.calculatedConsumption]);
		}

		it.each([
			['first', 0],
			['middle', 1],
			['last', 2]
		])(
			'delete→restore of the %s fill leaves the timeline byte-identical',
			async (_label, index) => {
				const original = await seedTimeline();
				const before = snapshotConsumptions(original);
				const target = original[index];

				const deleteResult = await deleteFuelLog(target.id);
				expect(deleteResult.error).toBeNull();

				const restoreResult = await restoreFuelLog(target);
				expect(restoreResult.error).toBeNull();
				expect(restoreResult.data?.restoredLog.id).toBe(target.id);

				const after = await getAllFuelLogs(1);
				expect(after.data).toHaveLength(3);
				// Re-inserted at the ORIGINAL id (Dexie never reissues, put() preserves it).
				expect(after.data?.some((log) => log.id === target.id)).toBe(true);
				expect(snapshotConsumptions(after.data ?? [])).toEqual(before);
			}
		);

		it('restores neighbor consumptions for a mixed-unit timeline (no cross-unit consumption)', async () => {
			await saveFuelLog({
				...makeLog(),
				date: new Date('2025-03-01'),
				odometer: 1000,
				quantity: 10,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 20,
				calculatedConsumption: 0
			});
			await saveFuelLog({
				...makeGalLog(),
				date: new Date('2025-03-02'),
				odometer: 1100,
				calculatedConsumption: 0
			});
			await saveFuelLog({
				...makeLog(),
				date: new Date('2025-03-03'),
				odometer: 1200,
				quantity: 10,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 20,
				calculatedConsumption: 0
			});

			const original = (await getAllFuelLogs(1)).data ?? [];
			const before = snapshotConsumptions(original);
			const target = original.slice().sort((a, b) => a.id - b.id)[1];

			expect((await deleteFuelLog(target.id)).error).toBeNull();
			expect((await restoreFuelLog(target)).error).toBeNull();

			const after = await getAllFuelLogs(1);
			expect(snapshotConsumptions(after.data ?? [])).toEqual(before);
		});

		it('recomputes neighbor consumptions independent of the snapshot value', async () => {
			// Guards against the round-trip masking a bug by feeding the same object back: corrupt the
			// snapshot's OWN consumption and confirm the surviving neighbor is recomputed from
			// odometer/quantity (not derived from the snapshot's stale field). The restored row itself
			// is re-inserted verbatim by design — the caller's generation guard keeps that value valid.
			const original = await seedTimeline();
			const target = original[1]; // middle
			const successorId = original[2].id;

			expect((await deleteFuelLog(target.id)).error).toBeNull();

			const corruptedSnapshot = { ...target, calculatedConsumption: 999 };
			const restoreResult = await restoreFuelLog(corruptedSnapshot);
			expect(restoreResult.error).toBeNull();

			const after = await getAllFuelLogs(1);
			const successor = after.data?.find((log) => log.id === successorId);
			// Successor recomputes to its true value (10), unaffected by the corrupted snapshot field.
			expect(successor?.calculatedConsumption).toBeCloseTo(10);
			// The restored row carries the snapshot's value verbatim (documented put() behavior).
			const restored = after.data?.find((log) => log.id === target.id);
			expect(restored?.calculatedConsumption).toBe(999);
		});

		it('returns an error when the original id is already present (defensive guard)', async () => {
			const saved = await saveFuelLog(makeLog());
			const result = await restoreFuelLog(saved.data!);

			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('SAVE_FAILED');
			// The existing row is untouched.
			expect((await getAllFuelLogs(1)).data).toHaveLength(1);
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
			// calculatedConsumption is engine-computed (ADR-006 AD-WB-1), not a pass-through field —
			// a first-ever fill has no anchor, so it is always 0 regardless of what was requested.
			expect(saved.calculatedConsumption).toBe(0);
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
