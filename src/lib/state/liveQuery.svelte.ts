import { liveQuery } from '$lib/db/db';
import type { Result } from '$lib/utils/result';

// AD-4: a reactive read adapter over Dexie's `liveQuery`, surfaced as a Svelte 5 runes value.
//
// Why this exists: the old "load on mount + $effect-on-active-vehicle" pattern does not reflect
// cross-surface writes (log fuel on Capture → see it on Home) without bespoke wiring. `liveQuery`
// re-runs `queryFn` whenever any Dexie table it read is mutated, so a `createLiveQuery` value
// re-emits automatically after a same-tab repository write. liveQuery observes Dexie's own
// storage-mutation events — it does NOT depend on the app's notifyDataChanged()/tabSync
// BroadcastChannel plumbing (that drives the cross-tab cue, a separate concern).
//
// Read-only contract: this adapter only OBSERVES. All mutations still go through repositories
// (save/update/delete). It introduces no fetch/XHR/WebSocket — `queryFn` should read through
// repository read methods (e.g. getAllFuelLogs(vehicleId)) so the tracked table reads sit inside
// the observed function.
//
// `.svelte.ts` because the module owns `$state`. Factory (not a singleton) so each consumer/test
// gets isolated state — mirrors the getter-object pattern in state/captureSheet.svelte.ts.
//
// ⚠ $state ↔ IndexedDB hazard for CONSUMERS: the value `.current` holds is read OUT of Dexie
// (plain rows) and is fine to keep in $state. But a surface must NOT feed `q.current` straight
// back into a repository WRITE (save/update/put/bulkPut) — $state deep-proxies its value and a
// proxied object throws DataCloneError in a real browser (fake-indexeddb does not enforce
// structured-clone, so unit tests stay green while prod breaks). Pass `$state.snapshot(q.current)`
// or a plain copy at the write boundary. (Story 2.5 shipped a fix for this exact class of bug.)
//
// Teardown contract: consumers MUST wire `destroy` into component teardown, e.g.
//   import { onDestroy } from 'svelte';
//   const logs = createLiveQuery(() => getAllFuelLogs(vehicleId).then((r) => r.data ?? []), []);
//   onDestroy(logs.destroy); // or $effect(() => logs.destroy)
// Without it the Dexie subscription leaks past the destroyed component.

export interface LiveQuery<T> {
	/** The latest emitted value, or `initial` before the first async emission settles. $state-backed. */
	readonly current: T | undefined;
	/** The last error thrown by `queryFn` (rejection or sync throw), or `null`. `current` keeps its last good value. */
	readonly error: unknown;
	/** Stop further emissions and release the Dexie subscription. Idempotent — safe to call more than once. */
	destroy(): void;
}

/**
 * Wrap a Dexie-backed read in a Svelte 5 runes value that re-emits when the underlying tables change.
 *
 * @param queryFn Reads through repository read methods / `db` table reads. Re-run by liveQuery on
 *   every mutation of a table it touched. Emissions are ASYNCHRONOUS — never assert synchronously
 *   right after a write.
 * @param initial Seed for `.current` before the first emission (default `undefined`), so reads
 *   before load are well-defined and a consumer can distinguish "not loaded yet" from "loaded empty".
 */
export function createLiveQuery<T>(queryFn: () => T | Promise<T>, initial?: T): LiveQuery<T> {
	let current = $state<T | undefined>(initial);
	let error = $state<unknown>(null);
	let torn = false;

	// A SYNCHRONOUS throw from `queryFn` would not reach the `error` callback below: Dexie defers
	// `queryFn` into a microtask/timer, so a raw sync throw escapes there as an uncaught exception.
	// Wrap it so a sync throw becomes a rejection — then both failure modes land on `error` and
	// nothing crosses the read boundary.
	const safeQueryFn = (): T | Promise<T> => {
		try {
			return queryFn();
		} catch (e) {
			return Promise.reject(e);
		}
	};

	// liveQuery(fn) returns a Dexie Observable; subscribing schedules `fn` (Dexie defers the first
	// run) and re-runs it whenever an observed table mutates. Both a rejection and a (now-wrapped)
	// synchronous throw land on `error` rather than escaping — the adapter must not throw across
	// its read boundary.
	const subscription = liveQuery(safeQueryFn).subscribe({
		next: (value) => {
			current = value;
			error = null;
		},
		error: (e) => {
			error = e;
		}
	});

	return {
		get current() {
			return current;
		},
		get error() {
			return error;
		},
		destroy() {
			if (torn) return;
			torn = true;
			subscription.unsubscribe();
		}
	};
}

/**
 * Same contract as `createLiveQuery`, but for repository reads that return `Result<T>`. A repository
 * never throws — a fallible read reports failure via `r.error`. Naively coalescing that with
 * `?? []`/`?? undefined` turns a DB failure into a resolved "empty" success, which is indistinguishable
 * from genuine first-run/empty state downstream. This wrapper re-throws `r.error` instead, so it
 * reaches `createLiveQuery`'s existing `safeQueryFn` (sync-throw-to-rejection) and surfaces on
 * `LiveQuery.error` like any other failure.
 */
export function createRepoLiveQuery<T>(
	resultFn: () => Promise<Result<T>>,
	initial?: T
): LiveQuery<T> {
	return createLiveQuery(async () => {
		const r = await resultFn();
		if (r.error) {
			// Review fix (8.6): preserve the repository's descriptive message, not just its code —
			// `r.error.code` alone discarded debugging detail the repository intentionally attached.
			const e = new Error(r.error.message);
			e.name = r.error.code;
			throw e;
		}
		return r.data;
	}, initial);
}
