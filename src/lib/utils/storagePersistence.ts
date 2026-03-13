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

function safeGetItem(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function safeSetItem(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Silently handle QuotaExceededError, SecurityError, etc.
	}
}

// ---------------------------------------------------------------------------
// Stored outcome helpers
// ---------------------------------------------------------------------------

function getStoredOutcome(): StoragePersistenceOutcome | null {
	const stored = safeGetItem(STORAGE_PERSISTENCE_OUTCOME_KEY);
	if (stored === 'granted' || stored === 'denied' || stored === 'unavailable') return stored;
	return null;
}

function setStoredOutcome(outcome: StoragePersistenceOutcome): void {
	safeSetItem(STORAGE_PERSISTENCE_OUTCOME_KEY, outcome);
}

// ---------------------------------------------------------------------------
// Notice dismissal helpers
// ---------------------------------------------------------------------------

export function hasNoticeDismissed(): boolean {
	return safeGetItem(STORAGE_NOTICE_DISMISSED_KEY) === 'true';
}

export function markNoticeDismissed(): void {
	safeSetItem(STORAGE_NOTICE_DISMISSED_KEY, 'true');
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
