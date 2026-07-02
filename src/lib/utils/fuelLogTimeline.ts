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

function recalculateSortedFuelLogs(logs: FuelLog[]): FuelLog[] {
	const sortedLogs = sortFuelLogsForTimeline(logs);

	// Consumption is measured full-fill → full-fill (Story 7.1). A partial fill defers its own value
	// (0) and rolls its litres + distance into the next full fill's span; a `precededByMissedFill`
	// interval is unreliable (0) and re-anchors the span. `anchor` is the odometer the current open
	// span is measured FROM (the last trustworthy full-fill reading); `carriedQuantity` is the litres
	// of partials accumulated since that anchor, waiting for the next full fill to close the interval.
	// Flags are coerced `?? false` so v1–v4 rows (and rows restored from a v4 backup, which never run
	// the v5 upgrade) behave exactly as before: every fill full, none missed → identical to v4 output.
	let anchor: { odometer: number; distanceUnit: 'km' | 'mi' } | undefined;
	let carriedQuantity = 0;

	return sortedLogs.map((log) => {
		const isPartial = log.isPartialFill ?? false;
		const missed = log.precededByMissedFill ?? false;

		let consumption: number;
		if (missed || isPartial) {
			// Missed → interval spans an unknown tank; partial → deferred to the next full fill.
			consumption = 0;
		} else if (!anchor || anchor.distanceUnit !== log.distanceUnit) {
			// First-ever fill, or a unit change that breaks the span → no comparable predecessor.
			consumption = 0;
		} else {
			// Full fill closing the open span: distance since the anchor, litres = carried partials +
			// this fill. Reuses calculateConsumption (non-positive distance/quantity → 0, PREP-1 finite).
			consumption = calculateConsumption(
				log.odometer,
				anchor.odometer,
				carriedQuantity + log.quantity,
				log.unit
			);
		}

		// Advance the span state AFTER computing this fill's value.
		if (missed) {
			// Span broken → re-anchor here (this reading is trustworthy again). If also partial, its
			// litres start the new carry; otherwise it's a clean full-fill anchor.
			anchor = { odometer: log.odometer, distanceUnit: log.distanceUnit };
			carriedQuantity = isPartial ? log.quantity : 0;
		} else if (isPartial) {
			// Keep the span open and accumulate. A partial as the first-ever fill anchors here so the
			// next full fill can measure the distance from it.
			if (!anchor) {
				anchor = { odometer: log.odometer, distanceUnit: log.distanceUnit };
			}
			carriedQuantity += log.quantity;
		} else {
			// Full fill (incl. first-ever / unit-change): closes the span, becomes the new anchor.
			anchor = { odometer: log.odometer, distanceUnit: log.distanceUnit };
			carriedQuantity = 0;
		}

		return { ...log, calculatedConsumption: consumption };
	});
}

export function recalculateFuelLogTimeline(logs: FuelLog[], updatedLog: FuelLog): FuelLog[] {
	const nextLogs = [...logs.filter((log) => log.id !== updatedLog.id), updatedLog];
	return recalculateSortedFuelLogs(nextLogs);
}

// Span-aware consumption for a full set of logs, sorted into timeline order. The single public entry
// point for bulk (re)computation — used by the CSV importer (Story 7.1) so imported partial/missed
// fills defer/zero exactly like live edits, keeping the timeline engine (AD-DA-3) the sole owner of
// the math. Returns the logs in timeline order with `calculatedConsumption` filled.
export function recalculateFuelLogConsumptions(logs: FuelLog[]): FuelLog[] {
	return recalculateSortedFuelLogs(logs);
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
				calculatedConsumption: log.calculatedConsumption,
				// Story 7.1 — persist the edited fill-quality flags for the updated row (coerced so a
				// pre-v5 row edited without touching them stays explicit `false`, not `undefined`).
				isPartialFill: log.isPartialFill ?? false,
				precededByMissedFill: log.precededByMissedFill ?? false
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
