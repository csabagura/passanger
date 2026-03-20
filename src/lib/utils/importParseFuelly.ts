// Fuelly CSV parser — parses Fuelly export format into normalized import rows
// Fuelly exports all vehicles in a single CSV with unit-variant column headers

import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type {
	ImportRow,
	ImportDryRunSummary,
	NormalizedImportEntry,
	ColumnMappingEntry
} from '$lib/utils/importTypes';
import { validateImportRow, buildDryRunSummary } from '$lib/utils/importValidation';

export interface FuellyDetectedUnits {
	fuel: 'L' | 'gal';
	distance: 'km' | 'mi';
}

export interface FuellyParseResult {
	rows: ImportRow[];
	summary: ImportDryRunSummary;
	detectedUnits: FuellyDetectedUnits;
	columnMapping: ColumnMappingEntry[];
}

/**
 * Parse Fuelly date: "MM/DD/YYYY H:MM" or "MM/DD/YYYY" or "M/D/YYYY"
 * Uses manual split — NOT new Date(string) which is locale-dependent.
 */
function parseFuellyDate(dateStr: string): Date | null {
	if (!dateStr?.trim()) return null;
	const cleaned = dateStr.trim();
	const [datePart] = cleaned.split(' ');
	const parts = datePart.split('/');
	if (parts.length !== 3) return null;
	const month = parseInt(parts[0], 10);
	const day = parseInt(parts[1], 10);
	const year = parseInt(parts[2], 10);
	if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const date = new Date(year, month - 1, day);
	// Verify the date didn't roll over (e.g., Feb 30 → Mar 2)
	if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
	return date;
}

/**
 * Detect fuel and distance units from Fuelly CSV column headers.
 * Headers change based on user's Fuelly unit setting:
 *   metric: litres, km, l/100km
 *   imperial: gallons, miles, mpg
 * Defaults to metric if neither variant found.
 */
function detectFuellyUnits(fields: string[]): FuellyDetectedUnits {
	const lower = fields.map((f) => f.toLowerCase().trim());
	return {
		fuel: lower.some((f) => f === 'gallons') ? 'gal' : 'L',
		distance: lower.some((f) => f === 'miles') ? 'mi' : 'km'
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
 * Get the fuel quantity column name based on detected units.
 */
function getFuelColumnName(units: FuellyDetectedUnits): string {
	return units.fuel === 'gal' ? 'gallons' : 'litres';
}

/**
 * Build the column mapping array for Step 3 display.
 */
function buildColumnMapping(fields: string[], units: FuellyDetectedUnits): ColumnMappingEntry[] {
	const fuelCol = getFuelColumnName(units);
	const distanceCol = units.distance === 'mi' ? 'miles' : 'km';
	const consumptionCol = units.fuel === 'gal' ? 'mpg' : 'l/100km';

	const mappedColumns: ColumnMappingEntry[] = [
		{ sourceColumn: 'fuelup_date', targetField: 'Date', status: 'mapped' },
		{ sourceColumn: 'odometer', targetField: 'Odometer', status: 'mapped' },
		{ sourceColumn: fuelCol, targetField: 'Fuel quantity', status: 'mapped' },
		{ sourceColumn: 'price', targetField: 'Total cost', status: 'calculated' },
		{ sourceColumn: 'notes', targetField: 'Notes', status: 'mapped' },
		{ sourceColumn: 'car_name', targetField: 'Vehicle', status: 'mapped' }
	];

	const ignoredColumnNames = [
		'model',
		consumptionCol,
		distanceCol,
		'city_percentage',
		'date_added',
		'tags',
		'missed_fuelup',
		'partial_fuelup',
		'latitude',
		'longitude',
		'brand'
	];

	const ignoredColumns: ColumnMappingEntry[] = [];
	const lowerFields = fields.map((f) => f.toLowerCase().trim());

	for (const colName of ignoredColumnNames) {
		if (lowerFields.includes(colName.toLowerCase())) {
			ignoredColumns.push({
				sourceColumn: colName,
				targetField: '(ignored)',
				status: 'ignored'
			});
		}
	}

	return [...mappedColumns, ...ignoredColumns];
}

/**
 * Parse a Fuelly CSV export into normalized import rows with validation.
 * Uses dynamic import for PapaParse (Phase 2 Rule #12).
 *
 * @param rawCSV - Raw CSV string content from the uploaded file
 * @returns Result containing parsed rows, summary, detected units, and column mapping
 */
export async function parseFuellyCSV(rawCSV: string): Promise<Result<FuellyParseResult>> {
	try {
		const Papa = await import('papaparse');
		const result = Papa.parse(rawCSV, {
			header: true,
			skipEmptyLines: true,
			dynamicTyping: false,
			transformHeader: (h: string) => h.trim()
		});

		// Check for parse-level errors (malformed CSV, broken quoting, etc.)
		if (result.errors && result.errors.length > 0) {
			const fatalErrors = result.errors.filter(
				(e: { type: string }) => e.type === 'Delimiter' || e.type === 'Quotes'
			);
			if (fatalErrors.length > 0) {
				return err(
					'PARSE_FAILED',
					'The CSV file appears to be malformed. Check for broken quoting or formatting issues.'
				);
			}
		}

		if (!result.meta.fields || result.meta.fields.length === 0 || result.data.length === 0) {
			return err('PARSE_FAILED', 'The file appears to be empty or has no recognizable columns.');
		}

		const fields = result.meta.fields;
		const units = detectFuellyUnits(fields);
		const fuelColName = getFuelColumnName(units);
		const data = result.data as Record<string, string>[];

		// Map rows to normalized entries
		const mappedEntries: { data: Partial<NormalizedImportEntry>; rowNumber: number }[] = [];

		for (let i = 0; i < data.length; i++) {
			const row = data[i];
			const dateStr = getColumn(row, 'fuelup_date');
			const odometerStr = getColumn(row, 'odometer');
			const quantityStr = getColumn(row, fuelColName);
			const priceStr = getColumn(row, 'price');
			const notes = getColumn(row, 'notes');
			const carName = getColumn(row, 'car_name');

			const date = parseFuellyDate(dateStr);
			const odometer = parseFloat(odometerStr);
			const quantity = parseFloat(quantityStr);
			const price = parseFloat(priceStr);
			const totalCost = !isNaN(price) && !isNaN(quantity) ? price * quantity : NaN;

			const entry: Partial<NormalizedImportEntry> = {
				date: date ?? undefined,
				odometer: odometerStr ? odometer : undefined,
				quantity: quantityStr ? quantity : undefined,
				unit: units.fuel,
				distanceUnit: units.distance,
				totalCost,
				notes: notes || '',
				type: 'fuel',
				sourceVehicleName: carName || undefined
			};

			mappedEntries.push({ data: entry, rowNumber: i + 1 });
		}

		// Sort by vehicle name then date for odometer decrease detection
		const sorted = [...mappedEntries].sort((a, b) => {
			const nameA = a.data.sourceVehicleName ?? '';
			const nameB = b.data.sourceVehicleName ?? '';
			if (nameA !== nameB) return nameA.localeCompare(nameB);
			const dateA = a.data.date instanceof Date ? a.data.date.getTime() : 0;
			const dateB = b.data.date instanceof Date ? b.data.date.getTime() : 0;
			return dateA - dateB;
		});

		// Validate rows with odometer decrease detection per vehicle
		const validatedRows: ImportRow[] = [];
		const prevOdometerByVehicle = new Map<string, number>();

		for (const entry of sorted) {
			const vehicleName = entry.data.sourceVehicleName ?? '';
			const prevOdometer = prevOdometerByVehicle.get(vehicleName);
			const validated = validateImportRow(entry.data, entry.rowNumber, prevOdometer);
			validatedRows.push(validated);

			// Update prev odometer for this vehicle (only if valid number)
			if (entry.data.odometer != null && !isNaN(entry.data.odometer)) {
				prevOdometerByVehicle.set(vehicleName, entry.data.odometer);
			}
		}

		// Re-sort by rowNumber for display order
		validatedRows.sort((a, b) => a.rowNumber - b.rowNumber);

		const summary = buildDryRunSummary(validatedRows);
		const columnMapping = buildColumnMapping(fields, units);

		return ok({
			rows: validatedRows,
			summary,
			detectedUnits: units,
			columnMapping
		});
	} catch {
		return err(
			'PARSE_FAILED',
			'Could not parse the CSV file. Check that it is a valid Fuelly export.'
		);
	}
}
