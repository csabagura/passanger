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

/**
 * Story 2.2: the most-recently-used currencies this session, most-recent-first, capped and
 * deduped. Powers the recent-currency chips so a road-trip's currencies are one tap away
 * without opening the `<select>`. Session-scoped + NOT cleared on submit (same lifetime as
 * `lastUsedCurrency`); durable cross-reload persistence is Story 2-3's concern (AD-6).
 */
const RECENT_CURRENCIES_CAP = 3;
let recentCurrencies: string[] = [];

/** The remembered entry currency, or `null` if the user hasn't picked one this session. */
export function getLastUsedCurrency(): string | null {
	return lastUsedCurrency;
}

/**
 * Remember the currency the user just logged in, for the next new entry, and promote it to
 * the front of the recent list (deduped verbatim — no trim/case-fold, matching the app's
 * currency-key identity rule — and capped to the most recent few).
 */
export function setLastUsedCurrency(currency: string): void {
	lastUsedCurrency = currency;
	recentCurrencies = [currency, ...recentCurrencies.filter((c) => c !== currency)].slice(
		0,
		RECENT_CURRENCIES_CAP
	);
}

/** The recent currencies this session, most-recent-first (empty until the user picks one). */
export function getRecentCurrencies(): string[] {
	return [...recentCurrencies];
}

/**
 * Reset the session currency memory (`lastUsedCurrency` + the recent list) to its initial
 * empty state. There is no runtime caller — currency memory lives for the whole session —
 * but tests need a real reset since the list is module-level singleton state.
 */
export function clearSessionCurrencyMemory(): void {
	lastUsedCurrency = null;
	recentCurrencies = [];
}
