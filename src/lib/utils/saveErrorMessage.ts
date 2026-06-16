import { QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE } from '$lib/db/dbErrors';
import type { AppError } from '$lib/utils/result';

// Map a failed save `Result` into a user-facing message. A storage-full failure (QUOTA_EXCEEDED)
// gets the specific, actionable quota guidance (free space / export from Settings) — matching the
// JSON restore path — while any other failure falls back to the caller's friendly generic message
// rather than leaking a raw exception string.
export function saveErrorMessage(error: AppError, fallback: string): string {
	return error.code === QUOTA_EXCEEDED_CODE ? QUOTA_EXCEEDED_MESSAGE : fallback;
}
