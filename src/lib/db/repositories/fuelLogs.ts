import { db } from '../db';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { FuelLog, NewFuelLog } from '../schema';
import { buildFuelLogDeletionPlan } from '$lib/utils/fuelLogTimeline';

function validateNewFuelLog(entry: NewFuelLog): string | null {
	if (!Number.isInteger(entry.vehicleId) || entry.vehicleId <= 0)
		return 'vehicleId must be a positive integer';
	if (!(entry.date instanceof Date) || isNaN(entry.date.getTime()))
		return 'date must be a valid Date';
	// FIX #3: Enforce odometer > 0 to match form validation (was >= 0)
	if (typeof entry.odometer !== 'number' || !Number.isFinite(entry.odometer) || entry.odometer <= 0)
		return 'odometer must be a positive finite number';
	if (typeof entry.quantity !== 'number' || !Number.isFinite(entry.quantity) || entry.quantity <= 0)
		return 'quantity must be a positive finite number';
	if (entry.unit !== 'L' && entry.unit !== 'gal') return 'unit must be "L" or "gal"';
	if (entry.distanceUnit !== 'km' && entry.distanceUnit !== 'mi')
		return 'distanceUnit must be "km" or "mi"';
	// FIX #3: Validate unit/distanceUnit consistency: L pairs with km, gal pairs with mi
	if (
		(entry.unit === 'L' && entry.distanceUnit !== 'km') ||
		(entry.unit === 'gal' && entry.distanceUnit !== 'mi')
	) {
		return 'unit and distanceUnit must match: L with km, gal with mi';
	}
	if (
		typeof entry.totalCost !== 'number' ||
		!Number.isFinite(entry.totalCost) ||
		entry.totalCost < 0
	)
		return 'totalCost must be a non-negative finite number';
	if (
		typeof entry.calculatedConsumption !== 'number' ||
		!Number.isFinite(entry.calculatedConsumption) ||
		entry.calculatedConsumption < 0
	)
		return 'calculatedConsumption must be a non-negative finite number';
	return null;
}

function validatePartialFuelLog(changes: Partial<NewFuelLog>): string | null {
	if (
		'vehicleId' in changes &&
		(!Number.isInteger(changes.vehicleId) || (changes.vehicleId as number) <= 0)
	)
		return 'vehicleId must be a positive integer';
	if (
		'date' in changes &&
		(!(changes.date instanceof Date) || isNaN((changes.date as Date).getTime()))
	)
		return 'date must be a valid Date';
	// FIX #3: Enforce odometer > 0 to match form validation (was >= 0)
	if (
		'odometer' in changes &&
		(typeof changes.odometer !== 'number' ||
			!Number.isFinite(changes.odometer as number) ||
			(changes.odometer as number) <= 0)
	)
		return 'odometer must be a positive finite number';
	if (
		'quantity' in changes &&
		(typeof changes.quantity !== 'number' ||
			!Number.isFinite(changes.quantity as number) ||
			(changes.quantity as number) <= 0)
	)
		return 'quantity must be a positive finite number';
	if ('unit' in changes && changes.unit !== 'L' && changes.unit !== 'gal')
		return 'unit must be "L" or "gal"';
	if ('distanceUnit' in changes && changes.distanceUnit !== 'km' && changes.distanceUnit !== 'mi')
		return 'distanceUnit must be "km" or "mi"';
	// FIX #13 (Pass 13) - ISSUE 2: Prevent partial unit updates that could create inconsistent pairs
	// If either unit or distanceUnit is being updated, both MUST be updated together
	if ('unit' in changes !== 'distanceUnit' in changes) {
		return 'unit and distanceUnit must be updated together to maintain consistency';
	}
	// FIX #11 (Pass 11) - ISSUE 3: Validate unit/distanceUnit consistency on partial updates
	// If user updates unit without distanceUnit (or vice versa), ensure they still pair correctly
	if ('unit' in changes && 'distanceUnit' in changes) {
		if (
			(changes.unit === 'L' && changes.distanceUnit !== 'km') ||
			(changes.unit === 'gal' && changes.distanceUnit !== 'mi')
		) {
			return 'unit and distanceUnit must match: L with km, gal with mi';
		}
	}
	if (
		'totalCost' in changes &&
		(typeof changes.totalCost !== 'number' ||
			!Number.isFinite(changes.totalCost as number) ||
			(changes.totalCost as number) < 0)
	)
		return 'totalCost must be a non-negative finite number';
	if (
		'calculatedConsumption' in changes &&
		(typeof changes.calculatedConsumption !== 'number' ||
			!Number.isFinite(changes.calculatedConsumption as number) ||
			(changes.calculatedConsumption as number) < 0)
	)
		return 'calculatedConsumption must be a non-negative finite number';
	return null;
}

export class FuelLogRepository {
	async saveFuelLog(entry: NewFuelLog): Promise<Result<FuelLog>> {
		const validationError = validateNewFuelLog(entry);
		if (validationError) return err('VALIDATION_ERROR', validationError);
		try {
			const id = await db.fuelLogs.add({ ...entry } as FuelLog);
			const saved = await db.fuelLogs.get(id as number);
			if (!saved) return err('SAVE_FAILED', 'Record not found after insert');
			return ok(saved);
		} catch (e) {
			return err('SAVE_FAILED', String(e));
		}
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

	async updateFuelLog(id: number, changes: Partial<NewFuelLog>): Promise<Result<FuelLog>> {
		const validationError = validatePartialFuelLog(changes);
		if (validationError) return err('VALIDATION_ERROR', validationError);
		try {
			const count = await db.fuelLogs.update(id, changes);
			if (count === 0) return err('NOT_FOUND', `FuelLog ${id} not found`);
			const updated = await db.fuelLogs.get(id);
			if (!updated) return err('UPDATE_FAILED', 'Record not found after update');
			return ok(updated);
		} catch (e) {
			return err('UPDATE_FAILED', String(e));
		}
	}

	async updateFuelLogsAtomic(
		patches: Array<{ id: number; changes: Partial<NewFuelLog> }>
	): Promise<Result<FuelLog[]>> {
		for (const patch of patches) {
			const validationError = validatePartialFuelLog(patch.changes);
			if (validationError) return err('VALIDATION_ERROR', validationError);
		}

		try {
			const updatedLogs = await db.transaction('rw', db.fuelLogs, async () => {
				for (const patch of patches) {
					const count = await db.fuelLogs.update(patch.id, patch.changes);
					if (count === 0) {
						throw new Error(`NOT_FOUND:${patch.id}`);
					}
				}

				const refreshedLogs = await db.fuelLogs.bulkGet(patches.map((patch) => patch.id));
				if (refreshedLogs.some((log) => !log)) {
					throw new Error('UPDATE_FAILED:Record not found after update');
				}

				return refreshedLogs as FuelLog[];
			});

			return ok(updatedLogs);
		} catch (error) {
			const message = String(error);
			if (message.startsWith('Error: NOT_FOUND:')) {
				const missingId = message.replace('Error: NOT_FOUND:', '');
				return err('NOT_FOUND', `FuelLog ${missingId} not found`);
			}

			return err('UPDATE_FAILED', message);
		}
	}

	async deleteFuelLog(
		id: number
	): Promise<Result<{ deletedLogId: number; updatedLogs: FuelLog[] }>> {
		try {
			const deleteResult = await db.transaction('rw', db.fuelLogs, async () => {
				const targetLog = await db.fuelLogs.get(id);
				if (!targetLog) {
					throw new Error(`NOT_FOUND:${id}`);
				}

				const timelineLogs = await db.fuelLogs
					.where('vehicleId')
					.equals(targetLog.vehicleId)
					.toArray();
				const deletionPlan = buildFuelLogDeletionPlan(timelineLogs, id);

				await db.fuelLogs.delete(id);

				for (const patch of deletionPlan) {
					const validationError = validatePartialFuelLog(patch.changes);
					if (validationError) {
						throw new Error(`VALIDATION_ERROR:${validationError}`);
					}

					const count = await db.fuelLogs.update(patch.id, patch.changes);
					if (count === 0) {
						throw new Error(`NOT_FOUND:${patch.id}`);
					}
				}

				const updatedLogs =
					deletionPlan.length === 0
						? []
						: await db.fuelLogs.bulkGet(deletionPlan.map((patch) => patch.id));

				if (updatedLogs.some((log) => !log)) {
					throw new Error('DELETE_FAILED:Record not found after update');
				}

				return {
					deletedLogId: id,
					updatedLogs: updatedLogs as FuelLog[]
				};
			});

			return ok(deleteResult);
		} catch (e) {
			const message = String(e);
			if (message.startsWith('Error: NOT_FOUND:')) {
				const missingId = message.replace('Error: NOT_FOUND:', '');
				return err('NOT_FOUND', `FuelLog ${missingId} not found`);
			}
			if (message.startsWith('Error: VALIDATION_ERROR:')) {
				return err('VALIDATION_ERROR', message.replace('Error: VALIDATION_ERROR:', ''));
			}

			return err('DELETE_FAILED', message);
		}
	}
}

export const fuelLogRepository = new FuelLogRepository();

// Convenience function exports — delegate to repository instance for backward compatibility
export const saveFuelLog = (entry: NewFuelLog) => fuelLogRepository.saveFuelLog(entry);
export const getFuelLogById = (id: number) => fuelLogRepository.getFuelLogById(id);
export const getAllFuelLogs = (vehicleId?: number) => fuelLogRepository.getAllFuelLogs(vehicleId);
export const updateFuelLog = (id: number, changes: Partial<NewFuelLog>) =>
	fuelLogRepository.updateFuelLog(id, changes);
export const updateFuelLogsAtomic = (
	patches: Array<{ id: number; changes: Partial<NewFuelLog> }>
) => fuelLogRepository.updateFuelLogsAtomic(patches);
export const deleteFuelLog = (id: number) => fuelLogRepository.deleteFuelLog(id);
