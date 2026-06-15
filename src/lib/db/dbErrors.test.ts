import { describe, it, expect } from 'vitest';
import { isQuotaExceededError, QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE } from './dbErrors';

describe('isQuotaExceededError', () => {
	it('detects the standard DOMException name', () => {
		expect(isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true);
		expect(isQuotaExceededError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
	});

	it('detects the legacy Gecko name and numeric codes', () => {
		expect(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
		expect(isQuotaExceededError({ code: 22 })).toBe(true);
		expect(isQuotaExceededError({ code: 1014 })).toBe(true);
	});

	it('detects a Dexie-wrapped inner quota error', () => {
		expect(
			isQuotaExceededError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })
		).toBe(true);
	});

	it('detects via message text as a fallback', () => {
		expect(isQuotaExceededError(new Error('The quota has been exceeded.'))).toBe(true);
		expect(isQuotaExceededError(new Error('QuotaExceededError: ...'))).toBe(true);
	});

	it('returns false for unrelated errors and non-objects', () => {
		expect(isQuotaExceededError(new Error('NOT_FOUND'))).toBe(false);
		expect(isQuotaExceededError({ name: 'ConstraintError' })).toBe(false);
		expect(isQuotaExceededError(null)).toBe(false);
		expect(isQuotaExceededError('quota')).toBe(false);
		expect(isQuotaExceededError(undefined)).toBe(false);
	});

	it('exposes a stable code and a non-empty guidance message', () => {
		expect(QUOTA_EXCEEDED_CODE).toBe('QUOTA_EXCEEDED');
		expect(QUOTA_EXCEEDED_MESSAGE.length).toBeGreaterThan(0);
	});
});
