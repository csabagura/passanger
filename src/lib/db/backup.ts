import { db } from './db';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { Vehicle, FuelLog, Expense, ServiceReminder } from './schema';
import { isQuotaExceededError, QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE } from './dbErrors';
import {
	validateNewVehicle,
	validateNewFuelLog,
	validateNewExpense,
	validateNewServiceReminder
} from './validators/rowValidation';

// The full dataset, in memory (Date fields are Date objects, ids are present). This is the
// payload that gets serialized at the JSON boundary and the shape a restore writes back.
export interface BackupData {
	vehicles: Vehicle[];
	fuelLogs: FuelLog[];
	expenses: Expense[];
	serviceReminders: ServiceReminder[];
}

// Row counts written by a successful restore — one per table.
export interface RestoreCounts {
	vehicles: number;
	fuelLogs: number;
	expenses: number;
	serviceReminders: number;
}

// Read every table in full inside ONE read transaction, so the snapshot is internally consistent
// (a concurrent write from another tab can't tear it into a dangling-FK state). No mutation, so the
// only failure is a read fault → GET_FAILED.
export async function exportAllTables(): Promise<Result<BackupData>> {
	try {
		const [vehicles, fuelLogs, expenses, serviceReminders] = await db.transaction(
			'r',
			db.vehicles,
			db.fuelLogs,
			db.expenses,
			db.serviceReminders,
			() =>
				Promise.all([
					db.vehicles.toArray(),
					db.fuelLogs.toArray(),
					db.expenses.toArray(),
					db.serviceReminders.toArray()
				])
		);

		// ADR-006 AD-WB-4 (H17b): validate every row through the SAME shared validators the
		// repositories use before handing the dataset to the caller. A legacy corrupt row (e.g. a
		// NaN numeric, which JSON.stringify turns into `null` — unrestorable on the way back in)
		// must block the export with a truthful message, not silently ship.
		const corrupt: string[] = [];
		const invalidVehicles = vehicles.filter((row) => validateNewVehicle(row) !== null).length;
		if (invalidVehicles > 0) corrupt.push(`${invalidVehicles} vehicle row(s)`);
		const invalidFuelLogs = fuelLogs.filter((row) => validateNewFuelLog(row) !== null).length;
		if (invalidFuelLogs > 0) corrupt.push(`${invalidFuelLogs} fuel log row(s)`);
		const invalidExpenses = expenses.filter((row) => validateNewExpense(row) !== null).length;
		if (invalidExpenses > 0) corrupt.push(`${invalidExpenses} expense row(s)`);
		const invalidReminders = serviceReminders.filter(
			(row) => validateNewServiceReminder(row) !== null
		).length;
		if (invalidReminders > 0) corrupt.push(`${invalidReminders} service reminder row(s)`);

		if (corrupt.length > 0) {
			return err(
				'VALIDATION_ERROR',
				`Export blocked: ${corrupt.join(', ')} failed validation — fix or delete before exporting.`
			);
		}

		return ok({ vehicles, fuelLogs, expenses, serviceReminders });
	} catch (e) {
		return err('GET_FAILED', String(e));
	}
}

// Atomic replace-all: one rw transaction over all four tables clears each then bulkPuts the
// inbound rows. bulkPut writes the inbound `id`, so primary keys (and the vehicleId FKs that
// reference them) are preserved. Any throw inside the transaction rolls the whole thing back,
// so a mid-write failure (e.g. storage quota) leaves the prior dataset untouched.
export async function restoreAllTables(data: BackupData): Promise<Result<RestoreCounts>> {
	try {
		await db.transaction(
			'rw',
			db.vehicles,
			db.fuelLogs,
			db.expenses,
			db.serviceReminders,
			async () => {
				await db.vehicles.clear();
				await db.vehicles.bulkPut(data.vehicles);
				await db.fuelLogs.clear();
				await db.fuelLogs.bulkPut(data.fuelLogs);
				await db.expenses.clear();
				await db.expenses.bulkPut(data.expenses);
				await db.serviceReminders.clear();
				await db.serviceReminders.bulkPut(data.serviceReminders);
			}
		);

		return ok({
			vehicles: data.vehicles.length,
			fuelLogs: data.fuelLogs.length,
			expenses: data.expenses.length,
			serviceReminders: data.serviceReminders.length
		});
	} catch (e) {
		if (isQuotaExceededError(e)) return err(QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE);
		return err('SAVE_FAILED', String(e));
	}
}
