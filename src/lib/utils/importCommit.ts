// ARCH-EXCEPTION: Direct db import for multi-table atomic transaction
// Individual repository save functions cannot be wrapped in a single cross-table transaction
import { db } from '$lib/db/db';
import type { NewFuelLog, NewExpense, Vehicle, FuelLog } from '$lib/db/schema';
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
import { encodeSentinel, decodeSentinel } from '$lib/db/writeSkeleton';
import {
	validateNewVehicle,
	validateNewFuelLog,
	validateNewExpense
} from '$lib/db/validators/rowValidation';
import { recalculateFuelLogConsumptions } from '$lib/utils/fuelLogTimeline';
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
	onProgress?: (current: number, total: number) => void,
	// Rows already excluded from `rows` by an earlier wizard step (Review's per-row/skip-all skip,
	// AC2; the duplicate-detection keep/skip choice, AC1) — folded into the one final skippedCount
	// so the displayed total is honest about every row that never reached the database, not just the
	// last stage that touched it.
	externalSkippedCount = 0
): Promise<Result<ImportCommitResult>> {
	// Imported rows carry no currency metadata (3rd-party CSVs don't include it), so they
	// adopt the user's home currency. Per-row currency import is a future enhancement.
	const homeCurrency = getSettings().currency || DEFAULT_CURRENCY;

	// Step 1: MAX_VEHICLES pre-check — a cheap early UX guard before any parsing work below. The
	// transactional path (Step 5) is authoritative: it is the only check that can see vehicles
	// created earlier in the SAME commit and cannot be bypassed by a concurrent write.
	const existingCount = await db.vehicles.count();
	const newVehicleCount = assignments.filter((a) => a.assignmentType === 'new').length;
	if (existingCount + newVehicleCount > MAX_VEHICLES) {
		return err(
			'MAX_VEHICLES',
			`Cannot create ${newVehicleCount} new vehicle(s). You already have ${existingCount} of ${MAX_VEHICLES} vehicles.`
		);
	}

	// Step 2: filter importable rows (valid or warning, exclude error).
	const importableRows = rows.filter((r) => r.status === 'valid' || r.status === 'warning');
	const preCommitSkippedCount = rows.length - importableRows.length;

	if (importableRows.length === 0) {
		return ok({
			fuelCount: 0,
			maintenanceCount: 0,
			skippedCount: preCommitSkippedCount + externalSkippedCount,
			vehiclesCreated: [],
			vehiclesMatched: [],
			totalImported: 0
		});
	}

	// Step 3: separate fuel/maintenance rows BY VEHICLE NAME. Real vehicle ids do not exist yet for
	// `new` assignments — those are only minted inside the transaction below (ADR-006 AD-WB-3, H6),
	// so name is the stable key until then. A row naming a vehicle absent from `assignments`
	// entirely is a caller-contract bug, not a data problem — fail fast before any DB work.
	const fuelEntries: Array<{ row: ImportRow; vehicleName: string }> = [];
	const maintenanceEntries: Array<{ row: ImportRow; vehicleName: string }> = [];

	for (const row of importableRows) {
		const vehicleName = row.data.sourceVehicleName || 'Unknown Vehicle';
		if (!assignments.some((a) => a.sourceVehicleName === vehicleName)) {
			return err('IMPORT_FAILED', `No vehicle assignment found for "${vehicleName}"`);
		}

		if (row.data.type === 'maintenance') {
			maintenanceEntries.push({ row, vehicleName });
		} else {
			fuelEntries.push({ row, vehicleName });
		}
	}

	// Step 3.5: exclude rows that will fail the repo-grade validator on fields independent of
	// vehicleId (odometer/quantity positivity, unit pairing) BEFORE they enter Step 4's consumption
	// pass. A row that fails commit-time validation is never written (Step 5), but the timeline
	// engine runs over the WHOLE per-vehicle group — a bad row left in that group can still become
	// another (valid, persisted) row's anchor, silently poisoning its calculatedConsumption even
	// though the bad row itself never reaches the DB (ADR-006 AD-WB-3: a rejected row must not
	// influence a persisted row's data, not just avoid being persisted itself). vehicleId is not yet
	// assigned at this stage (vehicles are created inside the Step 5 transaction), so a placeholder
	// positive id is used purely to exercise the OTHER field checks — it is always valid once
	// substituted with the real id, so it cannot mask a genuine vehicleId-related rejection.
	const validFuelEntries: typeof fuelEntries = [];
	let preConsumptionRejectedCount = 0;
	for (const entry of fuelEntries) {
		const fieldCandidate: NewFuelLog = {
			vehicleId: 1,
			date: entry.row.data.date!,
			odometer: entry.row.data.odometer ?? 0,
			quantity: entry.row.data.quantity ?? 0,
			unit: entry.row.data.unit ?? 'L',
			distanceUnit: entry.row.data.distanceUnit ?? 'km',
			totalCost: finiteOr0(entry.row.data.totalCost),
			calculatedConsumption: 0,
			isPartialFill: entry.row.data.isPartialFill ?? false,
			precededByMissedFill: entry.row.data.precededByMissedFill ?? false
		};
		if (validateNewFuelLog(fieldCandidate)) {
			preConsumptionRejectedCount++;
		} else {
			validFuelEntries.push(entry);
		}
	}

	// Step 4: calculate consumption for fuel rows via the shared timeline engine (Story 7.1), so
	// imported partial/missed fills defer/zero exactly like live edits (AD-DA-3) — a naive
	// per-predecessor pass would surface false-low numbers on missed fills and noise on partials.
	// Grouped by vehicle NAME — the engine only needs rows partitioned per vehicle, not real ids,
	// so this stays outside the transaction (pure, no DB access).
	const consumptionMap = new Map<ImportRow, number>();
	const byVehicleName = new Map<string, Array<{ row: ImportRow; vehicleName: string }>>();
	for (const entry of validFuelEntries) {
		const group = byVehicleName.get(entry.vehicleName) || [];
		group.push(entry);
		byVehicleName.set(entry.vehicleName, group);
	}

	for (const group of byVehicleName.values()) {
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
				vehicleId: 0, // synthetic grouping only — the real id is assigned inside the transaction
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

	// Step 5: single atomic transaction — vehicles + fuelLogs + expenses (ADR-006 AD-WB-3). A
	// mid-commit failure now rolls back ANY vehicles created in this attempt too, so it can never
	// orphan a vehicle with zero rows, and a Retry creates it fresh rather than duplicating it (H6).
	// Every fuel/expense row is validated with the shared repo-grade validators before `add` (H3) —
	// a row the repo would reject (e.g. unpaired L+mi, non-positive odometer/quantity) is excluded
	// and counted as skipped, never half-written.
	const vehiclesCreated: string[] = [];
	const vehiclesMatched: string[] = [];
	let commitRejectedCount = preConsumptionRejectedCount;
	let fuelCount = 0;
	let maintenanceCount = 0;
	const totalRows = validFuelEntries.length + maintenanceEntries.length;
	let currentProgress = 0;

	try {
		await db.transaction('rw', db.vehicles, db.fuelLogs, db.expenses, async () => {
			const vehicleNameToId = new Map<string, number>();

			for (const assignment of assignments) {
				if (assignment.assignmentType === 'existing' && assignment.existingVehicleId != null) {
					vehicleNameToId.set(assignment.sourceVehicleName, assignment.existingVehicleId);
					vehiclesMatched.push(assignment.sourceVehicleName);
				} else if (assignment.assignmentType === 'new' && assignment.newVehicle) {
					const validationError = validateNewVehicle(assignment.newVehicle);
					if (validationError) {
						throw encodeSentinel(
							'VEHICLE_CREATE_FAILED',
							`Failed to create vehicle "${assignment.sourceVehicleName}": ${validationError}`
						);
					}
					// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dexie auto-generates id
					const id = await db.vehicles.add({ ...assignment.newVehicle } as any as Vehicle);
					vehicleNameToId.set(assignment.sourceVehicleName, id as number);
					vehiclesCreated.push(assignment.sourceVehicleName);
				}
			}

			for (const entry of validFuelEntries) {
				const vehicleId = vehicleNameToId.get(entry.vehicleName);
				if (vehicleId == null) {
					throw encodeSentinel(
						'IMPORT_FAILED',
						`No vehicle assignment found for "${entry.vehicleName}"`
					);
				}

				const newFuelLog: NewFuelLog = {
					vehicleId,
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

				if (validateNewFuelLog(newFuelLog)) {
					commitRejectedCount++;
				} else {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dexie auto-generates id
					await db.fuelLogs.add(newFuelLog as any);
					fuelCount++;
				}
				currentProgress++;
				onProgress?.(currentProgress, totalRows);
			}

			for (const entry of maintenanceEntries) {
				const vehicleId = vehicleNameToId.get(entry.vehicleName);
				if (vehicleId == null) {
					throw encodeSentinel(
						'IMPORT_FAILED',
						`No vehicle assignment found for "${entry.vehicleName}"`
					);
				}

				const newExpense: NewExpense = {
					vehicleId,
					date: entry.row.data.date!,
					type: entry.row.data.maintenanceType || 'Imported',
					odometer: entry.row.data.odometer || undefined,
					cost: finiteOr0(entry.row.data.totalCost),
					currency: homeCurrency,
					notes: entry.row.data.notes || undefined
				};

				if (validateNewExpense(newExpense)) {
					commitRejectedCount++;
				} else {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dexie auto-generates id
					await db.expenses.add(newExpense as any);
					maintenanceCount++;
				}
				currentProgress++;
				onProgress?.(currentProgress, totalRows);
			}
		});
	} catch (e) {
		const decoded = decodeSentinel(e);
		if (decoded) return err(decoded.code, decoded.detail);
		if (isQuotaExceededError(e)) return err(QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE);
		return err('IMPORT_FAILED', String(e));
	}

	// Imported fuel/expense/vehicle rows are written via a direct atomic transaction (not the
	// repositories), so signal other tabs once here.
	notifyDataChanged();
	return ok({
		fuelCount,
		maintenanceCount,
		skippedCount: preCommitSkippedCount + commitRejectedCount + externalSkippedCount,
		vehiclesCreated,
		vehiclesMatched,
		totalImported: fuelCount + maintenanceCount
	});
}
