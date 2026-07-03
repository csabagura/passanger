import { describe, it, expect } from 'vitest';
import {
	expenseMatchesReminder,
	resetMarkerPatch,
	currentOdometerFromLogs,
	odometerAtDate
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

	it('tokenizes punctuation cleanly (hyphen/slash/underscore are separators)', () => {
		expect(expenseMatchesReminder('Oil-change', 'Oil/filter')).toBe(true);
		// Story 8.5 / S21: the tokenizer now splits on anything that isn't a Unicode letter/digit —
		// underscore is neither, so unlike the pre-8.5 ASCII \W-based split it IS now a separator.
		expect(expenseMatchesReminder('Oil_change', 'oil')).toBe(true);
	});

	// Story 8.5 / S21: Unicode-aware tokenizer — accented Hungarian characters no longer fragment
	// a title into cross-matching shards.
	it('treats accented Unicode letters as token characters, not separators (Hungarian titles)', () => {
		// "Olajcsere" (oil change) shares the whole token, not a fragment either side of the accent.
		expect(expenseMatchesReminder('Olajcsere', 'Olajcsere')).toBe(true);
		expect(expenseMatchesReminder('Fékbetét csere', 'Fékbetét csere')).toBe(true);
		// Before the fix, an ASCII \W-only split still worked for THESE examples (no non-letter
		// chars around the accents) — the real bug was accented chars WERE already letters to \W
		// (\W = "not \w", and \w only recognizes ASCII, so an accented letter like é already fails
		// \w and is erroneously treated as a SEPARATOR). Prove the old-vs-new split difference
		// directly: "Fékbetét" must stay ONE token, not fragment into "f", "kbet", "t".
		expect(expenseMatchesReminder('Fékbetét', 'F')).toBe(false);
		expect(expenseMatchesReminder('Fékbetét', 'kbet')).toBe(false);
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

	it('includes both fields for a valid finite positive odometer, plus the expense provenance stamp', () => {
		expect(resetMarkerPatch(serviceDate, 87400, 42)).toEqual({
			lastServiceDate: serviceDate,
			lastServiceOdometer: 87400,
			lastClosedByExpenseId: 42
		});
	});

	it('is date-only (+ provenance) when the odometer is undefined', () => {
		expect(resetMarkerPatch(serviceDate, undefined, 42)).toEqual({
			lastServiceDate: serviceDate,
			lastClosedByExpenseId: 42
		});
	});

	it('is date-only when the odometer is 0 (repo rejects ≤0)', () => {
		expect(resetMarkerPatch(serviceDate, 0, 42)).toEqual({
			lastServiceDate: serviceDate,
			lastClosedByExpenseId: 42
		});
	});

	it('is date-only for non-finite odometers (NaN / Infinity)', () => {
		expect(resetMarkerPatch(serviceDate, NaN, 42)).toEqual({
			lastServiceDate: serviceDate,
			lastClosedByExpenseId: 42
		});
		expect(resetMarkerPatch(serviceDate, Infinity, 42)).toEqual({
			lastServiceDate: serviceDate,
			lastClosedByExpenseId: 42
		});
	});

	it('always sets lastServiceDate to the supplied service date', () => {
		const patch = resetMarkerPatch(serviceDate, 100, 42);
		expect(patch.lastServiceDate).toBe(serviceDate);
	});

	it('always stamps lastClosedByExpenseId with the supplied expense id (Story 8.5 / H18)', () => {
		expect(resetMarkerPatch(serviceDate, 100, 7).lastClosedByExpenseId).toBe(7);
		expect(resetMarkerPatch(serviceDate, undefined, 7).lastClosedByExpenseId).toBe(7);
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

describe('odometerAtDate (Story 8.5, H11/AD-RT-3 — vehicle odometer interpolated at a timestamp)', () => {
	function dated(date: string, odometer: number): FuelLog {
		return { date: new Date(date), odometer } as FuelLog;
	}

	it('returns undefined when the vehicle has zero fuel logs', () => {
		expect(odometerAtDate([], new Date('2025-06-01').getTime())).toBeUndefined();
	});

	it('returns the earliest log odometer when the timestamp predates every log', () => {
		const logs = [dated('2025-03-01', 40000), dated('2025-06-01', 45000)];
		expect(odometerAtDate(logs, new Date('2025-01-01').getTime())).toBe(40000);
	});

	it('returns the exact-match log odometer when the timestamp equals a log date', () => {
		const logs = [dated('2025-03-01', 40000), dated('2025-06-01', 45000)];
		expect(odometerAtDate(logs, new Date('2025-06-01').getTime())).toBe(45000);
	});

	it('returns the nearest-before log odometer when the timestamp falls between logs', () => {
		const logs = [
			dated('2025-03-01', 40000),
			dated('2025-06-01', 45000),
			dated('2025-09-01', 50000)
		];
		expect(odometerAtDate(logs, new Date('2025-07-01').getTime())).toBe(45000);
	});

	it('returns the latest log odometer when the timestamp is after every log', () => {
		const logs = [dated('2025-03-01', 40000), dated('2025-06-01', 45000)];
		expect(odometerAtDate(logs, new Date('2025-12-01').getTime())).toBe(45000);
	});

	it('is order-independent (sorts input by date internally)', () => {
		const logs = [
			dated('2025-09-01', 50000),
			dated('2025-03-01', 40000),
			dated('2025-06-01', 45000)
		];
		expect(odometerAtDate(logs, new Date('2025-07-01').getTime())).toBe(45000);
	});

	it('drops non-finite odometers before selecting', () => {
		const logs = [dated('2025-03-01', NaN), dated('2025-06-01', 45000)];
		expect(odometerAtDate(logs, new Date('2025-01-01').getTime())).toBe(45000);
	});
});
