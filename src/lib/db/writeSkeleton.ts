// Shared repository write envelope (ADR-006, AD-WB-6). Wraps every repository's mutating
// operation with one validate -> try/op -> decode-sentinel -> quota-map -> notify sequence, so the
// four repositories stop hand-rolling near-identical try/catch/sentinel plumbing that had drifted
// (S13-S17, S33). The envelope is shared; each repo's `op` transaction BODY is not (fuel-timeline
// recompute, vehicle cascade delete, etc. genuinely differ) — see ADR-006 "do not over-abstract".
// Read-only repository methods (getX/getAllX) are unaffected — this only wraps writes.

import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import { notifyDataChanged } from '$lib/utils/tabSync';
import { isQuotaExceededError, QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE } from './dbErrors';

// Encode a sentinel `CODE:detail` error to throw from inside a transaction body — Dexie aborts a
// transaction on any throw, and this is how an in-transaction failure communicates its Result code
// back to runWrite's catch block. `detail` should already be the full user-facing message (the
// throw site has the entity/id context that the envelope itself doesn't).
export function encodeSentinel(code: string, detail: string): Error {
	return new Error(`${code}:${detail}`);
}

// Decode a sentinel thrown via encodeSentinel. Error objects stringify as "Error: <message>" — strip
// that prefix before matching. The code group is restricted to UPPER_SNAKE so an unrelated
// Dexie/browser error (mixed-case names like "ConstraintError") never false-matches. Returns null
// for a non-sentinel error, which the caller falls through to a generic fallback code for. Being
// generic (any CODE, not a hardcoded allowlist) is the S33 fix: no thrown sentinel can leak an
// undecoded "Error: CODE:detail" prefix into a user-facing message.
const SENTINEL_PATTERN = /^([A-Z_]+):([\s\S]*)$/;

export function decodeSentinel(error: unknown): { code: string; detail: string } | null {
	const message = String(error);
	const stripped = message.startsWith('Error: ') ? message.slice('Error: '.length) : message;
	const match = SENTINEL_PATTERN.exec(stripped);
	if (!match) return null;
	return { code: match[1], detail: match[2] };
}

// The shared envelope. `validate` runs BEFORE `op` and short-circuits to VALIDATION_ERROR without
// ever touching the DB — the Task-1 row validators are typeof-guarded and cannot throw, so this
// can't either (S14). `op` is the repo-specific body (often its own db.transaction(...) call); on
// success the envelope notifies and wraps the result in `ok`. On failure it decodes a thrown
// sentinel, else maps a quota-exceeded error, else falls back to `fallbackCode` with the raw error
// text. `notifyDataChanged()` fires ONLY on the success path, so an `op` that throws to signal
// "nothing was actually mutated" (e.g. delete of a nonexistent row) correctly skips it (S17).
export async function runWrite<T>(
	validate: () => string | null,
	op: () => Promise<T>,
	fallbackCode: string
): Promise<Result<T>> {
	const validationError = validate();
	if (validationError) return err('VALIDATION_ERROR', validationError);

	try {
		const result = await op();
		notifyDataChanged();
		return ok(result);
	} catch (e) {
		const decoded = decodeSentinel(e);
		if (decoded) return err(decoded.code, decoded.detail);
		if (isQuotaExceededError(e)) return err(QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE);
		return err(fallbackCode, String(e));
	}
}
