// Drivvo CSV parser — parses Drivvo export format into normalized import rows
// Drivvo exports sectioned CSV with ##Refuelling, ##Service, ##Expense, ##Vehicle

import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type {
	NormalizedImportEntry,
	ImportParseResult,
	DetectedUnits,
	ColumnMappingEntry
} from '$lib/utils/importTypes';
import { buildDryRunSummary } from '$lib/utils/importValidation';
import { splitCSVSections } from '$lib/utils/importSections';
import {
	normalizeDecimal,
	hasFatalParseErrors,
	sortValidateResort,
	type ParsedEntry
} from '$lib/utils/importParserShared';

/**
 * Parse Drivvo date: "D/M/YYYY" format (day-first!).
 * Manual split — NOT new Date(string) which is locale-dependent.
 * CRITICAL: Day is first, NOT month. This is the opposite of Fuelly.
 */
function parseDrivvoDate(dateStr: string): Date | null {
	if (!dateStr?.trim()) return null;
	const cleaned = dateStr.trim();
	const parts = cleaned.split('/');
	if (parts.length !== 3) return null;
	const day = parseInt(parts[0], 10); // DAY first
	const month = parseInt(parts[1], 10); // MONTH second
	const year = parseInt(parts[2], 10);
	if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const date = new Date(year, month - 1, day);
	if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
	return date;
}

/**
 * Parse a Drivvo CSV export into normalized import rows with validation.
 * Uses dynamic import for PapaParse (Phase 2 Rule #12).
 *
 * @param rawCSV - Raw CSV string content from the uploaded file
 * @param userUnits - User-provided units (Drivvo has no unit info in file)
 * @returns Result containing parsed rows, summary, null detectedUnits, and column mapping
 */
export async function parseDrivvoCSV(
	rawCSV: string,
	userUnits: DetectedUnits
): Promise<Result<ImportParseResult>> {
	try {
		const sections = splitCSVSections(rawCSV);

		// At least one data section must exist
		const hasRefuelling = sections.has('refuelling');
		const hasService = sections.has('service');
		const hasExpense = sections.has('expense');

		if (!hasRefuelling && !hasService && !hasExpense) {
			return err(
				'PARSE_FAILED',
				'No data sections found. This doesn\u2019t look like a Drivvo export.'
			);
		}

		const Papa = await import('papaparse');

		// Extract vehicle name from Vehicle section if present
		let vehicleName = '';
		if (sections.has('vehicle')) {
			const vehicleResult = Papa.parse(sections.get('vehicle')!, {
				header: false,
				skipEmptyLines: true,
				dynamicTyping: false
			});
			const vehicleData = vehicleResult.data as string[][];
			// First row is header, second is data
			if (vehicleData.length >= 2) {
				vehicleName = vehicleData[1][0]?.trim() ?? '';
			}
		}

		let rowNumber = 0;
		const allEntries: ParsedEntry[] = [];

		// Parse Refuelling section
		if (hasRefuelling) {
			const refuelResult = Papa.parse(sections.get('refuelling')!, {
				header: false,
				skipEmptyLines: true,
				dynamicTyping: false
			});

			// Check for fatal parse errors
			if (hasFatalParseErrors(refuelResult.errors)) {
				return err(
					'PARSE_FAILED',
					'The CSV file appears to be malformed. Check for broken quoting or formatting issues.'
				);
			}

			const rows = refuelResult.data as string[][];
			// Skip header row (index 0)
			for (let i = 1; i < rows.length; i++) {
				const row = rows[i];
				if (!row || row.length < 2) continue;

				rowNumber++;
				const date = parseDrivvoDate(row[1] ?? '');
				const odometer = normalizeDecimal(row[0] ?? '');
				const totalCost = normalizeDecimal(row[4] ?? '');
				const quantity = normalizeDecimal(row[5] ?? '');
				const notes = row.length > 18 ? (row[18]?.trim() ?? '') : '';

				const entry: Partial<NormalizedImportEntry> = {
					date: date ?? undefined,
					odometer: row[0]?.trim() ? odometer : undefined,
					quantity: row[5]?.trim() ? quantity : undefined,
					unit: userUnits.fuel,
					distanceUnit: userUnits.distance,
					totalCost,
					notes,
					type: 'fuel',
					sourceVehicleName: vehicleName || undefined
				};

				allEntries.push({ data: entry, rowNumber });
			}
		}

		// Parse Service section
		if (hasService) {
			const serviceResult = Papa.parse(sections.get('service')!, {
				header: false,
				skipEmptyLines: true,
				dynamicTyping: false
			});

			const rows = serviceResult.data as string[][];
			for (let i = 1; i < rows.length; i++) {
				const row = rows[i];
				if (!row || row.length < 2) continue;

				rowNumber++;
				const date = parseDrivvoDate(row[1] ?? '');
				const odometer = normalizeDecimal(row[0] ?? '');
				const cost = normalizeDecimal(row[2] ?? '');
				const title = row[3]?.trim() ?? '';
				const notes = row[5]?.trim() ?? '';

				const entry: Partial<NormalizedImportEntry> = {
					date: date ?? undefined,
					odometer: row[0]?.trim() ? odometer : undefined,
					unit: userUnits.fuel,
					distanceUnit: userUnits.distance,
					totalCost: cost,
					notes,
					type: 'maintenance',
					maintenanceType: title || undefined,
					sourceVehicleName: vehicleName || undefined
				};

				allEntries.push({ data: entry, rowNumber });
			}
		}

		// Parse Expense section
		if (hasExpense) {
			const expenseResult = Papa.parse(sections.get('expense')!, {
				header: false,
				skipEmptyLines: true,
				dynamicTyping: false
			});

			const rows = expenseResult.data as string[][];
			for (let i = 1; i < rows.length; i++) {
				const row = rows[i];
				if (!row || row.length < 2) continue;

				rowNumber++;
				const date = parseDrivvoDate(row[1] ?? '');
				const odometer = normalizeDecimal(row[0] ?? '');
				const cost = normalizeDecimal(row[2] ?? '');
				const title = row[3]?.trim() ?? '';
				const notes = row[6]?.trim() ?? '';

				const entry: Partial<NormalizedImportEntry> = {
					date: date ?? undefined,
					odometer: row[0]?.trim() ? odometer : undefined,
					unit: userUnits.fuel,
					distanceUnit: userUnits.distance,
					totalCost: cost,
					notes,
					type: 'maintenance',
					maintenanceType: title || undefined,
					sourceVehicleName: vehicleName || undefined
				};

				allEntries.push({ data: entry, rowNumber });
			}
		}

		if (allEntries.length === 0) {
			return err(
				'PARSE_FAILED',
				'No data rows found in the Drivvo export. The file appears to be empty.'
			);
		}

		// Sort by date, validate (odometer-decrease chain), then re-sort by rowNumber for display.
		// Drivvo is single-vehicle-per-file, so the decrease chain uses one constant group.
		const validatedRows = sortValidateResort(
			allEntries,
			() => '',
			(entry) => (entry.data.type === 'maintenance' ? { skipQuantityValidation: true } : undefined)
		);

		const summary = buildDryRunSummary(validatedRows);

		// Build column mapping per section type
		const columnMapping: ColumnMappingEntry[] = [];
		if (hasRefuelling) {
			columnMapping.push(
				{ sourceColumn: 'Odometer', targetField: 'Odometer', status: 'mapped' },
				{ sourceColumn: 'Date', targetField: 'Date', status: 'mapped' },
				{ sourceColumn: 'Total price', targetField: 'Total cost', status: 'mapped' },
				{ sourceColumn: 'Fuel amount', targetField: 'Fuel quantity', status: 'mapped' },
				{ sourceColumn: 'Notes', targetField: 'Notes', status: 'mapped' }
			);
		}
		if (hasService || hasExpense) {
			if (!hasRefuelling) {
				columnMapping.push(
					{ sourceColumn: 'Odometer', targetField: 'Odometer', status: 'mapped' },
					{ sourceColumn: 'Date', targetField: 'Date', status: 'mapped' },
					{ sourceColumn: 'Cost', targetField: 'Total cost', status: 'mapped' },
					{ sourceColumn: 'Title', targetField: 'Maintenance type', status: 'mapped' },
					{ sourceColumn: 'Notes', targetField: 'Notes', status: 'mapped' }
				);
			} else {
				columnMapping.push(
					{ sourceColumn: 'Cost (Service/Expense)', targetField: 'Total cost', status: 'mapped' },
					{ sourceColumn: 'Title', targetField: 'Maintenance type', status: 'mapped' }
				);
			}
		}

		return ok({
			rows: validatedRows,
			summary,
			detectedUnits: null, // Drivvo has no unit info in file
			columnMapping
		});
	} catch {
		return err(
			'PARSE_FAILED',
			'Could not parse the CSV file. Check that it is a valid Drivvo export.'
		);
	}
}
