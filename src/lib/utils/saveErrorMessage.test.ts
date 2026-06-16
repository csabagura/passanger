import { describe, it, expect } from 'vitest';
import { saveErrorMessage } from './saveErrorMessage';
import { QUOTA_EXCEEDED_CODE, QUOTA_EXCEEDED_MESSAGE } from '$lib/db/dbErrors';

describe('saveErrorMessage', () => {
	it('returns the specific quota message for a QUOTA_EXCEEDED error', () => {
		const message = saveErrorMessage(
			{ code: QUOTA_EXCEEDED_CODE, message: 'whatever the repo put here' },
			'generic fallback'
		);
		expect(message).toBe(QUOTA_EXCEEDED_MESSAGE);
	});

	it('returns the caller fallback (verbatim) for any non-quota error code', () => {
		for (const code of ['SAVE_FAILED', 'UPDATE_FAILED', 'VALIDATION_ERROR', 'NOT_FOUND']) {
			expect(saveErrorMessage({ code, message: 'raw exception text' }, 'friendly fallback')).toBe(
				'friendly fallback'
			);
		}
	});
});
