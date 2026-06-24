import { describe, it, expect } from 'vitest';
import {
	expenseMatchesReminder,
	resetMarkerPatch,
	currentOdometerFromLogs
} from './reminderLoopClose';
import type { FuelLog } from '$lib/db/schema';

// Story 4.6 (FR-12 loop-close / DEC-6): pure token-match + reset-patch helpers. No DB, no Svelte.

describe('expenseMatchesReminder (DEC-6 case-insensitive shared-token match)', () => {
	it('matches case-insensitively on an identical single token', () => {
		expect(expenseMatchesReminder('Oil', 'oil')).toBe(true);
		expect(expenseMatchesReminder('OIL CHANGE', 'oil change')).toBe(true);
	});

	it('matches when the two titles share ≥1 whole token (multi-token)', () => {
		// "Oil Change" ↔ "Oil change" share both tokens.
		expect(expenseMatchesReminder('Oil Change', 'Oil change')).toBe(true);
		// Share only "oil".
		expect(expenseMatchesReminder('Oil Change', 'Oil filter')).toBe(true);
	});

	it('matches on a single shared token even when other tokens differ (accepted stop-word case)', () => {
		// "service" is the shared token — an accepted false-positive per OQ-2.
		expect(expenseMatchesReminder('Tyre service', 'Brake service')).toBe(true);
	});

	it('does NOT match when no whole token is shared', () => {
		expect(expenseMatchesReminder('Tyres', 'Timing belt')).toBe(false);
		expect(expenseMatchesReminder('Insurance', 'Oil change')).toBe(false);
	});

	it('uses whole-token equality, NOT substring (so "tire" does not match "entire")', () => {
		expect(expenseMatchesReminder('tire', 'entire rebuild')).toBe(false);
	});

	it('tokenizes punctuation cleanly (split on \\W+ — hyphen/slash are separators)', () => {
		expect(expenseMatchesReminder('Oil-change', 'Oil/filter')).toBe(true);
		// Underscore is a \w char, so it is NOT a separator — "Oil_change" stays one token.
		expect(expenseMatchesReminder('Oil_change', 'oil')).toBe(false);
	});

	it('returns false for empty / whitespace-only / punctuation-only inputs (no tokens)', () => {
		expect(expenseMatchesReminder('', 'Oil change')).toBe(false);
		expect(expenseMatchesReminder('Oil change', '')).toBe(false);
		expect(expenseMatchesReminder('   ', 'Oil change')).toBe(false);
		expect(expenseMatchesReminder('---', '///')).toBe(false);
	});
});

describe('resetMarkerPatch (builds the marker write so status recomputes toward ok)', () => {
	const serviceDate = new Date(2026, 5, 24);

	it('includes both fields for a valid finite positive odometer', () => {
		expect(resetMarkerPatch(serviceDate, 87400)).toEqual({
			lastServiceDate: serviceDate,
			lastServiceOdometer: 87400
		});
	});

	it('is date-only when the odometer is undefined', () => {
		expect(resetMarkerPatch(serviceDate, undefined)).toEqual({ lastServiceDate: serviceDate });
	});

	it('is date-only when the odometer is 0 (repo rejects ≤0)', () => {
		expect(resetMarkerPatch(serviceDate, 0)).toEqual({ lastServiceDate: serviceDate });
	});

	it('is date-only for non-finite odometers (NaN / Infinity)', () => {
		expect(resetMarkerPatch(serviceDate, NaN)).toEqual({ lastServiceDate: serviceDate });
		expect(resetMarkerPatch(serviceDate, Infinity)).toEqual({ lastServiceDate: serviceDate });
	});

	it('always sets lastServiceDate to the supplied service date', () => {
		const patch = resetMarkerPatch(serviceDate, 100);
		expect(patch.lastServiceDate).toBe(serviceDate);
	});
});

describe('currentOdometerFromLogs (max finite odometer across the vehicle fuel logs)', () => {
	function log(odometer: number): FuelLog {
		return { odometer } as FuelLog;
	}

	it('returns the max odometer across logs', () => {
		expect(currentOdometerFromLogs([log(50000), log(52000), log(51000)])).toBe(52000);
	});

	it('returns undefined when there are no logs', () => {
		expect(currentOdometerFromLogs([])).toBe(undefined);
	});

	it('drops non-finite odometers (a single NaN would otherwise poison Math.max)', () => {
		expect(currentOdometerFromLogs([log(50000), log(NaN), log(52000)])).toBe(52000);
	});

	it('returns undefined when no log has a finite odometer', () => {
		expect(currentOdometerFromLogs([log(NaN), log(Infinity)])).toBe(undefined);
	});
});
