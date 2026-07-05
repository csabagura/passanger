import {
	BACKUP_APP_ID,
	DB_VERSION,
	VEHICLE_SHARE_KIND,
	VEHICLE_SHARE_FILENAME_PREFIX
} from '$lib/config';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import {
	isObject,
	reviveAndValidateVehicle,
	reviveAndValidateFuelLog,
	reviveAndValidateExpense,
	reviveAndValidateServiceReminder
} from '$lib/utils/backup';
import {
	validateVehicleReferentialIntegrity,
	validateUniqueRowIds
} from '$lib/db/validators/rowValidation';
import type { Vehicle, FuelLog, Expense, ServiceReminder } from '$lib/db/schema';

// One vehicle plus its owned rows, in memory (Date fields are Date objects, ids present). This is a
// STRICT SUBSET of a full backup's BackupData — same row shapes, but a single vehicle instead of an
// array, and NO settings. That subset relationship is why the shared revivers/validators apply
// unchanged (Story 9.3 Dev Notes).
export interface VehicleShareData {
	vehicle: Vehicle;
	fuelLogs: FuelLog[];
	expenses: Expense[];
	serviceReminders: ServiceReminder[];
}

// The on-disk JSON shape. `kind: 'vehicle'` is the discriminator that makes a per-car file and a
// full backup mutually rejectable (a full backup has no `kind`). Deliberately NO `settings` key.
export interface VehicleShareFile {
	app: string;
	schemaVersion: number;
	kind: typeof VEHICLE_SHARE_KIND;
	exportedAt: string;
	data: VehicleShareData;
}

// Same versioning contract as backup.ts: the backup feature (and this subset) is valid from v4 up.
const MIN_SHARE_SCHEMA_VERSION = 4;

// Pretty-printed (2-space) JSON, no BOM, application/json — mirrors serializeBackup. JSON.stringify
// auto-encodes Date → ISO via Date.prototype.toJSON, so in-memory Date objects need no pre-pass.
export function serializeVehicleShare(data: VehicleShareData): string {
	const file: VehicleShareFile = {
		app: BACKUP_APP_ID,
		schemaVersion: DB_VERSION,
		kind: VEHICLE_SHARE_KIND,
		exportedAt: new Date().toISOString(),
		data
	};
	return JSON.stringify(file, null, 2);
}

// Validate the JSON identity/version, revive+validate every row through the SHARED revivers, then
// enforce referential integrity (all children point at the one vehicle) and per-table unique ids.
// Returns the in-memory VehicleShareData or a truthful VALIDATION_ERROR — never a partial. Settings
// are intentionally ignored: a per-car file carries none, and even a hand-added one is never read.
export function parseVehicleShare(text: string): Result<VehicleShareData> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return err('VALIDATION_ERROR', 'This file is malformed and could not be read as JSON.');
	}

	if (!isObject(parsed) || parsed.app !== BACKUP_APP_ID) {
		return err('VALIDATION_ERROR', 'This file is not a passanger shared car.');
	}

	// The discriminator: a full backup (no `kind`) is rejected here, and parseBackup rejects this file
	// in turn (it has no `vehicles` array / `settings`) — clean mutual rejection (AC5).
	if (parsed.kind !== VEHICLE_SHARE_KIND) {
		return err('VALIDATION_ERROR', 'This file is not a passanger shared car.');
	}

	// Integer version in [4, DB_VERSION]. An older file forward-migrates via the same read-side
	// coercion precedent as a backup (new optional fields simply absent); a newer file is rejected.
	if (
		!Number.isInteger(parsed.schemaVersion) ||
		(parsed.schemaVersion as number) < MIN_SHARE_SCHEMA_VERSION
	) {
		return err('VALIDATION_ERROR', 'This file is not a passanger shared car.');
	}
	if ((parsed.schemaVersion as number) > DB_VERSION) {
		return err('VALIDATION_ERROR', 'This shared car is from a newer app version.');
	}

	const data = parsed.data;
	if (!isObject(data)) {
		return err('VALIDATION_ERROR', 'This shared car is missing or has invalid sections.');
	}

	const { vehicle, fuelLogs, expenses, serviceReminders } = data;
	if (
		!isObject(vehicle) ||
		!Array.isArray(fuelLogs) ||
		!Array.isArray(expenses) ||
		!Array.isArray(serviceReminders)
	) {
		return err('VALIDATION_ERROR', 'This shared car is missing or has invalid sections.');
	}

	const revivedVehicle = reviveAndValidateVehicle(vehicle);
	const revivedFuelLogs = fuelLogs.map(reviveAndValidateFuelLog);
	const revivedExpenses = expenses.map(reviveAndValidateExpense);
	const revivedServiceReminders = serviceReminders.map(reviveAndValidateServiceReminder);

	if (
		revivedVehicle === null ||
		revivedFuelLogs.some((row) => row === null) ||
		revivedExpenses.some((row) => row === null) ||
		revivedServiceReminders.some((row) => row === null)
	) {
		return err('VALIDATION_ERROR', 'This shared car is missing or has invalid sections.');
	}

	const validFuelLogs = revivedFuelLogs as FuelLog[];
	const validExpenses = revivedExpenses as Expense[];
	const validServiceReminders = revivedServiceReminders as ServiceReminder[];

	// Referential integrity: every child MUST reference the single vehicle in THIS file — a stray
	// vehicleId would import as an orphan unreachable by any switcher.
	const vehicleIds = new Set([revivedVehicle.id]);
	const referentialError =
		validateVehicleReferentialIntegrity(vehicleIds, validFuelLogs, 'A fuel log') ||
		validateVehicleReferentialIntegrity(vehicleIds, validExpenses, 'An expense') ||
		validateVehicleReferentialIntegrity(vehicleIds, validServiceReminders, 'A service reminder');
	if (referentialError) {
		return err('VALIDATION_ERROR', referentialError);
	}

	// Per-table unique ids — a hand-edited duplicate id would otherwise pass each per-row check yet
	// still be ambiguous when building the old→new expense-id remap (AC3).
	const duplicateIdError =
		validateUniqueRowIds(validFuelLogs, 'A fuel log') ||
		validateUniqueRowIds(validExpenses, 'An expense') ||
		validateUniqueRowIds(validServiceReminders, 'A service reminder');
	if (duplicateIdError) {
		return err('VALIDATION_ERROR', duplicateIdError);
	}

	return ok({
		vehicle: revivedVehicle,
		fuelLogs: validFuelLogs,
		expenses: validExpenses,
		serviceReminders: validServiceReminders
	});
}

// A filesystem-safe slug from the vehicle's display name: lowercase, non-alphanumerics → single
// dashes, trimmed. Falls back to 'car' when the name has no usable characters (e.g. all punctuation).
function slugifyVehicleName(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug.length > 0 ? slug : 'car';
}

// `passanger-car-<slug>-YYYY-MM-DD.json` from the date's local Y/M/D — the per-car sibling of
// buildBackupFilename.
export function buildVehicleShareFilename(vehicleName: string, date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${VEHICLE_SHARE_FILENAME_PREFIX}-${slugifyVehicleName(vehicleName)}-${year}-${month}-${day}.json`;
}
