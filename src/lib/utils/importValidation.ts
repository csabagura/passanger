// Shared import validation helpers
// Used across Stories 8.2–8.5 for CSV import row validation and dry-run summaries

import type {
	ImportRow,
	ImportRowStatus,
	ImportDryRunSummary,
	NormalizedImportEntry
} from '$lib/utils/importTypes';

interface ValidationIssue {
	label: string;
	severity: 'error' | 'warning';
}

/**
 * Validates a single normalized import row and produces an ImportRow
 * with human-readable issue labels and a status classification.
 *
 * @param data - Partially mapped import entry
 * @param rowNumber - 1-based row number from the CSV
 * @param prevOdometer - Previous entry's odometer for decrease detection (same vehicle, sorted by date)
 */
export function validateImportRow(
	data: Partial<NormalizedImportEntry>,
	rowNumber: number,
	prevOdometer?: number,
	options?: { skipQuantityValidation?: boolean }
): ImportRow {
	const issues: ValidationIssue[] = [];

	// Date validation
	if (data.date == null) {
		issues.push({ label: 'Missing date', severity: 'error' });
	} else if (!(data.date instanceof Date) || isNaN(data.date.getTime())) {
		issues.push({ label: 'Date could not be read', severity: 'error' });
	} else if (data.date.getTime() > Date.now()) {
		issues.push({ label: 'Date is in the future', severity: 'warning' });
	}

	// Odometer validation
	if (data.odometer == null || isNaN(data.odometer)) {
		issues.push({ label: 'Missing odometer reading', severity: 'error' });
	} else if (data.odometer < 0) {
		issues.push({ label: 'Negative value \u2014 check the sign', severity: 'error' });
	} else if (prevOdometer != null && data.odometer < prevOdometer) {
		issues.push({ label: 'Odometer is lower than the previous entry', severity: 'warning' });
	}

	// Quantity validation (skip for maintenance entries where fuel quantity is N/A)
	if (!options?.skipQuantityValidation) {
		if (data.quantity == null || isNaN(data.quantity)) {
			issues.push({ label: 'Missing fuel quantity', severity: 'error' });
		} else if (data.quantity === 0) {
			issues.push({ label: 'Fuel quantity is zero', severity: 'warning' });
		} else if (data.quantity < 0) {
			issues.push({ label: 'Negative value \u2014 check the sign', severity: 'error' });
		}
	}

	// Cost validation
	if (data.totalCost == null || isNaN(data.totalCost)) {
		issues.push({ label: 'Missing cost', severity: 'warning' });
	} else if (data.totalCost === 0) {
		issues.push({ label: 'Cost is zero \u2014 is this correct?', severity: 'warning' });
	} else if (data.totalCost < 0) {
		issues.push({ label: 'Negative value \u2014 check the sign', severity: 'error' });
	}

	// Determine row status
	const hasError = issues.some((i) => i.severity === 'error');
	const hasWarning = issues.some((i) => i.severity === 'warning');
	let status: ImportRowStatus = 'valid';
	if (hasError) status = 'error';
	else if (hasWarning) status = 'warning';

	return {
		rowNumber,
		status,
		data,
		issues: issues.map((i) => i.label)
	};
}

/**
 * Builds a dry-run summary from validated import rows.
 * Shared by all parsers (Fuelly, aCar, Drivvo, generic).
 */
export function buildDryRunSummary(rows: ImportRow[]): ImportDryRunSummary {
	let validCount = 0;
	let warningCount = 0;
	let errorCount = 0;
	const vehicleNames = new Set<string>();
	let minDate: Date | null = null;
	let maxDate: Date | null = null;

	for (const row of rows) {
		if (row.status === 'valid') validCount++;
		else if (row.status === 'warning') warningCount++;
		else if (row.status === 'error') errorCount++;

		if (row.data.sourceVehicleName) {
			vehicleNames.add(row.data.sourceVehicleName);
		}

		if (row.data.date instanceof Date && !isNaN(row.data.date.getTime())) {
			if (minDate === null || row.data.date < minDate) minDate = row.data.date;
			if (maxDate === null || row.data.date > maxDate) maxDate = row.data.date;
		}
	}

	return {
		totalRows: rows.length,
		validCount,
		warningCount,
		errorCount,
		detectedVehicleNames: Array.from(vehicleNames),
		dateRange: minDate && maxDate ? { start: minDate, end: maxDate } : null
	};
}
