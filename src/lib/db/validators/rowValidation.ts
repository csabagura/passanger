// Shared row-invariant validators (ADR-006, AD-WB-2). Lives under src/lib/db (per the
// dexie-isolation rule) but imports no Dexie symbols — mirrors dbErrors.ts's pattern — so
// utils/backup.ts and utils/importCommit.ts can consume it without crossing the isolation
// boundary. Consumed by: (1) the four repositories' create/update validation, (2) importCommit's
// per-row commit-time gate, (3) parseBackup's row/dataset validation. One rule set, three writers.

import { MAX_VEHICLES } from '$lib/config';
import type { NewVehicle, NewFuelLog, NewExpense, NewServiceReminder } from '../schema';

// ---------------------------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------------------------

export function validateNewVehicle(vehicle: NewVehicle): string | null {
	// S14: typeof-guarded BEFORE .trim() — a truthy non-string (e.g. a number) must return a
	// VALIDATION_ERROR, never throw a TypeError across the Result boundary.
	if (typeof vehicle.name !== 'string' || vehicle.name.trim() === '')
		return 'Vehicle name is required';
	if (typeof vehicle.make !== 'string' || vehicle.make.trim() === '')
		return 'Vehicle make is required';
	if (typeof vehicle.model !== 'string' || vehicle.model.trim() === '')
		return 'Vehicle model is required';
	if (vehicle.year !== undefined) {
		if (
			!Number.isInteger(vehicle.year) ||
			vehicle.year < 1900 ||
			vehicle.year > new Date().getFullYear()
		) {
			return 'Vehicle year must be an integer between 1900 and the current year';
		}
	}
	return null;
}

export function validatePartialVehicle(changes: Partial<NewVehicle>): string | null {
	// S14: typeof-guarded BEFORE .trim() — same fix as validateNewVehicle.
	if ('name' in changes && (typeof changes.name !== 'string' || changes.name.trim() === ''))
		return 'Vehicle name cannot be empty';
	if ('make' in changes && (typeof changes.make !== 'string' || changes.make.trim() === ''))
		return 'Vehicle make cannot be empty';
	if ('model' in changes && (typeof changes.model !== 'string' || changes.model.trim() === ''))
		return 'Vehicle model cannot be empty';
	if ('year' in changes && changes.year !== undefined) {
		if (
			!Number.isInteger(changes.year) ||
			changes.year < 1900 ||
			changes.year > new Date().getFullYear()
		) {
			return 'Vehicle year must be an integer between 1900 and the current year';
		}
	}
	return null;
}

// ---------------------------------------------------------------------------------------------
// FuelLog
// ---------------------------------------------------------------------------------------------

export function validateNewFuelLog(entry: NewFuelLog): string | null {
	if (!Number.isInteger(entry.vehicleId) || entry.vehicleId <= 0)
		return 'vehicleId must be a positive integer';
	if (!(entry.date instanceof Date) || isNaN(entry.date.getTime()))
		return 'date must be a valid Date';
	// FIX #3: Enforce odometer > 0 to match form validation (was >= 0)
	if (typeof entry.odometer !== 'number' || !Number.isFinite(entry.odometer) || entry.odometer <= 0)
		return 'odometer must be a positive finite number';
	if (typeof entry.quantity !== 'number' || !Number.isFinite(entry.quantity) || entry.quantity <= 0)
		return 'quantity must be a positive finite number';
	if (entry.unit !== 'L' && entry.unit !== 'gal') return 'unit must be "L" or "gal"';
	if (entry.distanceUnit !== 'km' && entry.distanceUnit !== 'mi')
		return 'distanceUnit must be "km" or "mi"';
	// FIX #3: Validate unit/distanceUnit consistency: L pairs with km, gal pairs with mi
	if (
		(entry.unit === 'L' && entry.distanceUnit !== 'km') ||
		(entry.unit === 'gal' && entry.distanceUnit !== 'mi')
	) {
		return 'unit and distanceUnit must match: L with km, gal with mi';
	}
	if (
		typeof entry.totalCost !== 'number' ||
		!Number.isFinite(entry.totalCost) ||
		entry.totalCost < 0
	)
		return 'totalCost must be a non-negative finite number';
	if (
		typeof entry.calculatedConsumption !== 'number' ||
		!Number.isFinite(entry.calculatedConsumption) ||
		entry.calculatedConsumption < 0
	)
		return 'calculatedConsumption must be a non-negative finite number';
	// ADR-006 AD-WB-2 / S16: the v5 fill-quality flags are optional (absent on pre-v5 rows) but
	// must be BOOLEAN when present — readers coerce `?? false`, so a truthy non-boolean (e.g. a
	// hand-edited backup string "yes") would silently flag the fill as partial/missed.
	if (entry.isPartialFill !== undefined && typeof entry.isPartialFill !== 'boolean')
		return 'isPartialFill must be a boolean';
	if (entry.precededByMissedFill !== undefined && typeof entry.precededByMissedFill !== 'boolean')
		return 'precededByMissedFill must be a boolean';
	return null;
}

export function validatePartialFuelLog(changes: Partial<NewFuelLog>): string | null {
	if (
		'vehicleId' in changes &&
		(!Number.isInteger(changes.vehicleId) || (changes.vehicleId as number) <= 0)
	)
		return 'vehicleId must be a positive integer';
	if (
		'date' in changes &&
		(!(changes.date instanceof Date) || isNaN((changes.date as Date).getTime()))
	)
		return 'date must be a valid Date';
	// FIX #3: Enforce odometer > 0 to match form validation (was >= 0)
	if (
		'odometer' in changes &&
		(typeof changes.odometer !== 'number' ||
			!Number.isFinite(changes.odometer as number) ||
			(changes.odometer as number) <= 0)
	)
		return 'odometer must be a positive finite number';
	if (
		'quantity' in changes &&
		(typeof changes.quantity !== 'number' ||
			!Number.isFinite(changes.quantity as number) ||
			(changes.quantity as number) <= 0)
	)
		return 'quantity must be a positive finite number';
	if ('unit' in changes && changes.unit !== 'L' && changes.unit !== 'gal')
		return 'unit must be "L" or "gal"';
	if ('distanceUnit' in changes && changes.distanceUnit !== 'km' && changes.distanceUnit !== 'mi')
		return 'distanceUnit must be "km" or "mi"';
	// FIX #13 (Pass 13) - ISSUE 2: Prevent partial unit updates that could create inconsistent pairs
	// If either unit or distanceUnit is being updated, both MUST be updated together
	if ('unit' in changes !== 'distanceUnit' in changes) {
		return 'unit and distanceUnit must be updated together to maintain consistency';
	}
	// FIX #11 (Pass 11) - ISSUE 3: Validate unit/distanceUnit consistency on partial updates
	// If user updates unit without distanceUnit (or vice versa), ensure they still pair correctly
	if ('unit' in changes && 'distanceUnit' in changes) {
		if (
			(changes.unit === 'L' && changes.distanceUnit !== 'km') ||
			(changes.unit === 'gal' && changes.distanceUnit !== 'mi')
		) {
			return 'unit and distanceUnit must match: L with km, gal with mi';
		}
	}
	if (
		'totalCost' in changes &&
		(typeof changes.totalCost !== 'number' ||
			!Number.isFinite(changes.totalCost as number) ||
			(changes.totalCost as number) < 0)
	)
		return 'totalCost must be a non-negative finite number';
	if (
		'calculatedConsumption' in changes &&
		(typeof changes.calculatedConsumption !== 'number' ||
			!Number.isFinite(changes.calculatedConsumption as number) ||
			(changes.calculatedConsumption as number) < 0)
	)
		return 'calculatedConsumption must be a non-negative finite number';
	// ADR-006 AD-WB-2 / S16: same v5 boolean gate as validateNewFuelLog. An explicit `undefined`
	// is a no-op/clear (never written — Dexie deletes the key), so only a PRESENT non-boolean fails.
	if (
		'isPartialFill' in changes &&
		changes.isPartialFill !== undefined &&
		typeof changes.isPartialFill !== 'boolean'
	)
		return 'isPartialFill must be a boolean';
	if (
		'precededByMissedFill' in changes &&
		changes.precededByMissedFill !== undefined &&
		typeof changes.precededByMissedFill !== 'boolean'
	)
		return 'precededByMissedFill must be a boolean';
	return null;
}

// ---------------------------------------------------------------------------------------------
// Expense
// ---------------------------------------------------------------------------------------------

export function validateNewExpense(entry: NewExpense): string | null {
	if (!Number.isInteger(entry.vehicleId) || entry.vehicleId <= 0)
		return 'vehicleId must be a positive integer';
	if (!(entry.date instanceof Date) || isNaN(entry.date.getTime()))
		return 'date must be a valid Date';
	// S14: typeof-guarded BEFORE .trim() — a truthy non-string must return an error, never throw.
	if (typeof entry.type !== 'string' || entry.type.trim() === '') return 'Expense type is required';
	if (
		entry.odometer !== undefined &&
		(typeof entry.odometer !== 'number' || !Number.isFinite(entry.odometer) || entry.odometer < 0)
	)
		return 'odometer must be a non-negative finite number';
	if (typeof entry.cost !== 'number' || !Number.isFinite(entry.cost) || entry.cost < 0)
		return 'cost must be a non-negative finite number';
	return null;
}

export function validatePartialExpense(changes: Partial<NewExpense>): string | null {
	if (
		'vehicleId' in changes &&
		(!Number.isInteger(changes.vehicleId) || (changes.vehicleId as number) <= 0)
	)
		return 'vehicleId must be a positive integer';
	if (
		'date' in changes &&
		(!(changes.date instanceof Date) || isNaN((changes.date as Date).getTime()))
	)
		return 'date must be a valid Date';
	// S14: typeof-guarded BEFORE .trim() — same fix as validateNewExpense.
	if ('type' in changes && (typeof changes.type !== 'string' || changes.type.trim() === ''))
		return 'Expense type cannot be empty';
	if (
		'odometer' in changes &&
		changes.odometer !== undefined &&
		(typeof changes.odometer !== 'number' ||
			!Number.isFinite(changes.odometer as number) ||
			(changes.odometer as number) < 0)
	)
		return 'odometer must be a non-negative finite number';
	if (
		'cost' in changes &&
		(typeof changes.cost !== 'number' ||
			!Number.isFinite(changes.cost as number) ||
			(changes.cost as number) < 0)
	)
		return 'cost must be a non-negative finite number';
	return null;
}

// ---------------------------------------------------------------------------------------------
// ServiceReminder
// ---------------------------------------------------------------------------------------------

export function isPositiveFinite(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function validateNewServiceReminder(reminder: NewServiceReminder): string | null {
	if (!Number.isInteger(reminder.vehicleId) || reminder.vehicleId <= 0)
		return 'vehicleId must be a positive integer';
	// S14: typeof-guarded BEFORE .trim() — a truthy non-string must return an error, never throw.
	if (typeof reminder.title !== 'string' || reminder.title.trim() === '')
		return 'Reminder title is required';

	const hasKm = reminder.intervalKm !== undefined;
	const hasDays = reminder.intervalDays !== undefined;
	if (!hasKm && !hasDays) return 'At least one interval (distance or time) is required';
	if (hasKm && !isPositiveFinite(reminder.intervalKm))
		return 'Distance interval must be a positive finite number';
	if (hasDays && !isPositiveFinite(reminder.intervalDays))
		return 'Time interval must be a positive finite number';

	if (reminder.lastServiceOdometer !== undefined && !isPositiveFinite(reminder.lastServiceOdometer))
		return 'Last service odometer must be a positive finite number';
	if (
		reminder.lastServiceDate !== undefined &&
		(!(reminder.lastServiceDate instanceof Date) ||
			Number.isNaN(reminder.lastServiceDate.getTime()))
	)
		return 'Last service date must be a valid Date';

	return null;
}

export function validatePartialServiceReminder(
	changes: Partial<NewServiceReminder>
): string | null {
	if (
		'vehicleId' in changes &&
		(!Number.isInteger(changes.vehicleId) || (changes.vehicleId as number) <= 0)
	)
		return 'vehicleId must be a positive integer';
	// S14: typeof-guarded BEFORE .trim() — same fix as validateNewServiceReminder.
	if ('title' in changes && (typeof changes.title !== 'string' || changes.title.trim() === ''))
		return 'Reminder title cannot be empty';

	// Treat an explicit `undefined` as "clearing" the interval; only a present value is validated.
	// The cross-field "at least one interval survives" invariant needs the EXISTING record (this
	// function only sees the patch) — see hasAtLeastOneInterval, applied by the repo after a
	// pre-read (S13; ADR-006 AD-WB-6).
	if (
		'intervalKm' in changes &&
		changes.intervalKm !== undefined &&
		!isPositiveFinite(changes.intervalKm)
	)
		return 'Distance interval must be a positive finite number';
	if (
		'intervalDays' in changes &&
		changes.intervalDays !== undefined &&
		!isPositiveFinite(changes.intervalDays)
	)
		return 'Time interval must be a positive finite number';

	if (
		'lastServiceOdometer' in changes &&
		changes.lastServiceOdometer !== undefined &&
		!isPositiveFinite(changes.lastServiceOdometer)
	)
		return 'Last service odometer must be a positive finite number';
	if (
		'lastServiceDate' in changes &&
		changes.lastServiceDate !== undefined &&
		(!(changes.lastServiceDate instanceof Date) ||
			Number.isNaN((changes.lastServiceDate as Date).getTime()))
	)
		return 'Last service date must be a valid Date';

	return null;
}

// S13 / ADR-006 AD-WB-6: a reminder must always keep at least one interval. This is a cross-field
// invariant over the RESULTING record (existing merged with a partial patch), so it needs the
// existing row — the repo computes `{ ...existing, ...changes }` (object spread correctly applies
// an explicit `undefined` in `changes`, clearing the key) and calls this before writing.
export function hasAtLeastOneInterval(reminder: {
	intervalKm?: number;
	intervalDays?: number;
}): boolean {
	return reminder.intervalKm !== undefined || reminder.intervalDays !== undefined;
}

// ---------------------------------------------------------------------------------------------
// Cross-cutting: row identity + dataset-level checks (backup boundary — ADR-006 AD-WB-4 / H17a)
// ---------------------------------------------------------------------------------------------

// The repos never validate `id` (Dexie assigns it on create; update/delete take it as a separate
// argument). Backup restore writes arbitrary ids via bulkPut, so a hand-edited/corrupt id
// (NaN/Infinity/negative/non-integer) must be caught here before it reaches the DB.
export function isValidRowId(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function validateVehicleCount(count: number): string | null {
	if (count > MAX_VEHICLES) return `A backup cannot contain more than ${MAX_VEHICLES} vehicles`;
	return null;
}

// Every fuelLog/expense/serviceReminder row must reference a vehicle present in the same
// dataset — otherwise it restores as an orphan unreachable by any UI vehicle switcher.
export function validateVehicleReferentialIntegrity(
	vehicleIds: ReadonlySet<number>,
	rows: ReadonlyArray<{ vehicleId: number }>,
	entityLabel: string
): string | null {
	for (const row of rows) {
		if (!vehicleIds.has(row.vehicleId)) {
			return `${entityLabel} references a vehicle that does not exist in this backup`;
		}
	}
	return null;
}
