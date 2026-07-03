// Up-Next reminder dismissal (Story 3.5 / DEC-8, AD-8; due-instance model Story 8.5 / AD-RT-4). A
// dismissed Up-Next card is NOT silenced forever — it re-surfaces "at the next threshold". We
// persist a small per-reminder marker in localStorage (deliberately NOT IndexedDB, to avoid a
// Dexie migration — the dismissal shape is NOT schema-versioned) recording WHICH due instance was
// dismissed (`dueAtOdometer` / `dueAtDate`), and re-surface exactly when that instance is reached
// on either dimension, or when the reminder's status worsens.
//
// `isSuppressedByDismissal` and `pruneDismissals` are pure, testable cores that touch no storage.
// The read/write helpers mirror the safe-localStorage idiom of historyFilterStorage.ts: every
// access is wrapped in try/catch so a blocked/quota-exceeded/malformed store degrades to a safe
// default instead of crashing the dashboard.

import { REMINDER_DISMISSED_STORAGE_KEY } from '$lib/config';
import { isFiniteNumber } from '$lib/utils/calculations';
import { toDateOnlyString, type ReminderStatus } from '$lib/utils/serviceReminder';

export type ReminderDismissal = {
	status: ReminderStatus;
	dueAtOdometer?: number;
	dueAtDate?: string;
};
export type ReminderDismissalMap = Record<number, ReminderDismissal>;

// Severity ranking so "status worsened" is a simple numeric comparison.
const SEVERITY: Record<ReminderStatus, number> = { ok: 0, 'due-soon': 1, overdue: 2 };

function isReminderStatus(value: unknown): value is ReminderStatus {
	return typeof value === 'string' && value in SEVERITY;
}

/**
 * PREP-1 (Story 4.1) + Story 8.5 (AD-RT-4): validate one persisted marker before trusting it. The
 * pre-8.5 shape was `{status, odometer?}` — that shape (and any marker recording neither due field)
 * carries no due-instance and is treated as absent/expired here, never crash-inducing. A present
 * `dueAtOdometer`/`dueAtDate` must be well-typed or the whole marker is dropped.
 */
function sanitizeMarker(value: unknown): ReminderDismissal | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const marker = value as Record<string, unknown>;
	if (!isReminderStatus(marker.status)) {
		return null;
	}
	const dueAtOdometer = marker.dueAtOdometer;
	const dueAtDate = marker.dueAtDate;
	if (dueAtOdometer !== undefined && !isFiniteNumber(dueAtOdometer)) {
		return null;
	}
	if (dueAtDate !== undefined && typeof dueAtDate !== 'string') {
		return null;
	}
	if (dueAtOdometer === undefined && dueAtDate === undefined) {
		// Old-shape marker (or a degenerate new-shape one) — no due instance recorded.
		return null;
	}
	return {
		status: marker.status,
		dueAtOdometer: dueAtOdometer as number | undefined,
		dueAtDate: dueAtDate as string | undefined
	};
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
	dueAtOdometer: number | undefined,
	dueAtDate: string | undefined
): void {
	const map = readDismissals();
	map[id] = { status, dueAtOdometer, dueAtDate };
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
 * only while it has been dismissed and has neither worsened in status nor reached the exact due
 * instance that was dismissed, on either dimension the reminder tracks.
 *
 * Exact expiry (AD-RT-4): no `+ REMINDER_DUE_SOON_KM` fuzz — the due-soon window is a *display*
 * concern (serviceReminder.ts), not a dismissal-expiry one.
 */
export function isSuppressedByDismissal(
	reminderId: number,
	currentStatus: ReminderStatus,
	currentOdometer: number | undefined,
	today: Date,
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

	if (
		marker.dueAtOdometer !== undefined &&
		currentOdometer !== undefined &&
		currentOdometer >= marker.dueAtOdometer
	) {
		return false;
	}

	if (marker.dueAtDate !== undefined && toDateOnlyString(today) >= marker.dueAtDate) {
		return false;
	}

	return true;
}

/**
 * Pure prune decision (Story 8.5, AD-RT-4 — relocated out of `UpNextCard.svelte`'s `$effect`,
 * NOT new logic). Returns the dismissal ids that are stale and should be cleared: a marker
 * belongs to a reminder within `vehicleReminderIds` (the map is shared across ALL vehicles, H10a
 * scoping) that is no longer in `dueReminderIds` (the reminder has returned to `ok`).
 */
export function pruneDismissals(
	dismissals: ReminderDismissalMap,
	vehicleReminderIds: ReadonlySet<number>,
	dueReminderIds: ReadonlySet<number>
): number[] {
	const stale: number[] = [];
	for (const key of Object.keys(dismissals)) {
		const id = Number(key);
		if (!vehicleReminderIds.has(id)) continue; // another vehicle's marker — not ours to judge
		if (!dueReminderIds.has(id)) {
			stale.push(id);
		}
	}
	return stale;
}
