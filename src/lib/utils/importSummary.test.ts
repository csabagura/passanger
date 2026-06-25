import { describe, it, expect } from 'vitest';
import { formatImportDateRange } from './importSummary';

describe('formatImportDateRange', () => {
	it('returns "Mon YYYY – Mon YYYY" for a spanning range', () => {
		const result = formatImportDateRange({
			start: new Date(2021, 5, 6),
			end: new Date(2021, 8, 19)
		});
		expect(result).toBe('Jun 2021 – Sep 2021');
	});

	it('formats a single-month range with identical endpoints', () => {
		const result = formatImportDateRange({
			start: new Date(2018, 9, 7),
			end: new Date(2018, 9, 7)
		});
		expect(result).toBe('Oct 2018 – Oct 2018');
	});

	it('returns an empty string when the range is null', () => {
		expect(formatImportDateRange(null)).toBe('');
	});
});
