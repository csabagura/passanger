import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REMINDER_DISMISSED_STORAGE_KEY } from '$lib/config';
import {
	clearDismissal,
	dismissReminder,
	isSuppressedByDismissal,
	pruneDismissals,
	readDismissals,
	writeDismissals,
	type ReminderDismissalMap
} from './reminderDismissal';

const TODAY = new Date(2026, 5, 15); // 2026-06-15 (local)

describe('reminderDismissal storage', () => {
	beforeEach(() => {
		globalThis.localStorage.clear();
		vi.restoreAllMocks();
	});

	afterEach(() => {
		globalThis.localStorage.clear();
	});

	it('round-trips read/write of the dismissal map', () => {
		const map: ReminderDismissalMap = { 1: { status: 'due-soon', dueAtOdometer: 60000 } };
		writeDismissals(map);
		expect(readDismissals()).toEqual(map);
	});

	it('returns an empty map when nothing is stored', () => {
		expect(readDismissals()).toEqual({});
	});

	it('returns an empty map (no throw) on malformed JSON', () => {
		globalThis.localStorage.setItem(REMINDER_DISMISSED_STORAGE_KEY, '{not valid json');
		expect(() => readDismissals()).not.toThrow();
		expect(readDismissals()).toEqual({});
	});

	it('returns an empty map (no throw) when getItem throws (storage blocked)', () => {
		vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(() => readDismissals()).not.toThrow();
		expect(readDismissals()).toEqual({});
	});

	it('swallows write failures (storage blocked)', () => {
		vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(() => writeDismissals({ 1: { status: 'overdue', dueAtOdometer: 1 } })).not.toThrow();
	});

	it('dismissReminder writes a { status, dueAtOdometer, dueAtDate } marker', () => {
		dismissReminder(7, 'overdue', 80000, '2026-07-01');
		expect(readDismissals()).toEqual({
			7: { status: 'overdue', dueAtOdometer: 80000, dueAtDate: '2026-07-01' }
		});
	});

	it('dismissReminder stores undefined due fields when none are known', () => {
		dismissReminder(7, 'overdue', undefined, undefined);
		// An entry with BOTH due fields undefined round-trips through JSON (keys drop, both absent),
		// which sanitizeMarker then treats as an old-shape/degenerate marker — absent on read.
		expect(readDismissals()[7]).toBeUndefined();
	});

	it('clearDismissal removes only the targeted entry', () => {
		writeDismissals({
			1: { status: 'due-soon', dueAtOdometer: 1000 },
			2: { status: 'overdue', dueAtDate: '2026-07-01' }
		});
		clearDismissal(1);
		expect(readDismissals()).toEqual({ 2: { status: 'overdue', dueAtDate: '2026-07-01' } });
	});

	// PREP-1 (Story 4.1) + Story 8.5 (AD-RT-4): a corrupt/legacy stored value must degrade safely —
	// a bad marker can never silently suppress a reminder forever, and an array is rejected.
	it('rejects a stored array (not a valid map)', () => {
		globalThis.localStorage.setItem(REMINDER_DISMISSED_STORAGE_KEY, JSON.stringify([1, 2, 3]));
		expect(readDismissals()).toEqual({});
	});

	it('drops a marker with an unknown status', () => {
		globalThis.localStorage.setItem(
			REMINDER_DISMISSED_STORAGE_KEY,
			JSON.stringify({
				1: { status: 'bogus', dueAtOdometer: 100 },
				2: { status: 'overdue', dueAtOdometer: 1 }
			})
		);
		expect(readDismissals()).toEqual({ 2: { status: 'overdue', dueAtOdometer: 1 } });
	});

	it('drops a marker with a non-finite dueAtOdometer but keeps valid siblings', () => {
		// JSON has no NaN literal; a tampered/legacy file might carry a string. Both are dropped.
		globalThis.localStorage.setItem(
			REMINDER_DISMISSED_STORAGE_KEY,
			'{"1":{"status":"overdue","dueAtOdometer":"NaN"},"2":{"status":"due-soon","dueAtOdometer":60000}}'
		);
		expect(readDismissals()).toEqual({ 2: { status: 'due-soon', dueAtOdometer: 60000 } });
	});

	it('drops a marker with a non-string dueAtDate', () => {
		globalThis.localStorage.setItem(
			REMINDER_DISMISSED_STORAGE_KEY,
			JSON.stringify({ 1: { status: 'overdue', dueAtDate: 12345 } })
		);
		expect(readDismissals()).toEqual({});
	});

	it('drops a non-object marker', () => {
		globalThis.localStorage.setItem(
			REMINDER_DISMISSED_STORAGE_KEY,
			JSON.stringify({ 1: 'not-a-marker', 2: { status: 'overdue', dueAtOdometer: 1 } })
		);
		expect(readDismissals()).toEqual({ 2: { status: 'overdue', dueAtOdometer: 1 } });
	});

	// Story 8.5 / AD-RT-4: the pre-8.5 `{status, odometer}` shape has neither `dueAtOdometer` nor
	// `dueAtDate` — it must be treated as absent/expired, never crash on read.
	it('treats an old-shape { status, odometer } marker as absent (not a crash)', () => {
		globalThis.localStorage.setItem(
			REMINDER_DISMISSED_STORAGE_KEY,
			JSON.stringify({ 1: { status: 'overdue', odometer: 60000 } })
		);
		expect(() => readDismissals()).not.toThrow();
		expect(readDismissals()).toEqual({});
	});
});

describe('isSuppressedByDismissal (Story 8.5 / AD-RT-4 exact due-instance expiry)', () => {
	it('returns false when there is no marker for the reminder', () => {
		expect(isSuppressedByDismissal(1, 'overdue', 60000, TODAY, {})).toBe(false);
	});

	it('returns true while status has not worsened and the due instance is not yet reached', () => {
		const map: ReminderDismissalMap = { 1: { status: 'due-soon', dueAtOdometer: 60000 } };
		expect(isSuppressedByDismissal(1, 'due-soon', 59999, TODAY, map)).toBe(true);
	});

	it('re-surfaces (false) when status worsens due-soon → overdue', () => {
		const map: ReminderDismissalMap = { 1: { status: 'due-soon', dueAtOdometer: 60000 } };
		expect(isSuppressedByDismissal(1, 'overdue', 59000, TODAY, map)).toBe(false);
	});

	it('stays suppressed (true) when status improves overdue → due-soon', () => {
		const map: ReminderDismissalMap = { 1: { status: 'overdue', dueAtOdometer: 60000 } };
		expect(isSuppressedByDismissal(1, 'due-soon', 59000, TODAY, map)).toBe(true);
	});

	it('re-surfaces EXACTLY at dueAtOdometer, no fuzz window', () => {
		const map: ReminderDismissalMap = { 1: { status: 'overdue', dueAtOdometer: 60000 } };
		expect(isSuppressedByDismissal(1, 'overdue', 59999, TODAY, map)).toBe(true);
		expect(isSuppressedByDismissal(1, 'overdue', 60000, TODAY, map)).toBe(false);
	});

	it('re-surfaces EXACTLY at dueAtDate, no fuzz window', () => {
		const map: ReminderDismissalMap = { 1: { status: 'overdue', dueAtDate: '2026-06-15' } };
		const dayBefore = new Date(2026, 5, 14);
		expect(isSuppressedByDismissal(1, 'overdue', undefined, dayBefore, map)).toBe(true);
		expect(isSuppressedByDismissal(1, 'overdue', undefined, TODAY, map)).toBe(false);
	});

	it('a day-cadence reminder (no odometer signal at all) still re-surfaces on its date', () => {
		// The expense-only-user gap AD-RT-4 closes: no odometer dimension whatsoever, dueAtDate alone
		// governs expiry.
		const map: ReminderDismissalMap = { 1: { status: 'overdue', dueAtDate: '2026-06-15' } };
		expect(isSuppressedByDismissal(1, 'overdue', undefined, TODAY, map)).toBe(false);
	});

	it('stays suppressed when currentOdometer is unknown even if the marker tracks odometer', () => {
		const map: ReminderDismissalMap = { 1: { status: 'overdue', dueAtOdometer: 60000 } };
		expect(isSuppressedByDismissal(1, 'overdue', undefined, TODAY, map)).toBe(true);
	});

	it('re-surfaces if EITHER tracked dimension reaches its due instance', () => {
		const map: ReminderDismissalMap = {
			1: { status: 'overdue', dueAtOdometer: 60000, dueAtDate: '2027-01-01' }
		};
		// Odometer reached, date far in the future — still re-surfaces.
		expect(isSuppressedByDismissal(1, 'overdue', 60000, TODAY, map)).toBe(false);
	});
});

describe('pruneDismissals (Story 8.5 — relocated pure prune decision, AD-RT-4)', () => {
	it('returns ids that belong to this vehicle and are no longer due', () => {
		const map: ReminderDismissalMap = {
			1: { status: 'overdue', dueAtOdometer: 1 },
			2: { status: 'overdue', dueAtOdometer: 1 },
			3: { status: 'overdue', dueAtOdometer: 1 }
		};
		const vehicleReminderIds = new Set([1, 2]);
		const dueReminderIds = new Set([1]);
		expect(pruneDismissals(map, vehicleReminderIds, dueReminderIds)).toEqual([2]);
	});

	it('never touches a marker outside vehicleReminderIds (another vehicle scope)', () => {
		const map: ReminderDismissalMap = { 99: { status: 'overdue', dueAtOdometer: 1 } };
		const vehicleReminderIds = new Set([1, 2]);
		const dueReminderIds = new Set<number>();
		expect(pruneDismissals(map, vehicleReminderIds, dueReminderIds)).toEqual([]);
	});

	it('returns an empty array when everything in scope is still due', () => {
		const map: ReminderDismissalMap = { 1: { status: 'overdue', dueAtOdometer: 1 } };
		expect(pruneDismissals(map, new Set([1]), new Set([1]))).toEqual([]);
	});

	it('returns an empty array for an empty map', () => {
		expect(pruneDismissals({}, new Set([1]), new Set([1]))).toEqual([]);
	});
});
