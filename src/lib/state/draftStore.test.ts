import { describe, it, expect, beforeEach } from 'vitest';
import {
	DRAFT_FUEL_STORAGE_KEY,
	DRAFT_EXPENSE_STORAGE_KEY,
	DRAFT_CURRENCY_STORAGE_KEY,
	DRAFT_STALE_DAYS
} from '$lib/config';
import {
	fuelDraft,
	maintenanceDraft,
	clearFuelDraft,
	clearMaintenanceDraft,
	wasFuelDraftStale,
	wasMaintenanceDraftStale,
	consumeFuelDraftStale,
	consumeMaintenanceDraftStale,
	loadDraftsFromStorage,
	getLastUsedCurrency,
	setLastUsedCurrency,
	getRecentCurrencies,
	clearSessionCurrencyMemory
} from './draftStore';

const MS_PER_DAY = 86_400_000;

beforeEach(() => {
	// Reset durable + in-memory state: clear storage, then re-hydrate the (now empty) drafts
	// and reset the session currency memory. jsdom provides a real localStorage.
	localStorage.clear();
	loadDraftsFromStorage();
	clearSessionCurrencyMemory();
});

describe('write-through to localStorage (AC-3)', () => {
	it('persists each field assignment synchronously as { fields, updatedAt }', () => {
		fuelDraft['quantity'] = '40';
		const raw = localStorage.getItem(DRAFT_FUEL_STORAGE_KEY);
		expect(raw).not.toBeNull();
		const parsed = JSON.parse(raw as string);
		expect(parsed.fields).toEqual({ quantity: '40' });
		expect(typeof parsed.updatedAt).toBe('number');
	});

	it('re-persists without a deleted field, and removes the key when the last field is deleted', () => {
		fuelDraft['quantity'] = '40';
		fuelDraft['cost'] = '60';
		delete fuelDraft['quantity'];
		expect(JSON.parse(localStorage.getItem(DRAFT_FUEL_STORAGE_KEY) as string).fields).toEqual({
			cost: '60'
		});

		delete fuelDraft['cost'];
		expect(localStorage.getItem(DRAFT_FUEL_STORAGE_KEY)).toBeNull();
	});

	it('keeps fuel and expense drafts in independent keys', () => {
		fuelDraft['quantity'] = '40';
		maintenanceDraft['cost'] = '20';
		expect(JSON.parse(localStorage.getItem(DRAFT_FUEL_STORAGE_KEY) as string).fields).toEqual({
			quantity: '40'
		});
		expect(JSON.parse(localStorage.getItem(DRAFT_EXPENSE_STORAGE_KEY) as string).fields).toEqual({
			cost: '20'
		});
	});

	it('coerces a non-string assignment to a string (P4 hardening)', () => {
		// The public proxy guards a non-string write from round-tripping to data loss: it is
		// coerced so the in-memory and reloaded shapes agree. (Form call sites always pass strings.)
		(fuelDraft as Record<string, unknown>)['n'] = 5;
		expect(fuelDraft['n']).toBe('5');
		expect(JSON.parse(localStorage.getItem(DRAFT_FUEL_STORAGE_KEY) as string).fields.n).toBe('5');
		loadDraftsFromStorage();
		expect(fuelDraft['n']).toBe('5');
	});
});

describe('hydration on reload (AC-1)', () => {
	it('restores field values from a pre-seeded key', () => {
		localStorage.setItem(
			DRAFT_FUEL_STORAGE_KEY,
			JSON.stringify({ fields: { quantity: '40', cost: '60' }, updatedAt: Date.now() })
		);
		loadDraftsFromStorage();
		expect(fuelDraft['quantity']).toBe('40');
		expect(fuelDraft['cost']).toBe('60');
		expect(wasFuelDraftStale()).toBe(false);
	});

	it('ignores non-string field values during hydration', () => {
		localStorage.setItem(
			DRAFT_EXPENSE_STORAGE_KEY,
			JSON.stringify({ fields: { cost: '20', bogus: 42 }, updatedAt: Date.now() })
		);
		loadDraftsFromStorage();
		expect(maintenanceDraft['cost']).toBe('20');
		expect('bogus' in maintenanceDraft).toBe(false);
	});
});

describe('clear on save (AC-5)', () => {
	it('clearFuelDraft empties the object and removes the localStorage key', () => {
		fuelDraft['quantity'] = '40';
		clearFuelDraft();
		expect(Object.keys(fuelDraft)).toHaveLength(0);
		expect(localStorage.getItem(DRAFT_FUEL_STORAGE_KEY)).toBeNull();
	});

	it('clearMaintenanceDraft empties the object and removes the localStorage key', () => {
		maintenanceDraft['cost'] = '20';
		clearMaintenanceDraft();
		expect(Object.keys(maintenanceDraft)).toHaveLength(0);
		expect(localStorage.getItem(DRAFT_EXPENSE_STORAGE_KEY)).toBeNull();
	});
});

describe('staleness re-validation (AC-4)', () => {
	const staleAt = () => Date.now() - (DRAFT_STALE_DAYS + 1) * MS_PER_DAY;

	it('drops the fuel odometer but keeps value fields on a stale draft', () => {
		localStorage.setItem(
			DRAFT_FUEL_STORAGE_KEY,
			JSON.stringify({ fields: { odometer: '12000', quantity: '40' }, updatedAt: staleAt() })
		);
		loadDraftsFromStorage();
		expect('odometer' in fuelDraft).toBe(false);
		expect(fuelDraft['quantity']).toBe('40');
		expect(wasFuelDraftStale()).toBe(true);
	});

	it('drops the expense odometer AND date but keeps value fields on a stale draft', () => {
		localStorage.setItem(
			DRAFT_EXPENSE_STORAGE_KEY,
			JSON.stringify({
				fields: { odometer: '12000', date: '2026-01-01', cost: '50', type: 'Oil change' },
				updatedAt: staleAt()
			})
		);
		loadDraftsFromStorage();
		expect('odometer' in maintenanceDraft).toBe(false);
		expect('date' in maintenanceDraft).toBe(false);
		expect(maintenanceDraft['cost']).toBe('50');
		expect(maintenanceDraft['type']).toBe('Oil change');
		expect(wasMaintenanceDraftStale()).toBe(true);
	});

	it('restores everything and reports not-stale for a fresh draft', () => {
		localStorage.setItem(
			DRAFT_FUEL_STORAGE_KEY,
			JSON.stringify({ fields: { odometer: '12000', quantity: '40' }, updatedAt: Date.now() })
		);
		loadDraftsFromStorage();
		expect(fuelDraft['odometer']).toBe('12000');
		expect(fuelDraft['quantity']).toBe('40');
		expect(wasFuelDraftStale()).toBe(false);
	});

	it('resets the stale flag after clear', () => {
		localStorage.setItem(
			DRAFT_FUEL_STORAGE_KEY,
			JSON.stringify({ fields: { odometer: '12000' }, updatedAt: staleAt() })
		);
		loadDraftsFromStorage();
		expect(wasFuelDraftStale()).toBe(true);
		clearFuelDraft();
		expect(wasFuelDraftStale()).toBe(false);
	});

	it('re-persists the pruned draft so a second reload no longer re-flags it stale (P1)', () => {
		localStorage.setItem(
			DRAFT_FUEL_STORAGE_KEY,
			JSON.stringify({ fields: { odometer: '12000', quantity: '40' }, updatedAt: staleAt() })
		);
		loadDraftsFromStorage();
		// localStorage now mirrors the re-validated in-memory state: odometer gone, fresh updatedAt.
		const persisted = JSON.parse(localStorage.getItem(DRAFT_FUEL_STORAGE_KEY) as string);
		expect(persisted.fields).toEqual({ quantity: '40' });
		expect(Date.now() - persisted.updatedAt).toBeLessThan(MS_PER_DAY);
		// A second cold-start reads the pruned, freshly-stamped draft → no longer stale.
		loadDraftsFromStorage();
		expect(wasFuelDraftStale()).toBe(false);
		expect('odometer' in fuelDraft).toBe(false);
		expect(fuelDraft['quantity']).toBe('40');
	});

	it('removes the key entirely when the only field was a stale-dropped field (P1)', () => {
		localStorage.setItem(
			DRAFT_FUEL_STORAGE_KEY,
			JSON.stringify({ fields: { odometer: '12000' }, updatedAt: staleAt() })
		);
		loadDraftsFromStorage();
		expect(wasFuelDraftStale()).toBe(true);
		expect(Object.keys(fuelDraft)).toHaveLength(0);
		expect(localStorage.getItem(DRAFT_FUEL_STORAGE_KEY)).toBeNull();
	});

	it('does NOT flag an old draft that had no re-validation field (P2)', () => {
		localStorage.setItem(
			DRAFT_FUEL_STORAGE_KEY,
			JSON.stringify({ fields: { quantity: '40' }, updatedAt: staleAt() })
		);
		localStorage.setItem(
			DRAFT_EXPENSE_STORAGE_KEY,
			JSON.stringify({ fields: { cost: '50' }, updatedAt: staleAt() })
		);
		loadDraftsFromStorage();
		expect(fuelDraft['quantity']).toBe('40');
		expect(wasFuelDraftStale()).toBe(false);
		expect(maintenanceDraft['cost']).toBe('50');
		expect(wasMaintenanceDraftStale()).toBe(false);
	});
});

describe('stale notice is consumed once — show-once (AC-4)', () => {
	const staleAt = () => Date.now() - (DRAFT_STALE_DAYS + 1) * MS_PER_DAY;

	it('consumeFuelDraftStale returns true once then false; the pure wasFuelDraftStale does not reset', () => {
		localStorage.setItem(
			DRAFT_FUEL_STORAGE_KEY,
			JSON.stringify({ fields: { odometer: '12000', quantity: '40' }, updatedAt: staleAt() })
		);
		loadDraftsFromStorage();
		expect(wasFuelDraftStale()).toBe(true);
		expect(wasFuelDraftStale()).toBe(true); // pure peek does not consume
		expect(consumeFuelDraftStale()).toBe(true); // one-shot: true once...
		expect(consumeFuelDraftStale()).toBe(false); // ...then false on a would-be remount
		expect(wasFuelDraftStale()).toBe(false);
	});

	it('consumeMaintenanceDraftStale is one-shot too', () => {
		localStorage.setItem(
			DRAFT_EXPENSE_STORAGE_KEY,
			JSON.stringify({
				fields: { odometer: '9', date: '2026-01-01', cost: '5' },
				updatedAt: staleAt()
			})
		);
		loadDraftsFromStorage();
		expect(consumeMaintenanceDraftStale()).toBe(true);
		expect(consumeMaintenanceDraftStale()).toBe(false);
	});

	it('a fresh (non-stale) restore consumes to false', () => {
		localStorage.setItem(
			DRAFT_FUEL_STORAGE_KEY,
			JSON.stringify({ fields: { odometer: '12000' }, updatedAt: Date.now() })
		);
		loadDraftsFromStorage();
		expect(consumeFuelDraftStale()).toBe(false);
	});
});

describe('robustness against corrupt input', () => {
	it('yields an empty draft and does not throw on non-JSON', () => {
		localStorage.setItem(DRAFT_FUEL_STORAGE_KEY, 'not json');
		expect(() => loadDraftsFromStorage()).not.toThrow();
		expect(Object.keys(fuelDraft)).toHaveLength(0);
	});

	it('yields an empty draft when fields is not an object', () => {
		localStorage.setItem(DRAFT_EXPENSE_STORAGE_KEY, '{"fields":42}');
		expect(() => loadDraftsFromStorage()).not.toThrow();
		expect(Object.keys(maintenanceDraft)).toHaveLength(0);
	});
});

// Migrated verbatim from the former stores/draft.test.ts, then extended for durability (Task 4).
describe('recentCurrencies (session semantics preserved)', () => {
	it('records the most recent currency first', () => {
		setLastUsedCurrency('€');
		setLastUsedCurrency('$');
		expect(getRecentCurrencies()[0]).toBe('$');
		expect(getRecentCurrencies()).toContain('€');
	});

	it('dedupes case-sensitively and re-promotes a repeated pick to the front', () => {
		setLastUsedCurrency('€');
		setLastUsedCurrency('$');
		setLastUsedCurrency('€');
		const recent = getRecentCurrencies();
		expect(recent[0]).toBe('€');
		expect(recent.filter((c) => c === '€')).toHaveLength(1);
	});

	it('caps the list at 3 most-recent entries', () => {
		setLastUsedCurrency('€');
		setLastUsedCurrency('$');
		setLastUsedCurrency('£');
		setLastUsedCurrency('Ft');
		const recent = getRecentCurrencies();
		expect(recent).toHaveLength(3);
		expect(recent).toEqual(['Ft', '£', '$']);
		expect(recent).not.toContain('€');
	});

	it('keeps lastUsedCurrency in sync with the most recent pick', () => {
		setLastUsedCurrency('$');
		expect(getLastUsedCurrency()).toBe('$');
		expect(getRecentCurrencies()[0]).toBe('$');
	});

	it('treats different-case strings as distinct (verbatim identity)', () => {
		setLastUsedCurrency('kr');
		setLastUsedCurrency('KR');
		const recent = getRecentCurrencies();
		expect(recent).toContain('kr');
		expect(recent).toContain('KR');
	});
});

describe('durable currency memory (AC-1, Task 4)', () => {
	it('persists last + recent and restores them after reload', () => {
		setLastUsedCurrency('€');
		setLastUsedCurrency('$');
		const raw = localStorage.getItem(DRAFT_CURRENCY_STORAGE_KEY);
		expect(raw).not.toBeNull();
		expect(JSON.parse(raw as string)).toEqual({ last: '$', recent: ['$', '€'] });

		loadDraftsFromStorage();
		expect(getLastUsedCurrency()).toBe('$');
		expect(getRecentCurrencies()).toEqual(['$', '€']);
	});

	it('clearSessionCurrencyMemory resets state and removes the key', () => {
		setLastUsedCurrency('$');
		clearSessionCurrencyMemory();
		expect(getLastUsedCurrency()).toBeNull();
		expect(getRecentCurrencies()).toHaveLength(0);
		expect(localStorage.getItem(DRAFT_CURRENCY_STORAGE_KEY)).toBeNull();
	});

	it('survives corrupt currency storage without throwing', () => {
		localStorage.setItem(DRAFT_CURRENCY_STORAGE_KEY, 'not json');
		expect(() => loadDraftsFromStorage()).not.toThrow();
		expect(getLastUsedCurrency()).toBeNull();
		expect(getRecentCurrencies()).toHaveLength(0);
	});
});

describe('in-memory cross-navigation survives without a reload (AC-2)', () => {
	it('retains values on the live backing object — durability is layered on, not a replacement', () => {
		fuelDraft['quantity'] = '40';
		maintenanceDraft['cost'] = '20';
		// No loadDraftsFromStorage() here: a segment switch / bottom-nav revisit does NOT
		// re-init the module, so the in-memory object must still hold the values verbatim.
		expect(fuelDraft['quantity']).toBe('40');
		expect(maintenanceDraft['cost']).toBe('20');
	});
});

describe('draft objects remain unaffected by currency memory', () => {
	it('does not perturb fuelDraft / maintenanceDraft', () => {
		fuelDraft['odometer'] = '100';
		maintenanceDraft['cost'] = '20';
		setLastUsedCurrency('€');
		expect(fuelDraft['odometer']).toBe('100');
		expect(maintenanceDraft['cost']).toBe('20');
	});
});
