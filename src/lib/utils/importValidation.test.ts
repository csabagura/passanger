import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { validateImportRow, buildDryRunSummary } from './importValidation';
import type { NormalizedImportEntry, ImportRow } from '$lib/utils/importTypes';

function validEntry(): Partial<NormalizedImportEntry> {
	return {
		date: new Date(2021, 5, 6), // June 6, 2021
		odometer: 186886,
		quantity: 57.432,
		unit: 'L',
		distanceUnit: 'km',
		totalCost: 72.88,
		notes: '',
		type: 'fuel',
		sourceVehicleName: 'Renegade'
	};
}

describe('validateImportRow', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 2, 16)); // March 16, 2026
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns valid status for a complete row with no issues', () => {
		const result = validateImportRow(validEntry(), 1);
		expect(result.status).toBe('valid');
		expect(result.issues).toEqual([]);
		expect(result.rowNumber).toBe(1);
	});

	it('returns error for missing date (null)', () => {
		const entry = validEntry();
		entry.date = undefined;
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('error');
		expect(result.issues).toContain('Missing date');
	});

	it('returns error for invalid date (NaN)', () => {
		const entry = validEntry();
		entry.date = new Date('not-a-date');
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('error');
		expect(result.issues).toContain('Date could not be read');
	});

	it('returns warning for future date', () => {
		const entry = validEntry();
		entry.date = new Date(2027, 0, 1);
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('warning');
		expect(result.issues).toContain('Date is in the future');
	});

	it('returns error for missing odometer (undefined)', () => {
		const entry = validEntry();
		entry.odometer = undefined;
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('error');
		expect(result.issues).toContain('Missing odometer reading');
	});

	it('returns error for NaN odometer', () => {
		const entry = validEntry();
		entry.odometer = NaN;
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('error');
		expect(result.issues).toContain('Missing odometer reading');
	});

	it('returns error for negative odometer', () => {
		const entry = validEntry();
		entry.odometer = -100;
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('error');
		expect(result.issues).toContain('Negative value \u2014 check the sign');
	});

	it('returns warning for odometer decrease vs previous entry', () => {
		const entry = validEntry();
		entry.odometer = 100;
		const result = validateImportRow(entry, 2, 200);
		expect(result.status).toBe('warning');
		expect(result.issues).toContain('Odometer is lower than the previous entry');
	});

	it('returns error for missing quantity (undefined)', () => {
		const entry = validEntry();
		entry.quantity = undefined;
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('error');
		expect(result.issues).toContain('Missing fuel quantity');
	});

	it('returns error for NaN quantity', () => {
		const entry = validEntry();
		entry.quantity = NaN;
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('error');
		expect(result.issues).toContain('Missing fuel quantity');
	});

	it('returns warning for zero quantity', () => {
		const entry = validEntry();
		entry.quantity = 0;
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('warning');
		expect(result.issues).toContain('Fuel quantity is zero');
	});

	it('returns error for negative quantity', () => {
		const entry = validEntry();
		entry.quantity = -10;
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('error');
		expect(result.issues).toContain('Negative value \u2014 check the sign');
	});

	it('returns warning for missing cost (NaN)', () => {
		const entry = validEntry();
		entry.totalCost = NaN;
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('warning');
		expect(result.issues).toContain('Missing cost');
	});

	it('returns warning for zero cost', () => {
		const entry = validEntry();
		entry.totalCost = 0;
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('warning');
		expect(result.issues).toContain('Cost is zero \u2014 is this correct?');
	});

	it('returns error for negative cost', () => {
		const entry = validEntry();
		entry.totalCost = -5;
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('error');
		expect(result.issues).toContain('Negative value \u2014 check the sign');
	});

	it('returns error status when row has both error and warning issues', () => {
		const entry = validEntry();
		entry.date = undefined; // error
		entry.totalCost = 0; // warning
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('error');
		expect(result.issues).toContain('Missing date');
		expect(result.issues).toContain('Cost is zero \u2014 is this correct?');
	});

	it('returns warning status for warning-only row', () => {
		const entry = validEntry();
		entry.date = new Date(2027, 0, 1); // future date warning
		entry.totalCost = 0; // zero cost warning
		const result = validateImportRow(entry, 1);
		expect(result.status).toBe('warning');
		expect(result.issues).toHaveLength(2);
	});

	it('does not flag odometer decrease without prevOdometer', () => {
		const entry = validEntry();
		entry.odometer = 100;
		const result = validateImportRow(entry, 1);
		expect(result.issues).not.toContain('Odometer is lower than the previous entry');
	});

	it('does not flag odometer when equal to previous', () => {
		const entry = validEntry();
		entry.odometer = 200;
		const result = validateImportRow(entry, 2, 200);
		expect(result.issues).not.toContain('Odometer is lower than the previous entry');
	});

	it('skips quantity validation when skipQuantityValidation is true', () => {
		const entry = validEntry();
		entry.quantity = undefined;
		const result = validateImportRow(entry, 1, undefined, { skipQuantityValidation: true });
		expect(result.issues).not.toContain('Missing fuel quantity');
	});

	it('still validates quantity when skipQuantityValidation is false', () => {
		const entry = validEntry();
		entry.quantity = undefined;
		const result = validateImportRow(entry, 1, undefined, { skipQuantityValidation: false });
		expect(result.issues).toContain('Missing fuel quantity');
	});
});

describe('buildDryRunSummary', () => {
	it('counts valid, warning, and error rows correctly', () => {
		const rows: ImportRow[] = [
			{ rowNumber: 1, status: 'valid', data: { date: new Date(2021, 0, 1) }, issues: [] },
			{
				rowNumber: 2,
				status: 'warning',
				data: { date: new Date(2021, 0, 2) },
				issues: ['Cost is zero \u2014 is this correct?']
			},
			{
				rowNumber: 3,
				status: 'error',
				data: { date: new Date(2021, 0, 3) },
				issues: ['Missing odometer reading']
			},
			{ rowNumber: 4, status: 'valid', data: { date: new Date(2021, 0, 4) }, issues: [] }
		];

		const summary = buildDryRunSummary(rows);
		expect(summary.totalRows).toBe(4);
		expect(summary.validCount).toBe(2);
		expect(summary.warningCount).toBe(1);
		expect(summary.errorCount).toBe(1);
	});

	it('collects unique vehicle names', () => {
		const rows: ImportRow[] = [
			{
				rowNumber: 1,
				status: 'valid',
				data: { sourceVehicleName: 'Renegade', date: new Date(2021, 0, 1) },
				issues: []
			},
			{
				rowNumber: 2,
				status: 'valid',
				data: { sourceVehicleName: 'Civic', date: new Date(2021, 0, 2) },
				issues: []
			},
			{
				rowNumber: 3,
				status: 'valid',
				data: { sourceVehicleName: 'Renegade', date: new Date(2021, 0, 3) },
				issues: []
			}
		];

		const summary = buildDryRunSummary(rows);
		expect(summary.detectedVehicleNames).toHaveLength(2);
		expect(summary.detectedVehicleNames).toContain('Renegade');
		expect(summary.detectedVehicleNames).toContain('Civic');
	});

	it('computes date range from valid dates', () => {
		const rows: ImportRow[] = [
			{
				rowNumber: 1,
				status: 'valid',
				data: { date: new Date(2021, 5, 6) },
				issues: []
			},
			{
				rowNumber: 2,
				status: 'valid',
				data: { date: new Date(2021, 5, 19) },
				issues: []
			},
			{
				rowNumber: 3,
				status: 'valid',
				data: { date: new Date(2021, 5, 12) },
				issues: []
			}
		];

		const summary = buildDryRunSummary(rows);
		expect(summary.dateRange).not.toBeNull();
		expect(summary.dateRange!.start).toEqual(new Date(2021, 5, 6));
		expect(summary.dateRange!.end).toEqual(new Date(2021, 5, 19));
	});

	it('returns null dateRange when no valid dates', () => {
		const rows: ImportRow[] = [
			{
				rowNumber: 1,
				status: 'error',
				data: {},
				issues: ['Missing date']
			}
		];

		const summary = buildDryRunSummary(rows);
		expect(summary.dateRange).toBeNull();
	});

	it('returns empty summary for empty rows array', () => {
		const summary = buildDryRunSummary([]);
		expect(summary.totalRows).toBe(0);
		expect(summary.validCount).toBe(0);
		expect(summary.warningCount).toBe(0);
		expect(summary.errorCount).toBe(0);
		expect(summary.detectedVehicleNames).toEqual([]);
		expect(summary.dateRange).toBeNull();
	});

	it('ignores invalid dates for date range calculation', () => {
		const rows: ImportRow[] = [
			{
				rowNumber: 1,
				status: 'error',
				data: { date: new Date('invalid') },
				issues: ['Date could not be read']
			},
			{
				rowNumber: 2,
				status: 'valid',
				data: { date: new Date(2021, 5, 12) },
				issues: []
			}
		];

		const summary = buildDryRunSummary(rows);
		expect(summary.dateRange).not.toBeNull();
		expect(summary.dateRange!.start).toEqual(new Date(2021, 5, 12));
		expect(summary.dateRange!.end).toEqual(new Date(2021, 5, 12));
	});
});
