import type { FuelLog, NewFuelLog } from '$lib/db/schema';
import { calculateConsumption } from '$lib/utils/calculations';

export interface FuelLogUpdatePatch {
	id: number;
	changes: Partial<NewFuelLog>;
}

export function sortFuelLogsForTimeline(logs: FuelLog[]): FuelLog[] {
	return [...logs].sort((left, right) => {
		const dateDifference = left.date.getTime() - right.date.getTime();
		return dateDifference !== 0 ? dateDifference : left.id - right.id;
	});
}

export function getFuelLogPredecessor(logs: FuelLog[], logId: number): FuelLog | undefined {
	const sortedLogs = sortFuelLogsForTimeline(logs);
	const logIndex = sortedLogs.findIndex((log) => log.id === logId);

	return logIndex > 0 ? sortedLogs[logIndex - 1] : undefined;
}

export function getFuelLogSuccessor(logs: FuelLog[], logId: number): FuelLog | undefined {
	const sortedLogs = sortFuelLogsForTimeline(logs);
	const logIndex = sortedLogs.findIndex((log) => log.id === logId);

	return logIndex >= 0 && logIndex < sortedLogs.length - 1 ? sortedLogs[logIndex + 1] : undefined;
}

function calculateTimelineConsumption(log: FuelLog, predecessor?: FuelLog): number {
	if (!predecessor || predecessor.distanceUnit !== log.distanceUnit) {
		return 0;
	}

	return calculateConsumption(log.odometer, predecessor.odometer, log.quantity, log.unit);
}

function recalculateSortedFuelLogs(logs: FuelLog[]): FuelLog[] {
	const sortedLogs = sortFuelLogsForTimeline(logs);

	return sortedLogs.map((log, index) => ({
		...log,
		calculatedConsumption: calculateTimelineConsumption(log, sortedLogs[index - 1])
	}));
}

export function recalculateFuelLogTimeline(logs: FuelLog[], updatedLog: FuelLog): FuelLog[] {
	const nextLogs = [...logs.filter((log) => log.id !== updatedLog.id), updatedLog];
	return recalculateSortedFuelLogs(nextLogs);
}

export function buildFuelLogUpdatePlan(
	originalLogs: FuelLog[],
	updatedLog: FuelLog
): FuelLogUpdatePatch[] {
	const originalLogsById = new Map(originalLogs.map((log) => [log.id, log]));
	const recalculatedLogs = recalculateFuelLogTimeline(originalLogs, updatedLog);

	return recalculatedLogs.flatMap((log) => {
		const originalLog = originalLogsById.get(log.id);
		if (!originalLog) {
			return [];
		}

		if (log.id === updatedLog.id) {
			const changes: Partial<NewFuelLog> = {
				date: log.date,
				odometer: log.odometer,
				quantity: log.quantity,
				unit: log.unit,
				distanceUnit: log.distanceUnit,
				totalCost: log.totalCost,
				calculatedConsumption: log.calculatedConsumption
			};

			if (log.notes !== undefined) {
				changes.notes = log.notes;
			}

			return [{ id: log.id, changes }];
		}

		if (originalLog.calculatedConsumption === log.calculatedConsumption) {
			return [];
		}

		return [
			{
				id: log.id,
				changes: {
					calculatedConsumption: log.calculatedConsumption
				}
			}
		];
	});
}

export function buildFuelLogDeletionPlan(
	originalLogs: FuelLog[],
	deletedLogId: number
): FuelLogUpdatePatch[] {
	const originalLogsById = new Map(originalLogs.map((log) => [log.id, log]));
	const recalculatedLogs = recalculateSortedFuelLogs(
		originalLogs.filter((log) => log.id !== deletedLogId)
	);

	return recalculatedLogs.flatMap((log) => {
		const originalLog = originalLogsById.get(log.id);
		if (!originalLog || originalLog.calculatedConsumption === log.calculatedConsumption) {
			return [];
		}

		return [
			{
				id: log.id,
				changes: {
					calculatedConsumption: log.calculatedConsumption
				}
			}
		];
	});
}
