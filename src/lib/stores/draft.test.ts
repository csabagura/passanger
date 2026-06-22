import { describe, it, expect, beforeEach } from 'vitest';
import {
	getLastUsedCurrency,
	setLastUsedCurrency,
	getRecentCurrencies,
	clearFuelDraft,
	clearMaintenanceDraft,
	clearSessionCurrencyMemory,
	fuelDraft,
	maintenanceDraft
} from './draft';

beforeEach(() => {
	// Reset all module-level session singletons between tests so each starts clean.
	clearFuelDraft();
	clearMaintenanceDraft();
	clearSessionCurrencyMemory();
});

describe('recentCurrencies', () => {
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

describe('draft objects remain unaffected', () => {
	it('does not perturb fuelDraft / maintenanceDraft', () => {
		fuelDraft['odometer'] = '100';
		maintenanceDraft['cost'] = '20';
		setLastUsedCurrency('€');
		expect(fuelDraft['odometer']).toBe('100');
		expect(maintenanceDraft['cost']).toBe('20');
	});
});
