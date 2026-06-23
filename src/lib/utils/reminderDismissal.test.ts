import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REMINDER_DISMISSED_STORAGE_KEY, REMINDER_DUE_SOON_KM } from '$lib/config';
import {
	clearDismissal,
	dismissReminder,
	isSuppressedByDismissal,
	readDismissals,
	writeDismissals,
	type ReminderDismissalMap
} from './reminderDismissal';

describe('reminderDismissal storage', () => {
	beforeEach(() => {
		globalThis.localStorage.clear();
		vi.restoreAllMocks();
	});

	afterEach(() => {
		globalThis.localStorage.clear();
	});

	it('round-trips read/write of the dismissal map', () => {
		const map: ReminderDismissalMap = { 1: { status: 'due-soon', odometer: 60000 } };
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
		expect(() => writeDismissals({ 1: { status: 'overdue', odometer: 1 } })).not.toThrow();
	});

	it('dismissReminder writes a { status, odometer } marker', () => {
		dismissReminder(7, 'overdue', 80000);
		expect(readDismissals()).toEqual({ 7: { status: 'overdue', odometer: 80000 } });
	});

	it('dismissReminder stores an undefined odometer when none is known', () => {
		dismissReminder(7, 'overdue', undefined);
		expect(readDismissals()[7]).toEqual({ status: 'overdue', odometer: undefined });
	});

	it('clearDismissal removes only the targeted entry', () => {
		writeDismissals({ 1: { status: 'due-soon' }, 2: { status: 'overdue' } });
		clearDismissal(1);
		expect(readDismissals()).toEqual({ 2: { status: 'overdue' } });
	});
});

describe('isSuppressedByDismissal', () => {
	it('returns false when there is no marker for the reminder', () => {
		expect(isSuppressedByDismissal(1, 'overdue', 60000, {})).toBe(false);
	});

	it('returns true while status has not worsened and under the odometer window', () => {
		const map: ReminderDismissalMap = { 1: { status: 'due-soon', odometer: 60000 } };
		expect(isSuppressedByDismissal(1, 'due-soon', 60000, map)).toBe(true);
		expect(isSuppressedByDismissal(1, 'due-soon', 60100, map)).toBe(true);
	});

	it('re-surfaces (false) when status worsens due-soon → overdue', () => {
		const map: ReminderDismissalMap = { 1: { status: 'due-soon', odometer: 60000 } };
		expect(isSuppressedByDismissal(1, 'overdue', 60000, map)).toBe(false);
	});

	it('stays suppressed (true) when status improves overdue → due-soon', () => {
		const map: ReminderDismissalMap = { 1: { status: 'overdue', odometer: 60000 } };
		expect(isSuppressedByDismissal(1, 'due-soon', 60000, map)).toBe(true);
	});

	it('re-surfaces (false) once driven a full due-soon window past the marker odometer', () => {
		const map: ReminderDismissalMap = { 1: { status: 'overdue', odometer: 60000 } };
		expect(isSuppressedByDismissal(1, 'overdue', 60000 + REMINDER_DUE_SOON_KM - 1, map)).toBe(true);
		expect(isSuppressedByDismissal(1, 'overdue', 60000 + REMINDER_DUE_SOON_KM, map)).toBe(false);
	});

	it('stays suppressed when the marker has no odometer (date-only) and status unchanged', () => {
		const map: ReminderDismissalMap = { 1: { status: 'overdue' } };
		expect(isSuppressedByDismissal(1, 'overdue', 60000, map)).toBe(true);
		expect(isSuppressedByDismissal(1, 'overdue', undefined, map)).toBe(true);
	});

	it('stays suppressed when currentOdometer is unknown even if the marker has one', () => {
		const map: ReminderDismissalMap = { 1: { status: 'overdue', odometer: 60000 } };
		expect(isSuppressedByDismissal(1, 'overdue', undefined, map)).toBe(true);
	});
});
