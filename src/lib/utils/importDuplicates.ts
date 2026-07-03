// Import duplicate detection — Story 8.3 AC1 (H7).
// Detects rows destined for an EXISTING vehicle that already exist in that vehicle's persisted
// fuelLogs, so re-importing the same export doesn't silently double a user's history. Rows
// destined for a newly-created vehicle are never checked (a brand-new vehicle can't already
// contain the row).

import { getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
import type { ImportRow, VehicleAssignment } from '$lib/utils/importTypes';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';

export interface DuplicateCheckResult {
	duplicateRowNumbers: Set<number>;
}

function dayKey(date: Date): string {
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Checks import rows assigned to EXISTING vehicles against that vehicle's already-persisted
 * fuelLogs, flagging an exact match of (vehicleId, date-at-day-precision, odometer) as a
 * duplicate. Rows assigned to a NEW vehicle are skipped entirely — they cannot be duplicates by
 * construction. Only fuel-type rows are checked (the persisted table being compared against is
 * fuelLogs; maintenance rows land in expenses and have no equivalent check here).
 */
export async function findDuplicateRows(
	rows: ImportRow[],
	assignments: VehicleAssignment[]
): Promise<Result<DuplicateCheckResult>> {
	const existingVehicleIdByName = new Map<string, number>();
	for (const assignment of assignments) {
		if (assignment.assignmentType === 'existing' && assignment.existingVehicleId != null) {
			existingVehicleIdByName.set(assignment.sourceVehicleName, assignment.existingVehicleId);
		}
	}

	if (existingVehicleIdByName.size === 0) {
		return ok({ duplicateRowNumbers: new Set() });
	}

	// One fuelLogs read per existing vehicle, built into a lookup keyed by (day, odometer).
	const existingKeysByVehicleId = new Map<number, Set<string>>();
	for (const vehicleId of new Set(existingVehicleIdByName.values())) {
		const result = await getAllFuelLogs(vehicleId);
		if (result.error) return err(result.error.code, result.error.message);
		const keys = new Set<string>();
		for (const log of result.data) {
			keys.add(`${dayKey(log.date)}|${log.odometer}`);
		}
		existingKeysByVehicleId.set(vehicleId, keys);
	}

	const duplicateRowNumbers = new Set<number>();
	for (const row of rows) {
		if (row.data.type === 'maintenance') continue;
		const vehicleName = row.data.sourceVehicleName || 'Unknown Vehicle';
		const vehicleId = existingVehicleIdByName.get(vehicleName);
		if (vehicleId == null) continue; // new-vehicle assignment (or unassigned) — never a duplicate
		if (!(row.data.date instanceof Date) || isNaN(row.data.date.getTime())) continue;
		if (row.data.odometer == null || isNaN(row.data.odometer)) continue;

		const key = `${dayKey(row.data.date)}|${row.data.odometer}`;
		if (existingKeysByVehicleId.get(vehicleId)?.has(key)) {
			duplicateRowNumbers.add(row.rowNumber);
		}
	}

	return ok({ duplicateRowNumbers });
}
