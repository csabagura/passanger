// ARCH-EXCEPTION: direct db import for a single-vehicle scoped read and a cross-table atomic
// remap-import — neither fits a single repository method (they span vehicles + all three child
// tables in one transaction). Mirrors db/backup.ts and utils/importCommit.ts.
import { db } from './db';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { ServiceReminder } from './schema';
import { MAX_VEHICLES } from '$lib/config';
import { notifyDataChanged } from '$lib/utils/tabSync';
import { isQuotaExceededError, QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE } from './dbErrors';
import { encodeSentinel, decodeSentinel } from './writeSkeleton';
import {
	validateNewVehicle,
	validateNewFuelLog,
	validateNewExpense,
	validateNewServiceReminder
} from './validators/rowValidation';
import type { VehicleShareData } from '$lib/utils/vehicleShare';

// Rows written by a successful import — one count per child table, plus the new vehicle's minted id.
export interface VehicleImportResult {
	vehicleId: number;
	vehicleName: string;
	fuelLogs: number;
	expenses: number;
	serviceReminders: number;
}

// Read ONE vehicle plus its owned rows inside a single read transaction, so the snapshot is
// internally consistent (a concurrent write can't tear it into a dangling-FK state). Every row is
// validated through the SAME shared validators the repositories use (mirrors exportAllTables' guard,
// db/backup.ts): a corrupt row (e.g. a NaN numeric, which JSON.stringify turns into `null` —
// unrestorable) must block the export with a truthful message, never ship an unimportable file.
export async function exportVehicleTables(vehicleId: number): Promise<Result<VehicleShareData>> {
	try {
		const snapshot = await db.transaction(
			'r',
			db.vehicles,
			db.fuelLogs,
			db.expenses,
			db.serviceReminders,
			async () => {
				const vehicle = await db.vehicles.get(vehicleId);
				if (!vehicle) return null;
				const [fuelLogs, expenses, serviceReminders] = await Promise.all([
					db.fuelLogs.where('vehicleId').equals(vehicleId).toArray(),
					db.expenses.where('vehicleId').equals(vehicleId).toArray(),
					db.serviceReminders.where('vehicleId').equals(vehicleId).toArray()
				]);
				return { vehicle, fuelLogs, expenses, serviceReminders };
			}
		);

		if (!snapshot) return err('NOT_FOUND', `Vehicle ${vehicleId} not found`);

		const corrupt: string[] = [];
		if (validateNewVehicle(snapshot.vehicle) !== null) corrupt.push('the vehicle row');
		const invalidFuelLogs = snapshot.fuelLogs.filter((r) => validateNewFuelLog(r) !== null).length;
		if (invalidFuelLogs > 0) corrupt.push(`${invalidFuelLogs} fuel log row(s)`);
		const invalidExpenses = snapshot.expenses.filter((r) => validateNewExpense(r) !== null).length;
		if (invalidExpenses > 0) corrupt.push(`${invalidExpenses} expense row(s)`);
		const invalidReminders = snapshot.serviceReminders.filter(
			(r) => validateNewServiceReminder(r) !== null
		).length;
		if (invalidReminders > 0) corrupt.push(`${invalidReminders} service reminder row(s)`);

		if (corrupt.length > 0) {
			return err(
				'VALIDATION_ERROR',
				`Export blocked: ${corrupt.join(', ')} failed validation — fix or delete before exporting.`
			);
		}

		return ok(snapshot);
	} catch (e) {
		return err('GET_FAILED', String(e));
	}
}

// Drop the inbound primary key so Dexie auto-increments a fresh one on add — the essence of a MERGE
// import (never reuse a stranger's id namespace, which restoreAllTables' bulkPut would).
function stripId<T extends { id: number }>(row: T): Omit<T, 'id'> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- id intentionally discarded
	const { id, ...rest } = row;
	return rest;
}

// The crux (AC2/3/4). Add the vehicle → capture its minted id → remap every child's `vehicleId` to
// it, REGENERATING each child's primary key so nothing clobbers the recipient's existing rows. The
// only intra-payload cross-FK — ServiceReminder.lastClosedByExpenseId (Story 8.5 loop-close
// provenance, an EXPENSE id) — is remapped through the old→new expense-id map built during the
// expense pass, or dropped if it can't be mapped (never left dangling at a stranger's expense).
// Everything runs in ONE rw transaction (ADR-006 AD-WB-3): a mid-commit failure rolls back the
// vehicle too, so it can never orphan a vehicle with zero rows or half-write children.
export async function importVehicleShare(
	data: VehicleShareData
): Promise<Result<VehicleImportResult>> {
	try {
		const result = await db.transaction(
			'rw',
			db.vehicles,
			db.fuelLogs,
			db.expenses,
			db.serviceReminders,
			async () => {
				// AC4 / AD-VA-4: the authoritative cap check, in-transaction, counting ACTIVE vehicles
				// only (archived rows never occupy a slot). A per-car import always adds exactly one
				// active vehicle, so `+1`.
				const activeCount = await db.vehicles.filter((v) => !v.isArchived).count();
				if (activeCount + 1 > MAX_VEHICLES) {
					throw encodeSentinel(
						'MAX_VEHICLES',
						`You already have ${activeCount} of ${MAX_VEHICLES} vehicles. Archive or delete one before importing.`
					);
				}

				// The imported vehicle always enters ACTIVE (isArchived/archivedAt stripped) — it consumes
				// the active slot the cap check just reserved.
				const {
					isArchived: _isArchived,
					archivedAt: _archivedAt,
					...vehicleFields
				} = stripId(data.vehicle);
				const newVehicleId = (await db.vehicles.add(vehicleFields)) as number;

				for (const row of data.fuelLogs) {
					await db.fuelLogs.add({ ...stripId(row), vehicleId: newVehicleId });
				}

				// Build old→new expense-id map while adding expenses, so the reminder pass can remap
				// lastClosedByExpenseId (AC3).
				const expenseIdMap = new Map<number, number>();
				for (const row of data.expenses) {
					const newExpenseId = (await db.expenses.add({
						...stripId(row),
						vehicleId: newVehicleId
					})) as number;
					expenseIdMap.set(row.id, newExpenseId);
				}

				for (const row of data.serviceReminders) {
					const stripped = stripId(row);
					// Remap the expense-FK through the new ids; drop it when unmapped rather than leave it
					// pointing at a stranger's expense id (OQ3 default).
					const remappedExpenseId =
						stripped.lastClosedByExpenseId !== undefined
							? expenseIdMap.get(stripped.lastClosedByExpenseId)
							: undefined;
					const reminder: Omit<ServiceReminder, 'id'> = {
						...stripped,
						vehicleId: newVehicleId,
						lastClosedByExpenseId: remappedExpenseId
					};
					if (reminder.lastClosedByExpenseId === undefined) {
						delete reminder.lastClosedByExpenseId;
					}
					await db.serviceReminders.add(reminder);
				}

				return {
					vehicleId: newVehicleId,
					vehicleName: vehicleFields.name,
					fuelLogs: data.fuelLogs.length,
					expenses: data.expenses.length,
					serviceReminders: data.serviceReminders.length
				} satisfies VehicleImportResult;
			}
		);

		// Written via a direct atomic transaction (not the repositories), so signal other tabs once
		// here — an ADDITIVE merge, so notifyDataChanged (live queries pick up the new vehicle), NOT
		// notifyTabsRestored (which prompts a whole-DB reload banner).
		notifyDataChanged();
		return ok(result);
	} catch (e) {
		const decoded = decodeSentinel(e);
		if (decoded) return err(decoded.code, decoded.detail);
		if (isQuotaExceededError(e)) return err(QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE);
		return err('IMPORT_FAILED', String(e));
	}
}
