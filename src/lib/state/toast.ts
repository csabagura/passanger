import { toast as sonner } from 'svelte-sonner';
import { TOAST_DURATION_MS, TOAST_UNDO_DURATION_MS } from '$lib/config';

// AD-2: the single toast/undo channel is `svelte-sonner` mounted once in the root layout and
// exposed via a thin `toast` context. This wrapper is the only place that touches the sonner
// singleton, so surfaces depend on a stable, typed API rather than sonner's option shape.
// Plain `.ts` (no runes state) — it forwards to a global singleton, it holds none itself.

export interface ToastApi {
	success(message: string): void;
	error(message: string): void;
	action(message: string, opts: { label: string; onClick: () => void }): void;
}

export const toast: ToastApi = {
	success(message) {
		sonner.success(message, { duration: TOAST_DURATION_MS });
	},
	error(message) {
		// `important` flips sonner's per-toast aria-live to "assertive" (Toast.svelte) so failures
		// interrupt assistive tech — AC4. Success/action stay polite.
		sonner.error(message, { duration: TOAST_DURATION_MS, important: true });
	},
	action(message, opts) {
		// sonner's `ToastAction.onClick` is a MouseEventHandler; a `() => void` is assignable to it.
		// The longer window is the ~5s Undo grace FR-7/AD-7 will reuse for reversible deletes.
		sonner(message, {
			action: { label: opts.label, onClick: opts.onClick },
			duration: TOAST_UNDO_DURATION_MS
		});
	}
};
