import { describe, it, expect } from 'vitest';
import { ok, err } from './result';

describe('Result helpers', () => {
	describe('ok()', () => {
		it('returns data with null error', () => {
			const result = ok('hello');
			expect(result.data).toBe('hello');
			expect(result.error).toBeNull();
		});

		it('wraps object data', () => {
			const data = { id: 1, name: 'Test' };
			const result = ok(data);
			expect(result.data).toEqual(data);
			expect(result.error).toBeNull();
		});

		it('wraps undefined/void', () => {
			const result = ok(undefined);
			expect(result.data).toBeUndefined();
			expect(result.error).toBeNull();
		});

		it('wraps array data', () => {
			const result = ok([1, 2, 3]);
			expect(result.data).toEqual([1, 2, 3]);
			expect(result.error).toBeNull();
		});
	});

	describe('err()', () => {
		it('returns null data with error object', () => {
			const result = err('NOT_FOUND', 'Item not found');
			expect(result.data).toBeNull();
			expect(result.error).not.toBeNull();
		});

		it('sets error code correctly', () => {
			const result = err('SAVE_FAILED', 'Could not save');
			expect(result.error?.code).toBe('SAVE_FAILED');
		});

		it('sets error message correctly', () => {
			const result = err('GET_FAILED', 'Could not retrieve');
			expect(result.error?.message).toBe('Could not retrieve');
		});

		it('error shape has code and message only', () => {
			const result = err('TEST_CODE', 'test message');
			expect(result.error).toEqual({ code: 'TEST_CODE', message: 'test message' });
		});
	});
});
