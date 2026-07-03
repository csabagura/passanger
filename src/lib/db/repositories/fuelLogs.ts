import { db } from '../db';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { FuelLog, NewFuelLog } from '../schema';
import {
	buildFuelLogDeletionPlan,
	buildFuelLogUpdatePlan,
	recalculateFuelLogConsumptions
} from '$lib/utils/fuelLogTimeline';
import { validateNewFuelLog, validatePartialFuelLog } from '../validators/rowValidation';
import { runWrite, encodeSentinel } from '../writeSkeleton';

// A synthetic id (never persisted) that lets the shared timeline engine slot a not-yet-inserted row
// into the vehicle's sorted timeline to compute both its own consumption and any successor's, in one
// pass. Number.MAX_SAFE_INTEGER can never collide with a real Dexie auto-increment id.
const SYNTHETIC_NEW_ID = Number.MAX_SAFE_INTEGER;

export class FuelLogRepository {
	async saveFuelLog(entry: NewFuelLog): Promise<Result<FuelLog>> {
		// ADR-006 AD-WB-1: consumption is computed IN-TRANSACTION from a fresh read, not trusted from
		// the caller — closes the same staleness class as the edit-path TOCTOU (H14) for create. A
		// backdated/interleaved insert's effect on a later fill's span is recomputed and persisted
		// here too (the successor), even though only the new row is returned.
		return runWrite(
			() => validateNewFuelLog(entry),
			() =>
				db.transaction('rw', db.fuelLogs, async () => {
					const priorLogs = await db.fuelLogs.where('vehicleId').equals(entry.vehicleId).toArray();

					const candidate: FuelLog = { ...entry, id: SYNTHETIC_NEW_ID };
					const recalculated = recalculateFuelLogConsumptions([...priorLogs, candidate]);
					const ownConsumption =
						recalculated.find((log) => log.id === SYNTHETIC_NEW_ID)?.calculatedConsumption ?? 0;

					const id = await db.fuelLogs.add({
						...entry,
						calculatedConsumption: ownConsumption
					} as FuelLog);
					const saved = await db.fuelLogs.get(id as number);
					if (!saved) throw encodeSentinel('SAVE_FAILED', 'Record not found after insert');

					const priorById = new Map(priorLogs.map((log) => [log.id, log]));
					for (const log of recalculated) {
						if (log.id === SYNTHETIC_NEW_ID) continue;
						const prior = priorById.get(log.id);
						if (!prior || prior.calculatedConsumption === log.calculatedConsumption) continue;

						const changes = { calculatedConsumption: log.calculatedConsumption };
						const validationError = validatePartialFuelLog(changes);
						if (validationError) throw encodeSentinel('VALIDATION_ERROR', validationError);

						const count = await db.fuelLogs.update(log.id, changes);
						if (count === 0) throw encodeSentinel('NOT_FOUND', `FuelLog ${log.id} not found`);
					}

					return saved;
				}),
			'SAVE_FAILED'
		);
	}

	async getFuelLogById(id: number): Promise<Result<FuelLog>> {
		try {
			const log = await db.fuelLogs.get(id);
			if (!log) return err('NOT_FOUND', `FuelLog ${id} not found`);
			return ok(log);
		} catch (e) {
			return err('GET_FAILED', String(e));
		}
	}

	async getAllFuelLogs(vehicleId?: number): Promise<Result<FuelLog[]>> {
		try {
			const logs =
				vehicleId !== undefined
					? await db.fuelLogs.where('vehicleId').equals(vehicleId).toArray()
					: await db.fuelLogs.toArray();
			return ok(logs);
		} catch (e) {
			return err('GET_FAILED', String(e));
		}
	}

	// Repo-owned create/update timeline boundary (ADR-006 AD-WB-1, closes H14 + S12). Mirrors
	// deleteFuelLog's shape exactly: fresh-read the vehicle's timeline INSIDE the transaction, build
	// the plan from that fresh read (never a caller-supplied snapshot), apply it, re-validate every
	// patch in-transaction. Supersedes the old updateFuelLog (single-row, timeline-blind bypass —
	// removed, zero production callers) and updateFuelLogsAtomic (applied a UI-BUILT plan without
	// re-reading — the exact TOCTOU this closes). `updatedLog` carries the caller's intended field
	// values; its `calculatedConsumption` is ignored and recomputed here.
	async updateFuelLogWithTimeline(updatedLog: FuelLog): Promise<Result<FuelLog[]>> {
		return runWrite(
			() => validateNewFuelLog(updatedLog),
			() =>
				db.transaction('rw', db.fuelLogs, async () => {
					const existing = await db.fuelLogs.get(updatedLog.id);
					if (!existing) throw encodeSentinel('NOT_FOUND', `FuelLog ${updatedLog.id} not found`);

					const timelineLogs = await db.fuelLogs
						.where('vehicleId')
						.equals(updatedLog.vehicleId)
						.toArray();
					const updatePlan = buildFuelLogUpdatePlan(timelineLogs, updatedLog);

					for (const patch of updatePlan) {
						const validationError = validatePartialFuelLog(patch.changes);
						if (validationError) throw encodeSentinel('VALIDATION_ERROR', validationError);

						const count = await db.fuelLogs.update(patch.id, patch.changes);
						if (count === 0) throw encodeSentinel('NOT_FOUND', `FuelLog ${patch.id} not found`);
					}

					const updatedLogs =
						updatePlan.length === 0
							? []
							: await db.fuelLogs.bulkGet(updatePlan.map((patch) => patch.id));

					if (updatedLogs.some((log) => !log))
						throw encodeSentinel('UPDATE_FAILED', 'Record not found after update');

					return updatedLogs as FuelLog[];
				}),
			'UPDATE_FAILED'
		);
	}

	async deleteFuelLog(
		id: number
	): Promise<Result<{ deletedLogId: number; updatedLogs: FuelLog[] }>> {
		// S15: this now maps quota errors, via runWrite's shared envelope — previously the only
		// wired write path that omitted it despite writing neighbor patches.
		return runWrite(
			() => null,
			() =>
				db.transaction('rw', db.fuelLogs, async () => {
					const targetLog = await db.fuelLogs.get(id);
					if (!targetLog) throw encodeSentinel('NOT_FOUND', `FuelLog ${id} not found`);

					const timelineLogs = await db.fuelLogs
						.where('vehicleId')
						.equals(targetLog.vehicleId)
						.toArray();
					const deletionPlan = buildFuelLogDeletionPlan(timelineLogs, id);

					await db.fuelLogs.delete(id);

					for (const patch of deletionPlan) {
						const validationError = validatePartialFuelLog(patch.changes);
						if (validationError) throw encodeSentinel('VALIDATION_ERROR', validationError);

						const count = await db.fuelLogs.update(patch.id, patch.changes);
						if (count === 0) throw encodeSentinel('NOT_FOUND', `FuelLog ${patch.id} not found`);
					}

					const updatedLogs =
						deletionPlan.length === 0
							? []
							: await db.fuelLogs.bulkGet(deletionPlan.map((patch) => patch.id));

					if (updatedLogs.some((log) => !log))
						throw encodeSentinel('DELETE_FAILED', 'Record not found after update');

					return {
						deletedLogId: id,
						updatedLogs: updatedLogs as FuelLog[]
					};
				}),
			'DELETE_FAILED'
		);
	}

	// Inverse of deleteFuelLog: re-insert a deleted log's snapshot at its ORIGINAL id (via put())
	// and atomically restore the neighbor consumptions the delete had recomputed. Reuses the same
	// timeline engine as delete, so the timeline returns to its exact pre-delete state. The caller
	// (History undo) is responsible for the generation guard that guarantees the surrounding
	// timeline is unchanged, which is what keeps the snapshot's own calculatedConsumption valid.
	async restoreFuelLog(
		snapshot: FuelLog
	): Promise<Result<{ restoredLog: FuelLog; updatedLogs: FuelLog[] }>> {
		return runWrite(
			() => null,
			() =>
				db.transaction('rw', db.fuelLogs, async () => {
					// The id should be free (Dexie ++id never reissues a deleted id); guard defensively.
					const existing = await db.fuelLogs.get(snapshot.id);
					if (existing)
						throw encodeSentinel('SAVE_FAILED', `FuelLog ${snapshot.id} already present`);

					// The post-delete set (WITHOUT the restored row). buildFuelLogUpdatePlan injects the
					// snapshot, recomputes, then skips any id absent from this set — so the plan contains
					// ONLY neighbor patches; the restored row itself is written directly via put().
					const timelineLogs = await db.fuelLogs
						.where('vehicleId')
						.equals(snapshot.vehicleId)
						.toArray();
					const updatePlan = buildFuelLogUpdatePlan(timelineLogs, snapshot);

					await db.fuelLogs.put(snapshot);

					for (const patch of updatePlan) {
						const validationError = validatePartialFuelLog(patch.changes);
						if (validationError) throw encodeSentinel('VALIDATION_ERROR', validationError);

						const count = await db.fuelLogs.update(patch.id, patch.changes);
						if (count === 0) throw encodeSentinel('NOT_FOUND', `FuelLog ${patch.id} not found`);
					}

					const updatedLogs =
						updatePlan.length === 0
							? []
							: await db.fuelLogs.bulkGet(updatePlan.map((patch) => patch.id));

					if (updatedLogs.some((log) => !log))
						throw encodeSentinel('SAVE_FAILED', 'Record not found after update');

					return {
						restoredLog: snapshot,
						updatedLogs: updatedLogs as FuelLog[]
					};
				}),
			'SAVE_FAILED'
		);
	}
}

export const fuelLogRepository = new FuelLogRepository();

// Convenience function exports — delegate to repository instance for backward compatibility
export const saveFuelLog = (entry: NewFuelLog) => fuelLogRepository.saveFuelLog(entry);
export const getFuelLogById = (id: number) => fuelLogRepository.getFuelLogById(id);
export const getAllFuelLogs = (vehicleId?: number) => fuelLogRepository.getAllFuelLogs(vehicleId);
export const updateFuelLogWithTimeline = (updatedLog: FuelLog) =>
	fuelLogRepository.updateFuelLogWithTimeline(updatedLog);
export const deleteFuelLog = (id: number) => fuelLogRepository.deleteFuelLog(id);
export const restoreFuelLog = (snapshot: FuelLog) => fuelLogRepository.restoreFuelLog(snapshot);
