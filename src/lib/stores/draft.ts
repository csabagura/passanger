/**
 * AC4: Cross-tab draft state store.
 *
 * Preserves unsaved form field values across tab navigation.
 *
 * SvelteKit snapshots restore state only when the user navigates BACK in browser
 * history. Normal bottom-nav taps push NEW history entries, so a Fuel → Maintenance
 * → Fuel revisit creates a fresh Fuel entry — snapshot.restore() is never called for
 * the earlier Fuel visit and unsaved data would be lost.
 *
 * Module-level plain objects solve this: they live for the full app session regardless
 * of history state, so any tab revisit pattern (forward, backward, repeated) finds the
 * draft intact.
 *
 * Form bindings are added in:
 *   - Story 1.5: fuel-entry form → bind to `fuelDraft`
 *   - Story 1.6: maintenance form → bind to `maintenanceDraft`
 */

/** Unsaved fuel fill-up form fields. Cleared on successful submission. */
export const fuelDraft: Record<string, string> = {};

/** Unsaved maintenance/expense form fields. Cleared on successful submission. */
export const maintenanceDraft: Record<string, string> = {};

/** Wipe all fuel draft values (call after successful fuel-entry form submission). */
export function clearFuelDraft(): void {
	for (const key of Object.keys(fuelDraft)) {
		delete fuelDraft[key];
	}
}

/** Wipe all maintenance draft values (call after successful maintenance form submission). */
export function clearMaintenanceDraft(): void {
	for (const key of Object.keys(maintenanceDraft)) {
		delete maintenanceDraft[key];
	}
}
