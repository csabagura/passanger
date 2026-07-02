// ARCH-EXCEPTION: Direct db import for multi-table atomic transaction
// Individual repository save functions cannot be wrapped in a single cross-table transaction
import { db } from '$lib/db/db';
import type { NewFuelLog, NewExpense } from '$lib/db/schema';
import { saveVehicle } from '$lib/db/repositories/vehicles';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import { MAX_VEHICLES, DEFAULT_CURRENCY } from '$lib/config';
import { getSettings } from '$lib/utils/settings';
import { notifyDataChanged } from '$lib/utils/tabSync';
import {
	isQuotaExceededError,
	QUOTA_EXCEEDED_CODE,
	QUOTA_EXCEEDED_MESSAGE
} from '$lib/db/dbErrors';
import { recalculateFuelLogConsumptions } from '$lib/utils/fuelLogTimeline';
import type { FuelLog } from '$lib/db/schema';
import type { ImportRow, VehicleAssignment, ImportCommitResult } from '$lib/utils/importTypes';
import { isFiniteNumber } from '$lib/utils/calculations';

// Commit-boundary coercion for costs: `?? 0` lets NaN through (nullish covers only
// null/undefined), and a NaN written to Dexie renders as '€NaN' on every surface.
function finiteOr0(value: number | null | undefined): number {
	return isFiniteNumber(value) ? value : 0;
}

export async function commitImportRows(
	rows: ImportRow[],
	assignments: VehicleAssignment[],
	onProgress?: (current: number, total: number) => void
): Promise<Result<ImportCommitResult>> {
	// Imported rows carry no currency metadata (3rd-party CSVs don't include it), so they
	// adopt the user's home currency. Per-row currency import is a future enhancement.
	const homeCurrency = getSettings().currency || DEFAULT_CURRENCY;

	// Step 1: Check MAX_VEHICLES before creating any
	const existingCount = await db.vehicles.count();
	const newVehicleCount = assignments.filter((a) => a.assignmentType === 'new').length;
	if (existingCount + newVehicleCount > MAX_VEHICLES) {
		return err(
			'MAX_VEHICLES',
			`Cannot create ${newVehicleCount} new vehicle(s). You already have ${existingCount} of ${MAX_VEHICLES} vehicles.`
		);
	}

	// Step 2: Create new vehicles (outside transaction — needs MAX_VEHICLES check)
	const vehicleNameToId = new Map<string, number>();
	const vehiclesCreated: string[] = [];
	const vehiclesMatched: string[] = [];

	for (const assignment of assignments) {
		if (assignment.assignmentType === 'existing' && assignment.existingVehicleId != null) {
			vehicleNameToId.set(assignment.sourceVehicleName, assignment.existingVehicleId);
			vehiclesMatched.push(assignment.sourceVehicleName);
		} else if (assignment.assignmentType === 'new' && assignment.newVehicle) {
			const result = await saveVehicle(assignment.newVehicle);
			if (result.error) {
				return err(
					'VEHICLE_CREATE_FAILED',
					`Failed to create vehicle "${assignment.sourceVehicleName}": ${result.error.message}`
				);
			}
			vehicleNameToId.set(assignment.sourceVehicleName, result.data.id);
			vehiclesCreated.push(assignment.sourceVehicleName);
		}
	}

	// Step 3: Filter importable rows (valid or warning, exclude error)
	const importableRows = rows.filter((r) => r.status === 'valid' || r.status === 'warning');
	const skippedCount = rows.length - importableRows.length;

	if (importableRows.length === 0) {
		return ok({
			fuelCount: 0,
			maintenanceCount: 0,
			skippedCount,
			vehiclesCreated,
			vehiclesMatched,
			totalImported: 0
		});
	}

	// Step 4: Separate fuel and maintenance rows, resolve vehicle IDs
	const fuelEntries: Array<{ row: ImportRow; vehicleId: number }> = [];
	const maintenanceEntries: Array<{ row: ImportRow; vehicleId: number }> = [];

	for (const row of importableRows) {
		const vehicleName = row.data.sourceVehicleName || 'Unknown Vehicle';
		const vehicleId = vehicleNameToId.get(vehicleName);
		if (vehicleId == null) {
			return err('IMPORT_FAILED', `No vehicle assignment found for "${vehicleName}"`);
		}

		if (row.data.type === 'maintenance') {
			maintenanceEntries.push({ row, vehicleId });
		} else {
			fuelEntries.push({ row, vehicleId });
		}
	}

	// Step 5: Calculate consumption for fuel rows via the shared timeline engine (Story 7.1), so
	// imported partial/missed fills defer/zero exactly like live edits (AD-DA-3) — a naive
	// per-predecessor pass would surface false-low numbers on missed fills and noise on partials.
	// Group by vehicleId; build synthetic FuelLogs (index-based ids) the engine can sort + span.
	const consumptionMap = new Map<ImportRow, number>();
	const byVehicle = new Map<number, Array<{ row: ImportRow; vehicleId: number }>>();
	for (const entry of fuelEntries) {
		const group = byVehicle.get(entry.vehicleId) || [];
		group.push(entry);
		byVehicle.set(entry.vehicleId, group);
	}

	for (const [vehicleId, group] of byVehicle) {
		// Order by odometer (the import spine — 3rd-party CSV dates are often day-granular and tie),
		// then hand the engine synthetic monotonic dates + ids in that order so its date-then-id sort
		// preserves the odometer order. The engine's flag-aware span math then defers partials / zeroes
		// missed intervals; the real per-row date is used later when the NewFuelLog is built.
		const ordered = [...group].sort(
			(a, b) => (a.row.data.odometer ?? 0) - (b.row.data.odometer ?? 0)
		);
		const rowBySyntheticId = new Map<number, ImportRow>();
		const synthetic: FuelLog[] = ordered.map((entry, index) => {
			const syntheticId = index + 1;
			rowBySyntheticId.set(syntheticId, entry.row);
			return {
				id: syntheticId,
				vehicleId,
				date: new Date(syntheticId), // synthetic monotonic ordering key only — NOT the stored date
				odometer: entry.row.data.odometer ?? 0,
				quantity: entry.row.data.quantity ?? 0,
				unit: entry.row.data.unit ?? 'L',
				distanceUnit: entry.row.data.distanceUnit ?? 'km',
				totalCost: finiteOr0(entry.row.data.totalCost),
				calculatedConsumption: 0,
				isPartialFill: entry.row.data.isPartialFill ?? false,
				precededByMissedFill: entry.row.data.precededByMissedFill ?? false
			};
		});

		for (const log of recalculateFuelLogConsumptions(synthetic)) {
			const row = rowBySyntheticId.get(log.id);
			if (row) {
				consumptionMap.set(row, log.calculatedConsumption);
			}
		}
	}

	// Step 6: Atomic transaction — commit all fuelLogs + expenses
	const totalRows = fuelEntries.length + maintenanceEntries.length;
	let currentProgress = 0;

	try {
		await db.transaction('rw', db.fuelLogs, db.expenses, async () => {
			for (const entry of fuelEntries) {
				const newFuelLog: NewFuelLog = {
					vehicleId: entry.vehicleId,
					date: entry.row.data.date!,
					odometer: entry.row.data.odometer!,
					quantity: entry.row.data.quantity!,
					unit: entry.row.data.unit!,
					distanceUnit: entry.row.data.distanceUnit!,
					totalCost: finiteOr0(entry.row.data.totalCost),
					currency: homeCurrency,
					calculatedConsumption: consumptionMap.get(entry.row) ?? 0,
					isPartialFill: entry.row.data.isPartialFill ?? false,
					precededByMissedFill: entry.row.data.precededByMissedFill ?? false,
					notes: entry.row.data.notes || undefined
				};
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dexie auto-generates id for auto-increment tables
				await db.fuelLogs.add(newFuelLog as any);
				currentProgress++;
				onProgress?.(currentProgress, totalRows);
			}

			for (const entry of maintenanceEntries) {
				const newExpense: NewExpense = {
					vehicleId: entry.vehicleId,
					date: entry.row.data.date!,
					type: entry.row.data.maintenanceType || 'Imported',
					odometer: entry.row.data.odometer || undefined,
					cost: finiteOr0(entry.row.data.totalCost),
					currency: homeCurrency,
					notes: entry.row.data.notes || undefined
				};
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dexie auto-generates id for auto-increment tables
				await db.expenses.add(newExpense as any);
				currentProgress++;
				onProgress?.(currentProgress, totalRows);
			}
		});
	} catch (e) {
		if (isQuotaExceededError(e)) return err(QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE);
		return err('IMPORT_FAILED', String(e));
	}

	// Imported fuel/expense rows are written via a direct atomic transaction (not the repositories),
	// so signal other tabs once here. New vehicles went through saveVehicle, which already signalled.
	notifyDataChanged();
	return ok({
		fuelCount: fuelEntries.length,
		maintenanceCount: maintenanceEntries.length,
		skippedCount,
		vehiclesCreated,
		vehiclesMatched,
		totalImported: fuelEntries.length + maintenanceEntries.length
	});
}
