// Story 4.6 (FR-12 loop-close / DEC-6): the pure glue that closes the reminder loop when a
// matching Expense is saved. Two read-model helpers — a token match and a marker-reset patch —
// plus the shared "current odometer from fuel logs" derivation. Pure: no `Result<T>` (these are
// read models, not repository writes), no `dexie`, no Svelte. The layout owns the side effects.

import { isFiniteNumber } from '$lib/utils/calculations';
import type { FuelLog, NewServiceReminder } from '$lib/db/schema';

/**
 * DEC-6 token match: do an Expense `type` and a Reminder `title` share at least one whole token,
 * case-insensitively? Lowercase both, split on `\W+` (so "Oil-change"/"Oil/filter" tokenize
 * cleanly), drop empty tokens, and test for a non-empty set intersection.
 *
 * Whole-token equality, NOT substring — "tire" must not match "entire". Empty / whitespace-only /
 * punctuation-only input produces no tokens → `false`. A generic shared word ("service") can
 * trigger a spurious match; that is spec-faithful ("shares a token") and the accepted stop-word
 * false-positive (OQ-2), documented as a defer rather than special-cased here.
 */
export function expenseMatchesReminder(expenseType: string, reminderTitle: string): boolean {
	const expenseTokens = tokenize(expenseType);
	if (expenseTokens.size === 0) return false;
	for (const token of tokenize(reminderTitle)) {
		if (expenseTokens.has(token)) return true;
	}
	return false;
}

function tokenize(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.split(/\W+/)
			.filter((token) => token.length > 0)
	);
}

/**
 * Build the marker write that pushes a reminder back toward `ok` when the user confirms a reset.
 * `lastServiceDate` is ALWAYS set (the time dimension); `lastServiceOdometer` is set ONLY when the
 * derived odometer is finite and > 0 — the repo validator rejects `lastServiceOdometer ≤ 0`
 * (`serviceReminders.ts`), so a missing / 0 / non-finite reading is omitted and the patch is
 * date-only (a km-only reminder with no usable odometer simply can't be distance-reset — accepted
 * edge). All values are plain primitives (a `Date` row + a `number`), never a `$state` proxy, so
 * the Dexie write boundary stays clean (Story 2.5 / 4.5 `DataCloneError` class).
 */
export function resetMarkerPatch(
	serviceDate: Date,
	currentOdometer: number | undefined
): Partial<NewServiceReminder> {
	const patch: Partial<NewServiceReminder> = { lastServiceDate: serviceDate };
	if (isFiniteNumber(currentOdometer) && currentOdometer > 0) {
		patch.lastServiceOdometer = currentOdometer;
	}
	return patch;
}

/**
 * Current odometer = the max finite odometer across a vehicle's fuel logs — the shipped
 * UpNextCard / MaintainDashboard derivation, extracted so the layout confirm-handler reuses it.
 * A corrupt/legacy non-finite odometer is dropped (a single `NaN` would poison `Math.max`); when
 * no log has a usable odometer the result is `undefined` (the "unknown" case).
 */
export function currentOdometerFromLogs(fuelLogs: FuelLog[]): number | undefined {
	const usable = fuelLogs.map((log) => log.odometer).filter(isFiniteNumber);
	return usable.length === 0 ? undefined : Math.max(...usable);
}
