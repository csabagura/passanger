// AD-4b: the cross-route Capture entry point. A small UI-only state object (open + segment mode)
// provided once at the layout under the string key 'captureSheet' (matching the settings/vehicles
// convention) and consumed by the FAB, the Sheet, and the layout's deep-link $effect. No state
// library. `.svelte.ts` because it owns `$state` — unlike state/toast.ts, which holds none.
//
// Factory (not a module singleton) so each layout instance / test gets its own isolated state,
// mirroring the settings/vehicles getter-object pattern in +layout.svelte.

export type CaptureMode = 'fuel' | 'expense';

/**
 * Optional values to pre-fill a freshly-opened Capture form (AD-4b: the context is "open/close +
 * prefill"). Story 3.5 uses `expenseType` so "Log this service" seeds the Expense Type with the
 * reminder title. Reset on every open and cleared on close so a plain FAB tap never inherits a
 * stale prefill.
 */
export interface CapturePrefill {
	expenseType?: string;
}

export interface CaptureSheetContext {
	readonly open: boolean;
	readonly mode: CaptureMode;
	readonly prefill: CapturePrefill | null;
	/** Open the sheet; FAB passes 'fuel', the deep link passes the matched param. Omit to keep mode.
	 *  `prefill` seeds the opened form (cleared on a plain open) — AD-4b "open/close + prefill". */
	openSheet(mode?: CaptureMode, prefill?: CapturePrefill): void;
	/** Swap the active segment without opening/closing — the segmented-control onValueChange. */
	setMode(mode: CaptureMode): void;
	close(): void;
}

export function createCaptureSheet(): CaptureSheetContext {
	let open = $state(false);
	let mode = $state<CaptureMode>('fuel');
	let prefill = $state<CapturePrefill | null>(null);

	return {
		get open() {
			return open;
		},
		get mode() {
			return mode;
		},
		get prefill() {
			return prefill;
		},
		openSheet(next, nextPrefill) {
			if (next) mode = next;
			// Set on EVERY open so a fresh FAB tap (no prefill arg) clears any stale value.
			prefill = nextPrefill ?? null;
			open = true;
		},
		setMode(next) {
			mode = next;
		},
		close() {
			open = false;
			prefill = null;
		}
	};
}
