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

/**
 * Last currency the user picked while logging an entry (fuel or maintenance). Lives for
 * the whole app session — NOT cleared on submit — so a trip's worth of entries stay in
 * the same currency without re-picking each time. `null` until the user changes it; the
 * forms fall back to the home currency from settings.
 */
let lastUsedCurrency: string | null = null;

/** The remembered entry currency, or `null` if the user hasn't picked one this session. */
export function getLastUsedCurrency(): string | null {
	return lastUsedCurrency;
}

/** Remember the currency the user just logged in, for the next new entry. */
export function setLastUsedCurrency(currency: string): void {
	lastUsedCurrency = currency;
}
