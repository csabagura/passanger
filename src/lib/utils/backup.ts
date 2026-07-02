import { BACKUP_APP_ID, BACKUP_FILENAME_PREFIX, DB_VERSION } from '$lib/config';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { AppSettings } from '$lib/utils/settings';
import type { BackupData } from '$lib/db/backup';

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

function isObject(value: unknown): value is Record<string, unknown> {
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

function isValidVehicle(row: unknown): boolean {
	return (
		isObject(row) &&
		typeof row.id === 'number' &&
		typeof row.name === 'string' &&
		typeof row.make === 'string' &&
		typeof row.model === 'string'
	);
}

function isValidFuelLog(row: unknown): boolean {
	// unit/distanceUnit are enum-typed and load-bearing for consumption/distance math — a foreign
	// or hand-edited backup with a bad/absent value must be rejected, not silently restored.
	return (
		isObject(row) &&
		typeof row.id === 'number' &&
		typeof row.vehicleId === 'number' &&
		reviveDate(row.date) !== null &&
		typeof row.odometer === 'number' &&
		typeof row.quantity === 'number' &&
		(row.unit === 'L' || row.unit === 'gal') &&
		(row.distanceUnit === 'km' || row.distanceUnit === 'mi') &&
		typeof row.totalCost === 'number' &&
		typeof row.calculatedConsumption === 'number' &&
		// Story 7.1 (v5, review P6) — the fill-quality flags are optional (absent on pre-v5 backups)
		// but must be BOOLEAN when present: readers coerce `?? false`, so a hand-edited truthy string
		// like "yes" would silently flag the fill as partial/missed (ADR-005 §5 gate pattern).
		(row.isPartialFill === undefined || typeof row.isPartialFill === 'boolean') &&
		(row.precededByMissedFill === undefined || typeof row.precededByMissedFill === 'boolean')
	);
}

function isValidExpense(row: unknown): boolean {
	return (
		isObject(row) &&
		typeof row.id === 'number' &&
		typeof row.vehicleId === 'number' &&
		reviveDate(row.date) !== null &&
		typeof row.type === 'string' &&
		typeof row.cost === 'number'
	);
}

function isValidServiceReminder(row: unknown): boolean {
	// A reminder must specify at least one interval (km or days), per the schema invariant.
	// lastServiceDate is optional; only validate it when present.
	return (
		isObject(row) &&
		typeof row.id === 'number' &&
		typeof row.vehicleId === 'number' &&
		typeof row.title === 'string' &&
		(typeof row.intervalKm === 'number' || typeof row.intervalDays === 'number') &&
		(row.lastServiceDate === undefined ||
			row.lastServiceDate === null ||
			reviveDate(row.lastServiceDate) !== null)
	);
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

	if (
		!vehicles.every(isValidVehicle) ||
		!fuelLogs.every(isValidFuelLog) ||
		!expenses.every(isValidExpense) ||
		!serviceReminders.every(isValidServiceReminder)
	) {
		return err('VALIDATION_ERROR', 'This backup is missing or has invalid sections.');
	}

	if (!isValidSettings(settings)) {
		return err('VALIDATION_ERROR', 'This backup has invalid settings.');
	}

	const revived: BackupData = {
		vehicles: vehicles as BackupData['vehicles'],
		fuelLogs: fuelLogs.map((log) => ({
			...(log as Record<string, unknown>),
			date: reviveDate((log as Record<string, unknown>).date) as Date
		})) as BackupData['fuelLogs'],
		expenses: expenses.map((expense) => ({
			...(expense as Record<string, unknown>),
			date: reviveDate((expense as Record<string, unknown>).date) as Date
		})) as BackupData['expenses'],
		serviceReminders: serviceReminders.map((reminder) => {
			const row = reminder as Record<string, unknown>;
			if (row.lastServiceDate === undefined || row.lastServiceDate === null) {
				// Normalize absent/null to "no key" so the restored shape matches what export emits.
				const rest = { ...row };
				delete rest.lastServiceDate;
				return rest;
			}
			return { ...row, lastServiceDate: reviveDate(row.lastServiceDate) as Date };
		}) as unknown as BackupData['serviceReminders']
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
