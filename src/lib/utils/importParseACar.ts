// aCar/Fuelio CSV parser — parses aCar export format into normalized import rows
// aCar exports one vehicle per file with ## Vehicle and ## Log sections

import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type {
	ImportRow,
	NormalizedImportEntry,
	ImportParseResult,
	DetectedUnits,
	ColumnMappingEntry
} from '$lib/utils/importTypes';
import { validateImportRow, buildDryRunSummary } from '$lib/utils/importValidation';
import { splitCSVSections } from '$lib/utils/importSections';

/**
 * Parse aCar date: "YYYY-MM-DD" format.
 * Manual split — NOT new Date(string) which is locale-dependent.
 */
function parseACarDate(dateStr: string): Date | null {
	if (!dateStr?.trim()) return null;
	const cleaned = dateStr.trim().replace(/^"|"$/g, '');
	const parts = cleaned.split('-');
	if (parts.length !== 3) return null;
	const year = parseInt(parts[0], 10);
	const month = parseInt(parts[1], 10);
	const day = parseInt(parts[2], 10);
	if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const date = new Date(year, month - 1, day);
	if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
	return date;
}

/**
 * Detect units from Vehicle section codes.
 * DistUnit: 0=km, 1=miles
 * FuelUnit: 0=litres, 1=US gallons, 2=UK gallons
 */
function detectUnitsFromVehicleCodes(vehicleRow: Record<string, string>): DetectedUnits {
	const distUnitCode = parseInt(getColumn(vehicleRow, 'DistUnit'), 10);
	const fuelUnitCode = parseInt(getColumn(vehicleRow, 'FuelUnit'), 10);
	return {
		distance: distUnitCode === 1 ? 'mi' : 'km',
		fuel: fuelUnitCode === 1 || fuelUnitCode === 2 ? 'gal' : 'L'
	};
}

/**
 * Detect units from Log column headers (e.g., "Odo (km)" vs "Odo (mi)").
 */
function detectUnitsFromHeaders(fields: string[]): DetectedUnits {
	const lower = fields.map((f) => f.toLowerCase().trim());
	return {
		distance: lower.some((f) => f.includes('(mi)')) ? 'mi' : 'km',
		fuel: lower.some((f) => f.includes('(us gallons)') || f.includes('(uk gallons)')) ? 'gal' : 'L'
	};
}

/**
 * Find a column value case-insensitively from a row object.
 */
function getColumn(row: Record<string, string>, columnName: string): string {
	const key = Object.keys(row).find((k) => k.toLowerCase().trim() === columnName.toLowerCase());
	return key ? (row[key] ?? '') : '';
}

/**
 * Build column mapping array for aCar format display.
 * Adjusts source column names to match actual header names (including units).
 */
function buildACarColumnMapping(fields: string[]): ColumnMappingEntry[] {
	const odoCol = fields.find((f) => f.toLowerCase().startsWith('odo')) ?? 'Odo (km)';
	const fuelCol = fields.find((f) => f.toLowerCase().startsWith('fuel (')) ?? 'Fuel (litres)';

	const mapped: ColumnMappingEntry[] = [
		{ sourceColumn: 'Data', targetField: 'Date', status: 'mapped' },
		{ sourceColumn: odoCol, targetField: 'Odometer', status: 'mapped' },
		{ sourceColumn: fuelCol, targetField: 'Fuel quantity', status: 'mapped' },
		{ sourceColumn: 'Price (optional)', targetField: 'Total cost', status: 'mapped' },
		{ sourceColumn: 'Notes (optional)', targetField: 'Notes', status: 'mapped' }
	];

	const ignoredNames = [
		'full',
		'l/100km (optional)',
		'mpg (optional)',
		'latitude (optional)',
		'longitude (optional)',
		'city (optional)',
		'missed',
		'tanknumber',
		'fueltype',
		'volumeprice',
		'stationid (optional)',
		'excludedistance',
		'uniqueid',
		'tankcalc'
	];

	const ignored: ColumnMappingEntry[] = [];
	const lowerFields = fields.map((f) => f.toLowerCase().trim());
	for (const name of ignoredNames) {
		if (lowerFields.includes(name.toLowerCase())) {
			const original = fields[lowerFields.indexOf(name.toLowerCase())];
			ignored.push({
				sourceColumn: original,
				targetField: '(ignored)',
				status: 'ignored'
			});
		}
	}

	return [...mapped, ...ignored];
}

/**
 * Parse an aCar/Fuelio CSV export into normalized import rows with validation.
 * Uses dynamic import for PapaParse (Phase 2 Rule #12).
 *
 * @param rawCSV - Raw CSV string content from the uploaded file
 * @returns Result containing parsed rows, summary, detected units, and column mapping
 */
export async function parseACarCSV(rawCSV: string): Promise<Result<ImportParseResult>> {
	try {
		const sections = splitCSVSections(rawCSV);

		if (!sections.has('vehicle')) {
			return err(
				'PARSE_FAILED',
				'Missing vehicle information. This doesn\u2019t look like an aCar/Fuelio export.'
			);
		}

		if (!sections.has('log')) {
			return err(
				'PARSE_FAILED',
				'No fuel log data found. The aCar/Fuelio export appears to be incomplete.'
			);
		}

		const Papa = await import('papaparse');

		// Parse Vehicle section to extract unit codes and vehicle name
		const vehicleResult = Papa.parse(sections.get('vehicle')!, {
			header: true,
			skipEmptyLines: true,
			dynamicTyping: false,
			transformHeader: (h: string) => h.trim()
		});

		const vehicleRows = vehicleResult.data as Record<string, string>[];
		if (vehicleRows.length === 0) {
			return err('PARSE_FAILED', 'Missing vehicle information. The Vehicle section is empty.');
		}

		const vehicleRow = vehicleRows[0];
		const vehicleName = getColumn(vehicleRow, 'Name').replace(/^"|"$/g, '');
		const vehicleUnits = detectUnitsFromVehicleCodes(vehicleRow);

		// Parse Log section
		const logResult = Papa.parse(sections.get('log')!, {
			header: true,
			skipEmptyLines: true,
			dynamicTyping: false,
			transformHeader: (h: string) => h.trim()
		});

		// Check for fatal parse errors
		if (logResult.errors && logResult.errors.length > 0) {
			const fatalErrors = logResult.errors.filter(
				(e: { type: string }) => e.type === 'Delimiter' || e.type === 'Quotes'
			);
			if (fatalErrors.length > 0) {
				return err(
					'PARSE_FAILED',
					'The CSV file appears to be malformed. Check for broken quoting or formatting issues.'
				);
			}
		}

		if (
			!logResult.meta.fields ||
			logResult.meta.fields.length === 0 ||
			logResult.data.length === 0
		) {
			return err('PARSE_FAILED', 'No fuel log data found. The Log section appears to be empty.');
		}

		const fields = logResult.meta.fields;
		const headerUnits = detectUnitsFromHeaders(fields);

		// Cross-validate: prefer header detection, fall back to Vehicle codes
		const detectedUnits: DetectedUnits = {
			fuel: headerUnits.fuel,
			distance: headerUnits.distance
		};

		const data = logResult.data as Record<string, string>[];

		// Find the correct column names based on detected units
		const odoColName = fields.find((f) => f.toLowerCase().startsWith('odo')) ?? 'Odo (km)';
		const fuelColName = fields.find((f) => f.toLowerCase().startsWith('fuel (')) ?? 'Fuel (litres)';

		// Map rows to normalized entries
		const mappedEntries: { data: Partial<NormalizedImportEntry>; rowNumber: number }[] = [];

		for (let i = 0; i < data.length; i++) {
			const row = data[i];
			const dateStr = getColumn(row, 'Data');
			const odometerStr = getColumn(row, odoColName);
			const quantityStr = getColumn(row, fuelColName);
			const priceStr = getColumn(row, 'Price (optional)');
			const notes = getColumn(row, 'Notes (optional)');

			const date = parseACarDate(dateStr);
			const odometer = parseFloat(odometerStr);
			const quantity = parseFloat(quantityStr);
			const totalCost = parseFloat(priceStr); // aCar Price IS total cost — NOT per-unit

			const entry: Partial<NormalizedImportEntry> = {
				date: date ?? undefined,
				odometer: odometerStr ? odometer : undefined,
				quantity: quantityStr ? quantity : undefined,
				unit: detectedUnits.fuel,
				distanceUnit: detectedUnits.distance,
				totalCost,
				notes: notes.replace(/^"|"$/g, '') || '',
				type: 'fuel',
				sourceVehicleName: vehicleName || undefined
			};

			mappedEntries.push({ data: entry, rowNumber: i + 1 });
		}

		// Sort by date for odometer decrease detection (single vehicle, no need to group)
		const sorted = [...mappedEntries].sort((a, b) => {
			const dateA = a.data.date instanceof Date ? a.data.date.getTime() : 0;
			const dateB = b.data.date instanceof Date ? b.data.date.getTime() : 0;
			return dateA - dateB;
		});

		// Validate rows with odometer decrease detection
		const validatedRows: ImportRow[] = [];
		let prevOdometer: number | undefined;

		for (const entry of sorted) {
			const validated = validateImportRow(entry.data, entry.rowNumber, prevOdometer);
			validatedRows.push(validated);

			if (entry.data.odometer != null && !isNaN(entry.data.odometer)) {
				prevOdometer = entry.data.odometer;
			}
		}

		// Re-sort by rowNumber for display order
		validatedRows.sort((a, b) => a.rowNumber - b.rowNumber);

		const summary = buildDryRunSummary(validatedRows);
		const columnMapping = buildACarColumnMapping(fields);

		return ok({
			rows: validatedRows,
			summary,
			detectedUnits,
			columnMapping
		});
	} catch {
		return err(
			'PARSE_FAILED',
			'Could not parse the CSV file. Check that it is a valid aCar/Fuelio export.'
		);
	}
}
