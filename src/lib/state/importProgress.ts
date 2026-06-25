/**
 * Story 5.4 (FR-16, UJ-6, SM-6): resumable CSV import.
 *
 * The 6-step import wizard (`ImportWizard.svelte`) holds its progress in an in-memory `$state`
 * object. This plain module writes a JSON-serializable projection of that state through to
 * localStorage on each meaningful change, so a tab-close / reload / PWA cold-start resumes at the
 * persisted step instead of restarting at Step 1. The atomic Dexie commit (`commitImportRows`) is
 * untouched — resumability is PRE-COMMIT state only; a committed import is never resurrected.
 *
 * Mirrors `draftStore.ts` (AD-6): plain `.ts` (NOT a `.svelte.ts` rune module — reactivity, i.e. the
 * write-through `$effect`, lives in the wizard), the same SSR-guarded best-effort safe-storage
 * idioms (a `QuotaExceededError`/`SecurityError` on write is swallowed — a too-large import simply
 * isn't resumable, never a crash), and a `{ …, updatedAt }` envelope with a staleness horizon.
 *
 * Serialization realities handled here (importTypes.ts): the non-serializable `File` handle is
 * dropped (re-upload not needed — the persisted `rawCSV`/`parsedRows` drive Step 3+); `Date` fields
 * (`parsedRows[].data.date`, `dryRunSummary.dateRange.{start,end}`, review corrections) auto-encode
 * to ISO on `JSON.stringify` and are revived in place on load (idiom mirrored from `utils/backup.ts`,
 * re-implemented locally — importing from `src/lib/db/**` would trip the Dexie-isolation ESLint rule).
 *
 * This module is stateless: every `loadImportProgress()` reads localStorage fresh (no module-level
 * cache, unlike `draftStore.ts`), so tests just `localStorage.clear()` and seed the key directly.
 */
import { IMPORT_PROGRESS_STORAGE_KEY, DRAFT_STALE_DAYS } from '$lib/config';
import {
	isValidWizardStep,
	isImportSource,
	type ImportWizardState,
	type ReviewRowState
} from '$lib/utils/importTypes';

// `DRAFT_STALE_DAYS` (7) is reused for consistency with AD-6 (OQ-2 recommended default). `MS_PER_DAY`
// is a private const in `draftStore.ts` (not exported), so it's re-declared locally — same value.
const MS_PER_DAY = 86_400_000;
const PAYLOAD_VERSION = 1;

/** The two resumable satellites that live OUTSIDE `wizardState` as separate component `$state`. */
export interface ImportProgressSatellites {
	step4AutoSkipped: boolean;
	reviewEntries: [number, ReviewRowState][] | null;
}

/** What `loadImportProgress` reconstructs: the wizard state (Dates revived) plus its satellites. */
export interface RestoredImportProgress {
	state: ImportWizardState;
	step4AutoSkipped: boolean;
	reviewEntries: [number, ReviewRowState][] | null;
}

interface PersistedPayload {
	version: number;
	updatedAt: number;
	// `file` is dropped from this projection; `Date` fields are ISO strings on disk.
	state: Omit<ImportWizardState, 'file'>;
	step4AutoSkipped: boolean;
	reviewEntries: [number, ReviewRowState][] | null;
}

// ---------------------------------------------------------------------------
// Safe localStorage helpers — never throw; SSR-guarded; silently no-op on failure
// (mirror draftStore.ts:44-69 — each module keeps its own private copy by house convention).
// ---------------------------------------------------------------------------

function safeGet(key: string): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function safeSet(key: string, value: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, value);
	} catch {
		// Best-effort persistence. On QuotaExceededError/SecurityError, DROP any prior value for this
		// key (5.4 code-review) so a failed write degrades to "not resumable" — a clean Step-1 restart,
		// which is AC7's documented "no worse than today". Without this, a large import that fits at
		// step N but overflows the quota at step N+1 would leave the stale step-N payload behind, and a
		// reload would resume the user to the OLDER step, silently losing the later progress.
		safeRemove(key);
	}
}

function safeRemove(key: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(key);
	} catch {
		// Ignore — removal is best-effort.
	}
}

// Revive an ISO-string (or already-`Date`) field to a valid `Date`, or null when absent/invalid.
// Re-implemented locally to mirror `utils/backup.ts:38-47` (do NOT import from `src/lib/db/**` —
// ESLint Dexie-isolation, AC9/AC11).
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write the in-progress wizard state through to localStorage (best-effort). `state` is expected to
 * be a `$state.snapshot` of the wizard's state (plain object), so no proxy artifacts leak into the
 * payload (project memory: `$state` proxies aren't structured-clone-safe). The non-serializable
 * `file` handle is dropped; `JSON.stringify` auto-encodes the `Date` fields to ISO.
 */
export function saveImportProgress(
	state: ImportWizardState,
	satellites: ImportProgressSatellites
): void {
	const { file: _file, ...projection } = state;
	const payload: PersistedPayload = {
		version: PAYLOAD_VERSION,
		updatedAt: Date.now(),
		state: projection,
		step4AutoSkipped: satellites.step4AutoSkipped,
		reviewEntries: satellites.reviewEntries
	};
	safeSet(IMPORT_PROGRESS_STORAGE_KEY, JSON.stringify(payload));
}

/**
 * Read and reconstruct persisted import progress, or `null` for a clean Step-1 start. Returns `null`
 * (and clears the key) when the payload is absent, corrupt, stale (older than `DRAFT_STALE_DAYS`),
 * structurally invalid, or post-commit (a committed import is terminal — AC5 defensive). On success,
 * `Date` fields are revived in place. The `file` handle is always `null` after resume (AC3).
 */
export function loadImportProgress(): RestoredImportProgress | null {
	const raw = safeGet(IMPORT_PROGRESS_STORAGE_KEY);
	if (!raw) return null;

	let payload: PersistedPayload;
	try {
		payload = JSON.parse(raw) as PersistedPayload;
	} catch {
		// Corrupt JSON → clean start, no throw (mirror draftStore.ts:143-145).
		return null;
	}

	try {
		// (a) Staleness: an in-progress import older than the horizon is discarded WHOLE (rawCSV +
		// parse + assignments are one unit), unlike a draft which only drops odometer/date (AC6).
		const updatedAt = typeof payload.updatedAt === 'number' ? payload.updatedAt : 0;
		if (updatedAt <= 0 || Date.now() - updatedAt > DRAFT_STALE_DAYS * MS_PER_DAY) {
			clearImportProgress();
			return null;
		}

		const state = payload.state;
		if (!state || typeof state !== 'object') return null;

		// (b) Validate with the EXISTING type guards (importTypes.ts:114-120) — don't hand-roll.
		if (!isValidWizardStep(state.step)) return null;
		// Nullable source fields are either null or a valid source.
		if (state.selectedSource !== null && !isImportSource(state.selectedSource)) return null;
		if (state.confirmedFormat !== null && !isImportSource(state.confirmedFormat)) return null;
		if (state.detectedFormat !== null && !isImportSource(state.detectedFormat)) return null;
		// Structural: the array-shaped fields must be arrays.
		if (!Array.isArray(state.parsedRows)) return null;
		if (!Array.isArray(state.vehicleAssignments)) return null;

		// (c) Refuse a post-commit state — a committed import must never resurrect (AC5 defensive).
		// Truthy guard covers both null and a missing key (undefined at runtime).
		if (state.commitResult) {
			clearImportProgress();
			return null;
		}

		// (d) Revive Dates in place.
		for (const row of state.parsedRows) {
			if (row?.data && 'date' in row.data) {
				const revived = reviveDate(row.data.date);
				if (revived) row.data.date = revived;
				else delete row.data.date;
			}
		}
		if (state.dryRunSummary?.dateRange) {
			const start = reviveDate(state.dryRunSummary.dateRange.start);
			const end = reviveDate(state.dryRunSummary.dateRange.end);
			if (start && end) {
				state.dryRunSummary.dateRange.start = start;
				state.dryRunSummary.dateRange.end = end;
			} else {
				state.dryRunSummary.dateRange = null;
			}
		}

		const reviewEntries = reviveReviewEntries(payload.reviewEntries);

		// The persisted projection has no `file`; resume always lands with `file === null` (AC3).
		const restoredState: ImportWizardState = { ...state, file: null };

		return {
			state: restoredState,
			step4AutoSkipped: payload.step4AutoSkipped === true,
			reviewEntries
		};
	} catch {
		// Any structural surprise → clean start, never a half-broken resume (AC2).
		return null;
	}
}

/** Remove the persisted progress (terminal points: commit success / confirm-cancel / new import). */
export function clearImportProgress(): void {
	safeRemove(IMPORT_PROGRESS_STORAGE_KEY);
}

// Revive the `correctedData.date` inside each cached review entry. Returns null when the satellite
// is absent or not an array (graceful — the wizard re-derives review state).
function reviveReviewEntries(
	entries: [number, ReviewRowState][] | null | undefined
): [number, ReviewRowState][] | null {
	if (!Array.isArray(entries)) return null;
	for (const entry of entries) {
		const review = entry?.[1];
		if (review?.correctedData && 'date' in review.correctedData) {
			const revived = reviveDate(review.correctedData.date);
			if (revived) review.correctedData.date = revived;
			else delete review.correctedData.date;
		}
	}
	return entries;
}
