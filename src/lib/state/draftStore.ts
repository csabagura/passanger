/**
 * Story 2.3 (FR-5, AD-6): durable Capture drafts.
 *
 * Replaces the in-memory `stores/draft.ts`. The Fuel/Expense draft objects are still
 * module-level (so a Fuel → Expense segment switch or a bottom-nav revisit within a
 * session keeps the values — SvelteKit snapshots only restore on browser Back; see
 * `ac4-snapshot.test.ts`), but each mutation is now ALSO written through to localStorage
 * synchronously. A reload, a backgrounded tab, or a PWA cold-start re-hydrates the draft
 * from localStorage at module init — durability is layered ON TOP of the in-memory object,
 * never replacing it.
 *
 * Mechanism: each draft is a plain JS `Proxy` over a STABLE backing `Record<string,string>`.
 * The `set`/`deleteProperty` traps call a synchronous `persist()`, so the forms' existing
 * `fuelDraft['x'] = v` / `delete fuelDraft['x']` call sites write through with no change to
 * their bodies — only the import path moved. This is plain persistence: NOT a `.svelte.ts`
 * rune module (no `$state`/`$effect`); reactivity lives in the forms.
 *
 * Staleness (AC-4): a restored draft older than `DRAFT_STALE_DAYS` keeps the user's typed
 * value fields but drops the odometer (and, for expense, the date) so the forms re-derive a
 * fresh suggestion / today; a calm notice flags the stale restore.
 *
 * Persistence is fire-and-forget (`void`, no `Result<T>`) and best-effort: it never throws,
 * mirroring `storagePersistence.ts` / `settings.ts` (try/catch swallowing quota/security,
 * SSR-guard for an absent `localStorage`). Drafts are localStorage only — AD-6 explicitly
 * rejected a Dexie `drafts` table; this module touches no `src/lib/db/**`.
 */
import {
	DRAFT_FUEL_STORAGE_KEY,
	DRAFT_EXPENSE_STORAGE_KEY,
	DRAFT_CURRENCY_STORAGE_KEY,
	DRAFT_STALE_DAYS
} from '$lib/config';

type Fields = Record<string, string>;

const MS_PER_DAY = 86_400_000;
const RECENT_CURRENCIES_CAP = 3;

// ---------------------------------------------------------------------------
// Safe localStorage helpers — never throw; SSR-guarded; silently no-op on failure
// (mirrors storagePersistence.ts / settings.ts idioms).
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
		// Silently handle QuotaExceededError, SecurityError, etc. — durability is best-effort.
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

// ---------------------------------------------------------------------------
// Write-through draft factory
// ---------------------------------------------------------------------------

interface DraftHandle {
	/** Proxy exposed to the forms — assignments/deletions write through to localStorage. */
	draft: Fields;
	/** Empty the draft (in memory + localStorage) and reset its stale flag. */
	clear: () => void;
	/** Whether the most recent hydration restored a stale draft (re-validation applied). Pure. */
	wasStale: () => boolean;
	/**
	 * One-shot variant of {@link wasStale}: returns the flag and resets it, so the stale-restore
	 * notice fires exactly once per stale restore rather than on every form remount.
	 */
	consume: () => boolean;
	/** Re-run hydration in place (module-init parity for tests). */
	load: () => void;
}

/**
 * Build a write-through draft. `staleFields` are the fields dropped (for re-validation) when
 * a restored draft is older than `DRAFT_STALE_DAYS`.
 */
function makeDraft(key: string, staleFields: string[]): DraftHandle {
	// STABLE backing ref — the Proxy wraps this exact object; hydration/clear mutate it in
	// place rather than reassigning it, so the proxy never points at a stale object.
	const fields: Fields = {};
	let wasStale = false;

	const persist = (): void => {
		if (Object.keys(fields).length === 0) {
			safeRemove(key);
		} else {
			safeSet(key, JSON.stringify({ fields, updatedAt: Date.now() }));
		}
	};

	const load = (): void => {
		for (const k of Object.keys(fields)) delete fields[k];
		wasStale = false;

		const raw = safeGet(key);
		if (!raw) return;

		try {
			const parsed = JSON.parse(raw) as { fields?: unknown; updatedAt?: unknown };
			const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0;
			// H16(d): a future updatedAt (clock skew, corrupted payload) counts as stale too — a
			// timestamp that can never legitimately be "not yet old enough" is itself untrustworthy.
			const isOld =
				updatedAt > 0 &&
				(Date.now() - updatedAt > DRAFT_STALE_DAYS * MS_PER_DAY || updatedAt > Date.now());
			let droppedStaleField = false;

			if (parsed.fields && typeof parsed.fields === 'object') {
				for (const [k, v] of Object.entries(parsed.fields as Record<string, unknown>)) {
					if (typeof v !== 'string') continue; // keep only string values
					if (isOld && staleFields.includes(k)) {
						// Drop the re-validation fields on a stale restore so existing form logic
						// re-derives them (odometer seed / today's date).
						droppedStaleField = true;
						continue;
					}
					fields[k] = v;
				}
			}

			// Flag (and re-validate) ONLY when an old draft actually had a field to drop — an
			// age-only draft with no odometer/date restores verbatim, without a misleading notice.
			wasStale = droppedStaleField;

			// Re-persist the pruned result so localStorage matches the re-validated in-memory
			// state; otherwise the dropped odometer/date lingers and is re-detected as stale on
			// every subsequent reload. persist() removes the key when nothing is left.
			if (droppedStaleField) persist();
		} catch {
			// Corrupt payload → empty draft, no throw (mirror settings.ts "return defaults").
		}
	};
	load();

	const draft = new Proxy(fields, {
		set(target, prop: string, value) {
			// Coerce defensively: the draft holds strings only, so a non-string would otherwise
			// survive in memory but be silently dropped by the string-only hydration filter on
			// reload (in-memory ↔ persisted divergence). Current callers always pass strings.
			const next = String(value);
			// H16(c) root fix: a write-through effect re-asserting an UNCHANGED restored value (e.g.
			// on mount, before the user has typed anything) must not bump updatedAt — otherwise a
			// restored draft perpetually refreshes its own staleness clock and never goes stale.
			if (target[prop] === next) return true;
			target[prop] = next;
			persist();
			return true;
		},
		deleteProperty(target, prop: string) {
			if (!(prop in target)) return true;
			delete target[prop];
			persist();
			return true;
		}
	});

	const clear = (): void => {
		// Operate on the raw backing object (not the proxy) so we persist once via safeRemove,
		// not N times through the deleteProperty trap.
		for (const k of Object.keys(fields)) delete fields[k];
		safeRemove(key);
		wasStale = false;
	};

	// One-shot read for the UI: return the stale flag and reset it, so the notice shows once per
	// stale restore rather than on every form remount (clear()/load() also reset it).
	const consume = (): boolean => {
		const stale = wasStale;
		wasStale = false;
		return stale;
	};

	return { draft, clear, wasStale: () => wasStale, consume, load };
}

const fuel = makeDraft(DRAFT_FUEL_STORAGE_KEY, ['odometer']);
const expense = makeDraft(DRAFT_EXPENSE_STORAGE_KEY, ['odometer', 'date']);

/** Unsaved fuel fill-up form fields. Write-through to localStorage; cleared on save. */
export const fuelDraft = fuel.draft;
/** Unsaved maintenance/expense form fields. Write-through to localStorage; cleared on save. */
export const maintenanceDraft = expense.draft;

/** Wipe the fuel draft (call after a successful fuel-entry create). */
export const clearFuelDraft = fuel.clear;
/** Wipe the maintenance draft (call after a successful expense create). */
export const clearMaintenanceDraft = expense.clear;

/** Whether the restored fuel draft was stale (odometer re-validated). Pure read (tests/inspection). */
export const wasFuelDraftStale = fuel.wasStale;
/** Whether the restored expense draft was stale (odometer + date re-validated). Pure read. */
export const wasMaintenanceDraftStale = expense.wasStale;

/**
 * One-shot: returns whether the fuel draft was restored stale and resets the flag. The forms call
 * THIS (not {@link wasFuelDraftStale}) so the calm notice shows once per stale restore, never again
 * on a Fuel↔Expense segment toggle / remount within the same session.
 */
export const consumeFuelDraftStale = fuel.consume;
/** One-shot: returns whether the expense draft was restored stale and resets the flag. */
export const consumeMaintenanceDraftStale = expense.consume;

// ---------------------------------------------------------------------------
// Durable currency memory (Story 2.2 handoff — Task 4)
//
// Story 2.2 left `lastUsedCurrency` + `recentCurrencies` session-scoped and punted durable
// persistence to 2.3. Same localStorage mechanism. Semantics are identical to the former
// stores/draft.ts (verbatim `!==` dedup — no trim/case-fold; cap at 3; most-recent-first);
// the only change is that each setter also persists.
// ---------------------------------------------------------------------------

let lastUsedCurrency: string | null = null;
let recentCurrencies: string[] = [];

function persistCurrency(): void {
	safeSet(
		DRAFT_CURRENCY_STORAGE_KEY,
		JSON.stringify({ last: lastUsedCurrency, recent: recentCurrencies })
	);
}

function loadCurrency(): void {
	lastUsedCurrency = null;
	recentCurrencies = [];

	const raw = safeGet(DRAFT_CURRENCY_STORAGE_KEY);
	if (!raw) return;

	try {
		const parsed = JSON.parse(raw) as { last?: unknown; recent?: unknown };
		if (typeof parsed.last === 'string') lastUsedCurrency = parsed.last;
		if (Array.isArray(parsed.recent)) {
			recentCurrencies = parsed.recent
				.filter((c): c is string => typeof c === 'string')
				.slice(0, RECENT_CURRENCIES_CAP);
		}
	} catch {
		// Corrupt payload → empty memory, no throw.
	}
}
loadCurrency();

/** The remembered entry currency, or `null` if the user hasn't picked one yet. */
export function getLastUsedCurrency(): string | null {
	return lastUsedCurrency;
}

/**
 * Remember the currency just logged and promote it to the front of the recent list (verbatim
 * `!==` dedup, capped). Also persists durably so the next session opens on the same currency.
 */
export function setLastUsedCurrency(currency: string): void {
	lastUsedCurrency = currency;
	recentCurrencies = [currency, ...recentCurrencies.filter((c) => c !== currency)].slice(
		0,
		RECENT_CURRENCIES_CAP
	);
	persistCurrency();
}

/** The recent currencies, most-recent-first (a copy; empty until the user picks one). */
export function getRecentCurrencies(): string[] {
	return [...recentCurrencies];
}

/** Reset the currency memory (in memory + localStorage). */
export function clearSessionCurrencyMemory(): void {
	lastUsedCurrency = null;
	recentCurrencies = [];
	safeRemove(DRAFT_CURRENCY_STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Test-only re-hydration hook
//
// Module-init hydration is otherwise un-retriggerable in a unit test (the module is
// evaluated once). Re-runs all three load paths in place. Matches the house style of the
// existing `clearSessionCurrencyMemory` test-reset export.
// ---------------------------------------------------------------------------

/** Re-run hydration for both drafts and the currency memory (tests / explicit re-read). */
export function loadDraftsFromStorage(): void {
	fuel.load();
	expense.load();
	loadCurrency();
}
