// AD-4b: the cross-route Capture entry point. A small UI-only state object (open + segment mode)
// provided once at the layout under the string key 'captureSheet' (matching the settings/vehicles
// convention) and consumed by the FAB, the Sheet, and the layout's deep-link $effect. No state
// library. `.svelte.ts` because it owns `$state` — unlike state/toast.ts, which holds none.
//
// Factory (not a module singleton) so each layout instance / test gets its own isolated state,
// mirroring the settings/vehicles getter-object pattern in +layout.svelte.

export type CaptureMode = 'fuel' | 'expense';

export interface CaptureSheetContext {
	readonly open: boolean;
	readonly mode: CaptureMode;
	/** Open the sheet; FAB passes 'fuel', the deep link passes the matched param. Omit to keep mode. */
	openSheet(mode?: CaptureMode): void;
	/** Swap the active segment without opening/closing — the segmented-control onValueChange. */
	setMode(mode: CaptureMode): void;
	close(): void;
}

export function createCaptureSheet(): CaptureSheetContext {
	let open = $state(false);
	let mode = $state<CaptureMode>('fuel');

	return {
		get open() {
			return open;
		},
		get mode() {
			return mode;
		},
		openSheet(next) {
			if (next) mode = next;
			open = true;
		},
		setMode(next) {
			mode = next;
		},
		close() {
			open = false;
		}
	};
}
