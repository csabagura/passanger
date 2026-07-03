// Shared reactive wall-clock (Story 8.5 / S20 / AD-RT-7). Svelte 5 `$props()` defaults evaluate
// ONCE at mount, not reactively — a `today = new Date()` / `now = new Date()` prop default froze
// the clock at first render, so a reminder that becomes due purely by TIME passing (no fuel
// Capture, no dataRevision bump) never re-evaluated until an unrelated re-render happened to
// occur. This factory re-reads `new Date()` on `visibilitychange`/`pageshow` — the two events
// that reliably fire when a backgrounded/reloaded PWA tab becomes active again — so a long-idle
// tab catches up without needing a timer.
//
// `.svelte.ts` because the module owns `$state`. Factory (not a singleton) so each
// consumer/test gets isolated state and lifecycle — mirrors state/liveQuery.svelte.ts.
//
// Teardown contract: consumers MUST call `destroy()` (e.g. via `onDestroy`) to remove the
// listeners, mirroring `LiveQuery.destroy()`.

export interface WallClock {
	/** The current wall-clock time. $state-backed — refreshes on `visibilitychange`/`pageshow`. */
	readonly now: Date;
	/** Stop listening. Idempotent — safe to call more than once. */
	destroy(): void;
}

export function createWallClock(): WallClock {
	// `now` is always REASSIGNED wholesale on refresh (never mutated in place via .setDate()/etc.),
	// so plain $state's coarse-grained reactivity already tracks every change — SvelteDate's
	// fine-grained in-place mutation tracking would buy nothing here (mirrors the
	// ImportStepVehicles.svelte precedent).
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	let now = $state(new Date());

	const refresh = () => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- same rationale as above
		now = new Date();
	};

	const onVisibilityChange = () => {
		if (document.visibilityState === 'visible') refresh();
	};

	document.addEventListener('visibilitychange', onVisibilityChange);
	window.addEventListener('pageshow', refresh);

	let torn = false;
	return {
		get now() {
			return now;
		},
		destroy() {
			if (torn) return;
			torn = true;
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('pageshow', refresh);
		}
	};
}
