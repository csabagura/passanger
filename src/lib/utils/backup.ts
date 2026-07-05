import { BACKUP_APP_ID, BACKUP_FILENAME_PREFIX, DB_VERSION } from '$lib/config';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { AppSettings } from '$lib/utils/settings';
import type { BackupData } from '$lib/db/backup';
import type {
	Vehicle,
	NewVehicle,
	FuelLog,
	NewFuelLog,
	Expense,
	NewExpense,
	ServiceReminder,
	NewServiceReminder
} from '$lib/db/schema';
import {
	validateNewVehicle,
	validateNewFuelLog,
	validateNewExpense,
	validateNewServiceReminder,
	isValidRowId,
	validateVehicleCount,
	validateVehicleReferentialIntegrity,
	validateUniqueRowIds
} from '$lib/db/validators/rowValidation';

// The on-disk JSON shape. Dates inside `data` serialize to ISO strings via Date.toJSON and are
// revived back to Date objects in parseBackup.
export interface BackupFile {
	app: string;
	schemaVersion: number;
	exportedAt: string;
	data: BackupData;
	settings: AppSettings;
}

// Keep the URL alive past the synthetic click — browser downloads expose no completion callback.
const DOWNLOAD_URL_CLEANUP_DELAY_MS = 30_000;

// Pretty-printed JSON (2-space) so a human can eyeball a backup. JSON.stringify auto-encodes
// Date → ISO via Date.prototype.toJSON, so the in-memory Date objects need no pre-processing.
export function serializeBackup(data: BackupData, settings: AppSettings): string {
	const file: BackupFile = {
		app: BACKUP_APP_ID,
		schemaVersion: DB_VERSION,
		exportedAt: new Date().toISOString(),
		data,
		settings
	};
	return JSON.stringify(file, null, 2);
}

// Exported so the per-car share parser (utils/vehicleShare.ts, Story 9.3) reuses the SAME structural
// guard rather than re-declaring one that could drift.
export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Revive an ISO-string (or already-Date) field to a valid Date, or null when absent/invalid.
function reviveDate(value: unknown): Date | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	if (typeof value === 'string') {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	return null;
}

// ADR-006 AD-WB-2/AD-WB-4 (H17a): each helper revives its Date field(s) then runs the row through
// the SAME shared validator the repositories use — a hand-edited or foreign backup can no longer
// seed a row the write boundary would otherwise reject (unpaired units, NaN/Infinity/negative
// numerics, empty strings). Returns the revived, validated row, or null if invalid.
// Exported (Story 9.3) so the per-car share parser revives rows through this exact, shared logic —
// the reminder reviver's optional-lastServiceDate normalization especially must not be re-derived.

export function reviveAndValidateVehicle(row: unknown): Vehicle | null {
	if (!isObject(row) || !isValidRowId(row.id)) return null;
	if (validateNewVehicle(row as unknown as NewVehicle)) return null;
	return row as unknown as Vehicle;
}

export function reviveAndValidateFuelLog(row: unknown): FuelLog | null {
	if (!isObject(row) || !isValidRowId(row.id)) return null;
	const revived = { ...row, date: reviveDate(row.date) };
	if (validateNewFuelLog(revived as unknown as NewFuelLog)) return null;
	return revived as unknown as FuelLog;
}

export function reviveAndValidateExpense(row: unknown): Expense | null {
	if (!isObject(row) || !isValidRowId(row.id)) return null;
	const revived = { ...row, date: reviveDate(row.date) };
	if (validateNewExpense(revived as unknown as NewExpense)) return null;
	return revived as unknown as Expense;
}

export function reviveAndValidateServiceReminder(row: unknown): ServiceReminder | null {
	if (!isObject(row) || !isValidRowId(row.id)) return null;
	// lastServiceDate is optional — normalize an absent/null value to "no key" (matches export's
	// shape) BEFORE validating, so the validator's optional-field check sees a true absence.
	const revived: Record<string, unknown> = { ...row };
	if (row.lastServiceDate === undefined || row.lastServiceDate === null) {
		delete revived.lastServiceDate;
	} else {
		revived.lastServiceDate = reviveDate(row.lastServiceDate);
	}
	if (validateNewServiceReminder(revived as unknown as NewServiceReminder)) return null;
	return revived as unknown as ServiceReminder;
}

function isValidSettings(value: unknown): boolean {
	return (
		isObject(value) &&
		typeof value.currency === 'string' &&
		typeof value.fuelUnit === 'string' &&
		typeof value.theme === 'string' &&
		(value.exchangeRates === undefined || isObject(value.exchangeRates))
	);
}

// Validate the JSON, then revive the three Date fields in place. Returns the in-memory
// BackupData (Dates as Date objects) plus the restored settings. All structural problems map to
// VALIDATION_ERROR with a distinct, human-readable message.
export function parseBackup(text: string): Result<{ data: BackupData; settings: AppSettings }> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return err('VALIDATION_ERROR', 'This file is malformed and could not be read as JSON.');
	}

	if (!isObject(parsed)) {
		return err('VALIDATION_ERROR', 'This file is not a passanger backup.');
	}

	if (parsed.app !== BACKUP_APP_ID) {
		return err('VALIDATION_ERROR', 'This file is not a passanger backup.');
	}

	// Accept any backup at or below the running schema version; reject only backups from a NEWER app
	// (fields we don't understand). Older backups are forward-compatible because every schema bump so
	// far has been additive with safe defaults — e.g. a v4 backup restores into v5 with the new
	// fuelLog fields (`isPartialFill` / `precededByMissedFill`) simply absent, which readers coerce to
	// `false` (Story 7.1 / ADR-005). Restored rows bypass the Dexie `.upgrade()` path, so this
	// read-side coercion — not a backfill — is what keeps them valid. Was an exact `!==` match pre-v5.
	// The floor is 4: the backup feature shipped when DB_VERSION was already 4, so no legitimate file
	// carries a lower stamp — and an integer check keeps NaN/fractional garbage out (`NaN > n` is
	// false, so a plain upper-bound comparison alone would ACCEPT a corrupt version field; review P4).
	const MIN_BACKUP_SCHEMA_VERSION = 4;
	if (
		!Number.isInteger(parsed.schemaVersion) ||
		(parsed.schemaVersion as number) < MIN_BACKUP_SCHEMA_VERSION
	) {
		return err('VALIDATION_ERROR', 'This file is not a passanger backup.');
	}
	if ((parsed.schemaVersion as number) > DB_VERSION) {
		return err('VALIDATION_ERROR', 'This backup is from a newer app version.');
	}

	const data = parsed.data;
	const settings = parsed.settings;
	if (!isObject(data)) {
		return err('VALIDATION_ERROR', 'This backup is missing or has invalid sections.');
	}

	const { vehicles, fuelLogs, expenses, serviceReminders } = data;
	if (
		!Array.isArray(vehicles) ||
		!Array.isArray(fuelLogs) ||
		!Array.isArray(expenses) ||
		!Array.isArray(serviceReminders)
	) {
		return err('VALIDATION_ERROR', 'This backup is missing or has invalid sections.');
	}

	// ADR-006 AD-WB-4 (H17a): the vehicle-count cap is checked BEFORE per-row revival — a backup
	// with more than MAX_VEHICLES ACTIVE vehicles is rejected outright, matching the write boundary's
	// guard. AC8/AD-VA-4: archived vehicles do NOT count toward the cap, so a full-slots + archived
	// backup restores cleanly.
	const vehicleCountError = validateVehicleCount(
		vehicles as ReadonlyArray<{ isArchived?: boolean }>
	);
	if (vehicleCountError) {
		return err('VALIDATION_ERROR', vehicleCountError);
	}

	const revivedVehicles = vehicles.map(reviveAndValidateVehicle);
	const revivedFuelLogs = fuelLogs.map(reviveAndValidateFuelLog);
	const revivedExpenses = expenses.map(reviveAndValidateExpense);
	const revivedServiceReminders = serviceReminders.map(reviveAndValidateServiceReminder);

	if (
		revivedVehicles.some((row) => row === null) ||
		revivedFuelLogs.some((row) => row === null) ||
		revivedExpenses.some((row) => row === null) ||
		revivedServiceReminders.some((row) => row === null)
	) {
		return err('VALIDATION_ERROR', 'This backup is missing or has invalid sections.');
	}

	const validVehicles = revivedVehicles as Vehicle[];
	const validFuelLogs = revivedFuelLogs as FuelLog[];
	const validExpenses = revivedExpenses as Expense[];
	const validServiceReminders = revivedServiceReminders as ServiceReminder[];

	// ADR-006 AD-WB-4 (H17a): every fuelLog/expense/serviceReminder must reference a vehicle
	// present in THIS file — otherwise it restores as an orphan unreachable by any UI switcher.
	const vehicleIds = new Set(validVehicles.map((vehicle) => vehicle.id));
	const referentialError =
		validateVehicleReferentialIntegrity(vehicleIds, validFuelLogs, 'A fuel log') ||
		validateVehicleReferentialIntegrity(vehicleIds, validExpenses, 'An expense') ||
		validateVehicleReferentialIntegrity(vehicleIds, validServiceReminders, 'A service reminder');
	if (referentialError) {
		return err('VALIDATION_ERROR', referentialError);
	}

	// ADR-006 AD-WB-4 (H17a): a live write can never produce two rows sharing an id in one table —
	// restoreAllTables' bulkPut would silently overwrite one with the other with no error/skip
	// signal, so a hand-edited duplicate id must be caught here, per table.
	const duplicateIdError =
		validateUniqueRowIds(validVehicles, 'A vehicle') ||
		validateUniqueRowIds(validFuelLogs, 'A fuel log') ||
		validateUniqueRowIds(validExpenses, 'An expense') ||
		validateUniqueRowIds(validServiceReminders, 'A service reminder');
	if (duplicateIdError) {
		return err('VALIDATION_ERROR', duplicateIdError);
	}

	if (!isValidSettings(settings)) {
		return err('VALIDATION_ERROR', 'This backup has invalid settings.');
	}

	const revived: BackupData = {
		vehicles: validVehicles,
		fuelLogs: validFuelLogs,
		expenses: validExpenses,
		serviceReminders: validServiceReminders
	};

	return ok({ data: revived, settings: settings as unknown as AppSettings });
}

// Mirror downloadCSV: Blob → object URL → hidden anchor → click → deferred revoke. No BOM for
// JSON; the MIME type is application/json.
export function downloadBackupFile(json: string, filename: string): void {
	const blob = new Blob([json], { type: 'application/json' });
	const objectUrl = URL.createObjectURL(blob);
	const anchor = document.createElement('a');

	anchor.href = objectUrl;
	anchor.download = filename;
	anchor.rel = 'noopener';
	anchor.style.display = 'none';

	document.body.appendChild(anchor);
	anchor.click();

	window.setTimeout(() => {
		anchor.remove();
		URL.revokeObjectURL(objectUrl);
	}, DOWNLOAD_URL_CLEANUP_DELAY_MS);
}

// `passanger-backup-YYYY-MM-DD.json` from the date's local Y/M/D.
export function buildBackupFilename(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${BACKUP_FILENAME_PREFIX}-${year}-${month}-${day}.json`;
}
