// Up-Next reminder dismissal (Story 3.5 / DEC-8, AD-8). A dismissed Up-Next card is NOT silenced
// forever — it re-surfaces "at the next threshold". We persist a small per-reminder marker in
// localStorage (deliberately NOT IndexedDB, to avoid a Dexie migration — DB_VERSION stays 4) and
// re-surface when the reminder's status worsens OR the vehicle has driven another due-soon window
// past the odometer at which it was dismissed.
//
// `isSuppressedByDismissal` is the pure, testable core: it takes the map in and touches no storage.
// The read/write helpers mirror the safe-localStorage idiom of historyFilterStorage.ts: every access
// is wrapped in try/catch so a blocked/quota-exceeded/malformed store degrades to a safe default
// instead of crashing the dashboard.

import { REMINDER_DISMISSED_STORAGE_KEY, REMINDER_DUE_SOON_KM } from '$lib/config';
import { isFiniteNumber } from '$lib/utils/calculations';
import type { ReminderStatus } from '$lib/utils/serviceReminder';

export type ReminderDismissal = { status: ReminderStatus; odometer?: number };
export type ReminderDismissalMap = Record<number, ReminderDismissal>;

// Severity ranking so "status worsened" is a simple numeric comparison.
const SEVERITY: Record<ReminderStatus, number> = { ok: 0, 'due-soon': 1, overdue: 2 };

function isReminderStatus(value: unknown): value is ReminderStatus {
	return typeof value === 'string' && value in SEVERITY;
}

/**
 * PREP-1 (Story 4.1): validate one persisted marker before trusting it. A corrupt/legacy entry — an
 * unknown status, or a non-finite odometer — is dropped (returns null) rather than silently
 * suppressing a reminder forever. `odometer` stays optional; when present it must be finite.
 */
function sanitizeMarker(value: unknown): ReminderDismissal | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const marker = value as Record<string, unknown>;
	if (!isReminderStatus(marker.status)) {
		return null;
	}
	if (marker.odometer !== undefined && !isFiniteNumber(marker.odometer)) {
		return null;
	}
	return { status: marker.status, odometer: marker.odometer as number | undefined };
}

function getLocalStorage(): Storage | null {
	try {
		return globalThis.localStorage;
	} catch {
		return null;
	}
}

export function readDismissals(): ReminderDismissalMap {
	const storage = getLocalStorage();
	if (!storage) {
		return {};
	}

	try {
		const raw = storage.getItem(REMINDER_DISMISSED_STORAGE_KEY);
		if (!raw) {
			return {};
		}
		const parsed = JSON.parse(raw);
		// An array passes `typeof === 'object'` but is not a valid map — reject it (deferred-work:112).
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {};
		}
		// Sanitize per-marker so a single corrupt entry degrades safely instead of poisoning the map.
		const result: ReminderDismissalMap = {};
		for (const [key, value] of Object.entries(parsed)) {
			const id = Number(key);
			if (!Number.isInteger(id)) {
				continue;
			}
			const marker = sanitizeMarker(value);
			if (marker) {
				result[id] = marker;
			}
		}
		return result;
	} catch {
		return {};
	}
}

export function writeDismissals(map: ReminderDismissalMap): void {
	const storage = getLocalStorage();
	if (!storage) {
		return;
	}

	try {
		storage.setItem(REMINDER_DISMISSED_STORAGE_KEY, JSON.stringify(map));
	} catch {
		// localStorage blocked / quota exceeded — ignore (dismissal is best-effort).
	}
}

export function dismissReminder(
	id: number,
	status: ReminderStatus,
	currentOdometer: number | undefined
): void {
	const map = readDismissals();
	map[id] = { status, odometer: currentOdometer };
	writeDismissals(map);
}

export function clearDismissal(id: number): void {
	const map = readDismissals();
	if (id in map) {
		delete map[id];
		writeDismissals(map);
	}
}

/**
 * Pure suppression rule (no storage access — pass the map in). A reminder is suppressed (hidden)
 * only while it has been dismissed and has neither worsened in status nor advanced a full due-soon
 * window past the dismissal odometer.
 */
export function isSuppressedByDismissal(
	reminderId: number,
	currentStatus: ReminderStatus,
	currentOdometer: number | undefined,
	map: ReminderDismissalMap
): boolean {
	const marker = map[reminderId];
	if (!marker) {
		return false;
	}

	// Status worsened (e.g. dismissed while due-soon, now overdue) → the "next threshold" → re-surface.
	if (SEVERITY[currentStatus] > SEVERITY[marker.status]) {
		return false;
	}

	// Drove another due-soon window further → re-surface (handles an already-overdue reminder that
	// cannot worsen in status but keeps slipping — so it is "not permanently silenced").
	if (
		marker.odometer !== undefined &&
		currentOdometer !== undefined &&
		currentOdometer >= marker.odometer + REMINDER_DUE_SOON_KM
	) {
		return false;
	}

	return true;
}
