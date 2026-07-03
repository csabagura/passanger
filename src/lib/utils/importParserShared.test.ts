import { describe, it, expect } from 'vitest';
import {
	normalizeDecimal,
	getColumn,
	hasFatalParseErrors,
	sortValidateResort,
	type ParsedEntry
} from '$lib/utils/importParserShared';

describe('normalizeDecimal', () => {
	it('parses a pure integer', () => {
		expect(normalizeDecimal('452')).toBe(452);
	});

	it('parses a dot-decimal number', () => {
		expect(normalizeDecimal('45.2')).toBe(45.2);
	});

	it('parses a comma-decimal number (European)', () => {
		expect(normalizeDecimal('45,2')).toBe(45.2);
	});

	it('parses a dot-thousands + comma-decimal number', () => {
		expect(normalizeDecimal('1.234,56')).toBe(1234.56);
	});

	it('parses a comma-thousands + dot-decimal number', () => {
		expect(normalizeDecimal('1,234.56')).toBe(1234.56);
	});

	it('returns NaN for an empty string', () => {
		expect(normalizeDecimal('')).toBeNaN();
	});
});

describe('getColumn', () => {
	it('finds a column case-insensitively', () => {
		expect(getColumn({ Odometer: '123' }, 'odometer')).toBe('123');
	});

	it('returns empty string when the column is absent', () => {
		expect(getColumn({ Odometer: '123' }, 'missing')).toBe('');
	});
});

describe('hasFatalParseErrors', () => {
	it('is false for undefined/empty errors', () => {
		expect(hasFatalParseErrors(undefined)).toBe(false);
		expect(hasFatalParseErrors([])).toBe(false);
	});

	it('is true when a Delimiter or Quotes error is present', () => {
		expect(hasFatalParseErrors([{ type: 'Delimiter' }])).toBe(true);
		expect(hasFatalParseErrors([{ type: 'Quotes' }])).toBe(true);
	});

	it('is false for non-fatal error types', () => {
		expect(hasFatalParseErrors([{ type: 'FieldMismatch' }])).toBe(false);
	});
});

describe('sortValidateResort', () => {
	function entry(rowNumber: number, date: Date | undefined, odometer: number): ParsedEntry {
		return {
			rowNumber,
			data: {
				date,
				odometer,
				quantity: 10,
				totalCost: 20,
				unit: 'L',
				distanceUnit: 'km'
			}
		};
	}

	it('flags a genuine odometer decrease within a group', () => {
		const entries = [entry(1, new Date(2026, 0, 1), 100), entry(2, new Date(2026, 0, 2), 90)];
		const rows = sortValidateResort(entries, () => 'vehicle-a');
		expect(rows[1].status).toBe('warning');
		expect(rows[1].issues).toContain('Odometer is lower than the previous entry');
	});

	it('keeps display order by rowNumber regardless of date order', () => {
		const entries = [entry(1, new Date(2026, 0, 5), 200), entry(2, new Date(2026, 0, 1), 100)];
		const rows = sortValidateResort(entries, () => 'vehicle-a');
		expect(rows.map((r) => r.rowNumber)).toEqual([1, 2]);
	});

	it('does not let an undated row seed or consume the decrease chain (S7)', () => {
		// Row 1: undated, huge odometer. If it seeded the chain, row 2 (properly increasing) would
		// look like a decrease. Row 2 must NOT be flagged.
		const entries = [
			entry(1, undefined, 999999),
			entry(2, new Date(2026, 0, 1), 100),
			entry(3, new Date(2026, 0, 2), 150)
		];
		const rows = sortValidateResort(entries, () => 'vehicle-a');
		const row2 = rows.find((r) => r.rowNumber === 2)!;
		const row3 = rows.find((r) => r.rowNumber === 3)!;
		expect(row2.issues).not.toContain('Odometer is lower than the previous entry');
		expect(row3.issues).not.toContain('Odometer is lower than the previous entry');
		// the undated row still gets its own error
		const row1 = rows.find((r) => r.rowNumber === 1)!;
		expect(row1.issues).toContain('Missing date');
	});

	it('groups independently — a decrease in one group does not affect another', () => {
		const entries = [entry(1, new Date(2026, 0, 1), 100), entry(2, new Date(2026, 0, 1), 500)];
		const rows = sortValidateResort(entries, (e) => (e.rowNumber === 1 ? 'a' : 'b'));
		expect(rows.every((r) => !r.issues.includes('Odometer is lower than the previous entry'))).toBe(
			true
		);
	});
});
