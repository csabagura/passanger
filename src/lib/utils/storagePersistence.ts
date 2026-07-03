import { STORAGE_PERSISTENCE_OUTCOME_KEY, STORAGE_NOTICE_DISMISSED_KEY } from '$lib/config';

/**
 * Shell-facing outcome of the storage persistence request.
 * - 'granted': the origin is in persistent mode (no eviction)
 * - 'denied': the browser declined the request
 * - 'unavailable': the Storage API is unsupported, not in a secure context, or threw
 */
export type StoragePersistenceOutcome = 'granted' | 'denied' | 'unavailable';

// ---------------------------------------------------------------------------
// Safe localStorage helpers — never throw; silently no-op on failure
// ---------------------------------------------------------------------------

function safeGetItem(storage: Storage, key: string): string | null {
	try {
		return storage.getItem(key);
	} catch {
		return null;
	}
}

function safeSetItem(storage: Storage, key: string, value: string): void {
	try {
		storage.setItem(key, value);
	} catch {
		// Silently handle QuotaExceededError, SecurityError, etc.
	}
}

function safeRemoveItem(storage: Storage, key: string): void {
	try {
		storage.removeItem(key);
	} catch {
		// Best-effort — ignore.
	}
}

// ---------------------------------------------------------------------------
// Stored outcome helpers
//
// S18: 'granted' is cached in localStorage — a real grant should never be re-asked. 'denied' /
// 'unavailable' are cached in sessionStorage instead, so every NEW browser session naturally
// re-attempts navigator.storage.persist() rather than trusting a stale-forever denial (a user
// can grant persistence later via browser settings, bookmarking, engagement, etc.).
// ---------------------------------------------------------------------------

function getStoredOutcome(): StoragePersistenceOutcome | null {
	if (safeGetItem(localStorage, STORAGE_PERSISTENCE_OUTCOME_KEY) === 'granted') return 'granted';
	const sessionStored = safeGetItem(sessionStorage, STORAGE_PERSISTENCE_OUTCOME_KEY);
	if (sessionStored === 'denied' || sessionStored === 'unavailable') return sessionStored;
	return null;
}

function setStoredOutcome(outcome: StoragePersistenceOutcome): void {
	if (outcome === 'granted') {
		safeSetItem(localStorage, STORAGE_PERSISTENCE_OUTCOME_KEY, outcome);
		return;
	}
	safeSetItem(sessionStorage, STORAGE_PERSISTENCE_OUTCOME_KEY, outcome);
}

/**
 * Clear the session-cached denied/unavailable outcome so the next `requestStoragePersistence()`
 * call bypasses it and re-asks unconditionally. Used by the `appinstalled` handler (S18) —
 * installation is the strongest "ask again" signal available.
 */
export function clearSessionStoragePersistenceOutcome(): void {
	safeRemoveItem(sessionStorage, STORAGE_PERSISTENCE_OUTCOME_KEY);
}

// ---------------------------------------------------------------------------
// Notice dismissal helpers
// ---------------------------------------------------------------------------

export function hasNoticeDismissed(): boolean {
	return safeGetItem(localStorage, STORAGE_NOTICE_DISMISSED_KEY) === 'true';
}

export function markNoticeDismissed(): void {
	safeSetItem(localStorage, STORAGE_NOTICE_DISMISSED_KEY, 'true');
}

// ---------------------------------------------------------------------------
// Main persistence request
// Must only be called from the app-shell window context (not service workers,
// route submit handlers, or repository code) — Task 1.4
// ---------------------------------------------------------------------------

/**
 * Request storage persistence for the origin on first load.
 * - Checks `navigator.storage.persisted()` first to skip re-requesting already-persistent origins.
 * - Falls back to stored outcome from a previous session before making a new request.
 * - Maps all unsupported APIs, secure-context failures, and thrown errors to 'unavailable'.
 * - Never throws; always returns a deterministic outcome.
 */
export async function requestStoragePersistence(): Promise<StoragePersistenceOutcome> {
	// Must be in a browser window context
	if (typeof navigator === 'undefined' || !navigator.storage) {
		return 'unavailable';
	}

	try {
		// Task 1.3: Check if origin is already persisted before requesting again
		const alreadyPersisted = await navigator.storage.persisted();
		if (alreadyPersisted) {
			setStoredOutcome('granted');
			return 'granted';
		}

		// Check for a stored outcome from a previous request (avoid repeat prompts)
		const stored = getStoredOutcome();
		if (stored !== null) {
			return stored;
		}

		// No stored outcome — make the request for the first time
		const granted = await navigator.storage.persist();
		const outcome: StoragePersistenceOutcome = granted ? 'granted' : 'denied';
		setStoredOutcome(outcome);
		return outcome;
	} catch {
		// Task 1.6: TypeError, SecurityError, or any other failure → unavailable
		return 'unavailable';
	}
}
