// Classification of IndexedDB / Dexie write failures.
//
// Lives under src/lib/db (per the dexie-isolation rule) but references no Dexie symbols,
// so repositories and the import committer can share one quota-detection path. When a
// write fails because device storage is exhausted, callers should surface a specific,
// actionable error instead of a generic SAVE_FAILED / IMPORT_FAILED.

export const QUOTA_EXCEEDED_CODE = 'QUOTA_EXCEEDED';

export const QUOTA_EXCEEDED_MESSAGE =
	'Device storage is full, so your data could not be saved. Free up space on your device — or export your data from Settings first — then try again.';

/**
 * True when `error` represents a storage-quota-exhaustion failure. Handles the standard
 * DOMException name, the legacy Firefox name and numeric codes, a Dexie-wrapped `inner`
 * error, and a message-text fallback.
 */
export function isQuotaExceededError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return false;
	}

	const candidates: unknown[] = [error, (error as { inner?: unknown }).inner];
	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== 'object') {
			continue;
		}
		const name = (candidate as { name?: unknown }).name;
		if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
			return true;
		}
		// Legacy implementations expose only a numeric code (22 in WebKit, 1014 in Gecko).
		const code = (candidate as { code?: unknown }).code;
		if (code === 22 || code === 1014) {
			return true;
		}
	}

	const message = (error as { message?: unknown }).message;
	// Matches both "QuotaExceededError" and "The quota has been exceeded." (Chrome).
	return typeof message === 'string' && /quota.{0,20}exceeded/i.test(message);
}
