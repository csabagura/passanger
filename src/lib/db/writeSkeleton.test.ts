// @vitest-environment node
import 'fake-indexeddb/auto'; // MUST be first import — tabSync's BroadcastChannel needs a DOM global
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWrite, encodeSentinel, decodeSentinel } from './writeSkeleton';
import * as tabSync from '$lib/utils/tabSync';

describe('encodeSentinel / decodeSentinel', () => {
	it('round-trips a code and detail', () => {
		const error = encodeSentinel('NOT_FOUND', 'FuelLog 42 not found');
		expect(decodeSentinel(error)).toEqual({ code: 'NOT_FOUND', detail: 'FuelLog 42 not found' });
	});

	it('preserves a detail message that itself contains a colon', () => {
		const error = encodeSentinel(
			'VALIDATION_ERROR',
			'unit and distanceUnit must match: L with km, gal with mi'
		);
		expect(decodeSentinel(error)).toEqual({
			code: 'VALIDATION_ERROR',
			detail: 'unit and distanceUnit must match: L with km, gal with mi'
		});
	});

	it('returns null for a non-sentinel error (S33: no false-positive decode)', () => {
		expect(decodeSentinel(new Error('ConstraintError: some Dexie internal failure'))).toBeNull();
		expect(decodeSentinel(new Error('boom'))).toBeNull();
		expect(decodeSentinel('a plain string, not even an Error')).toBeNull();
	});

	it('every sentinel code used across the repos round-trips cleanly (no leaked prefix)', () => {
		for (const code of [
			'NOT_FOUND',
			'VALIDATION_ERROR',
			'SAVE_FAILED',
			'UPDATE_FAILED',
			'DELETE_FAILED'
		]) {
			const error = encodeSentinel(code, 'some detail');
			const decoded = decodeSentinel(error);
			expect(decoded?.code).toBe(code);
			expect(decoded?.detail).toBe('some detail');
			// The S33 regression: a caller's fallback err(fallbackCode, String(error)) must never be
			// reachable for a sentinel — decodeSentinel must catch every one of them first.
			expect(decoded?.detail).not.toContain('Error:');
		}
	});
});

describe('runWrite', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('short-circuits to VALIDATION_ERROR without calling op, and does not notify', async () => {
		const op = vi.fn();
		const notifySpy = vi.spyOn(tabSync, 'notifyDataChanged');
		const result = await runWrite(() => 'bad field', op, 'SAVE_FAILED');
		expect(result.error).toEqual({ code: 'VALIDATION_ERROR', message: 'bad field' });
		expect(op).not.toHaveBeenCalled();
		expect(notifySpy).not.toHaveBeenCalled();
	});

	it('validation is typeof-guarded and cannot throw across the Result boundary (S14)', async () => {
		// A validator receiving a non-string where it expects one must return an error STRING,
		// never throw — runWrite has no try/catch around the validate() call, by design.
		const throwingValidator = () => {
			throw new TypeError('should never happen — validators must not throw');
		};
		await expect(runWrite(throwingValidator, vi.fn(), 'SAVE_FAILED')).rejects.toThrow();
	});

	it('on success: notifies exactly once and returns ok', async () => {
		const notifySpy = vi.spyOn(tabSync, 'notifyDataChanged');
		const result = await runWrite(
			() => null,
			async () => 'saved-value',
			'SAVE_FAILED'
		);
		expect(result).toEqual({ data: 'saved-value', error: null });
		expect(notifySpy).toHaveBeenCalledTimes(1);
	});

	it('on a thrown sentinel: decodes it, returns its code/detail, and does NOT notify (S17)', async () => {
		const notifySpy = vi.spyOn(tabSync, 'notifyDataChanged');
		const op = async () => {
			throw encodeSentinel('NOT_FOUND', 'FuelLog 42 not found');
		};
		const result = await runWrite(() => null, op, 'DELETE_FAILED');
		expect(result.error).toEqual({ code: 'NOT_FOUND', message: 'FuelLog 42 not found' });
		expect(notifySpy).not.toHaveBeenCalled();
	});

	it('on a quota-exceeded error: maps to QUOTA_EXCEEDED_CODE and does not notify', async () => {
		const notifySpy = vi.spyOn(tabSync, 'notifyDataChanged');
		const quotaError = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
		const op = async () => {
			throw quotaError;
		};
		const result = await runWrite(() => null, op, 'SAVE_FAILED');
		expect(result.error?.code).toBe('QUOTA_EXCEEDED');
		expect(notifySpy).not.toHaveBeenCalled();
	});

	it('on an unrecognized thrown error: falls back to fallbackCode with the raw message, no notify', async () => {
		const notifySpy = vi.spyOn(tabSync, 'notifyDataChanged');
		const op = async () => {
			throw new Error('some unexpected Dexie failure');
		};
		const result = await runWrite(() => null, op, 'UPDATE_FAILED');
		expect(result.error?.code).toBe('UPDATE_FAILED');
		expect(result.error?.message).toContain('some unexpected Dexie failure');
		expect(notifySpy).not.toHaveBeenCalled();
	});

	it('a sentinel thrown with a code other than the fallback is still decoded correctly (S33)', async () => {
		// Regresses the exact leak: a DELETE_FAILED-labeled op throwing an UPDATE_FAILED sentinel
		// must surface as clean UPDATE_FAILED, never a doubled "Error: UPDATE_FAILED:..." message
		// under the DELETE_FAILED fallback code.
		const op = async () => {
			throw encodeSentinel('UPDATE_FAILED', 'Record not found after update');
		};
		const result = await runWrite(() => null, op, 'DELETE_FAILED');
		expect(result.error?.code).toBe('UPDATE_FAILED');
		expect(result.error?.message).toBe('Record not found after update');
		expect(result.error?.message).not.toContain('Error:');
	});
});
