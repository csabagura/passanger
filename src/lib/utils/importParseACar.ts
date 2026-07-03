// aCar/Fuelio CSV parser — parses aCar export format into normalized import rows
// aCar exports one vehicle per file with ## Vehicle and ## Log sections

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
	getColumn,
	hasFatalParseErrors,
	sortValidateResort,
	type ParsedEntry
} from '$lib/utils/importParserShared';
import { LITERS_PER_UK_GALLON } from '$lib/utils/calculations';

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

// A unit-detection signal that also flags whether the 'gal' resolution specifically means UK
// (not US) gallons — AC7 (S11) needs to know this to convert the parsed quantity at parse time.
interface UnitSignal extends DetectedUnits {
	fuelIsUKGallons: boolean;
}

/**
 * Detect units from Vehicle section codes.
 * DistUnit: 0=km, 1=miles
 * FuelUnit: 0=litres, 1=US gallons, 2=UK gallons
 */
function detectUnitsFromVehicleCodes(vehicleRow: Record<string, string>): UnitSignal {
	const distUnitCode = parseInt(getColumn(vehicleRow, 'DistUnit'), 10);
	const fuelUnitCode = parseInt(getColumn(vehicleRow, 'FuelUnit'), 10);
	return {
		distance: distUnitCode === 1 ? 'mi' : 'km',
		fuel: fuelUnitCode === 1 || fuelUnitCode === 2 ? 'gal' : 'L',
		fuelIsUKGallons: fuelUnitCode === 2
	};
}

// Story 8.3 AC6 (S8) — a header dimension with NO recognized unit suffix (e.g. a bare "Odo" with
// no "(km)"/"(mi)" hint) must report `null`, distinct from matching-and-resolving-to-a-default, so
// the caller can fall back to the Vehicle-section codes instead of silently defaulting to km/L.
interface HeaderUnitSignal {
	distance: 'km' | 'mi' | null;
	fuel: 'L' | 'gal' | null;
	fuelIsUKGallons: boolean;
}

/**
 * Detect units from Log column headers (e.g., "Odo (km)" vs "Odo (mi)"). Returns `null` for a
 * dimension the headers give no signal for at all.
 */
function detectUnitsFromHeaders(fields: string[]): HeaderUnitSignal {
	const lower = fields.map((f) => f.toLowerCase().trim());
	const hasMi = lower.some((f) => f.includes('(mi)'));
	const hasKm = lower.some((f) => f.includes('(km)'));
	const hasUKGallons = lower.some((f) => f.includes('(uk gallons)'));
	const hasUSGallons = lower.some((f) => f.includes('(us gallons)'));
	const hasLitres = lower.some((f) => f.includes('(litres)') || f.includes('(liters)'));
	return {
		distance: hasMi ? 'mi' : hasKm ? 'km' : null,
		fuel: hasUSGallons || hasUKGallons ? 'gal' : hasLitres ? 'L' : null,
		fuelIsUKGallons: hasUKGallons
	};
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
		'l/100km (optional)',
		'mpg (optional)',
		'latitude (optional)',
		'longitude (optional)',
		'city (optional)',
		'tanknumber',
		'fueltype',
		'volumeprice',
		'stationid (optional)',
		'excludedistance',
		'uniqueid',
		'tankcalc'
	];

	const lowerFields = fields.map((f) => f.toLowerCase().trim());

	// Story 7.1 (review P1) — aCar/Fuelio expose fill-quality equivalents: `Full` (1 = full tank,
	// 0 = partial — the boolean INVERSE of isPartialFill) and `Missed` (1 = a fill-up went unlogged
	// before this one). Surface them as mapped when present instead of "(ignored)".
	const conditionalMapped: ColumnMappingEntry[] = [];
	for (const [colName, targetField] of [
		['full', 'Partial fill-up'],
		['missed', 'Missed previous fill-up']
	] as const) {
		if (lowerFields.includes(colName)) {
			const original = fields[lowerFields.indexOf(colName)];
			conditionalMapped.push({ sourceColumn: original, targetField, status: 'mapped' });
		}
	}

	const ignored: ColumnMappingEntry[] = [];
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

	return [...mapped, ...conditionalMapped, ...ignored];
}

// Story 7.1 (review P1) — aCar/Fuelio write boolean columns as '0'/'1'. Same truthy tokens as the
// Fuelly parser; anything else (incl. empty/absent) reads as unset.
function isACarFlagSet(value: string): boolean {
	const token = value.trim().toLowerCase();
	return token === '1' || token === 'true' || token === 'yes';
}

// The `Full` column is the boolean INVERSE of isPartialFill — but only when the column is present
// AND carries an explicit falsy value. An absent/empty column must NOT flag a partial (default
// full, matching every other parser's no-equivalent default).
function isACarPartial(fullValue: string): boolean {
	const token = fullValue.trim().toLowerCase();
	return token === '0' || token === 'false' || token === 'no';
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
		if (hasFatalParseErrors(logResult.errors)) {
			return err(
				'PARSE_FAILED',
				'The CSV file appears to be malformed. Check for broken quoting or formatting issues.'
			);
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

		// Story 8.3 AC6 (S8) — headers win when they carry a real signal; the Vehicle-section codes
		// are a genuine fallback (not dead code) for a dimension the headers give NO signal for at
		// all (e.g. a bare "Odo" header with no unit suffix), instead of silently defaulting to km/L.
		// AC7 (S11) — which source resolved 'gal' determines whether it means UK or US gallons; a UK
		// signal is reported as 'L' here too (the quantity is converted to litres below), so the
		// returned `detectedUnits` (used for the wizard's column-mapping display) matches what every
		// row actually carries — never a stale 'gal' label once the numbers are already litres.
		const fuelIsUKGallons =
			headerUnits.fuel != null ? headerUnits.fuelIsUKGallons : vehicleUnits.fuelIsUKGallons;
		const detectedUnits: DetectedUnits = {
			distance: headerUnits.distance ?? vehicleUnits.distance,
			fuel: fuelIsUKGallons ? 'L' : (headerUnits.fuel ?? vehicleUnits.fuel)
		};

		const data = logResult.data as Record<string, string>[];

		// Find the correct column names based on detected units
		const odoColName = fields.find((f) => f.toLowerCase().startsWith('odo')) ?? 'Odo (km)';
		const fuelColName = fields.find((f) => f.toLowerCase().startsWith('fuel (')) ?? 'Fuel (litres)';

		// Map rows to normalized entries
		const mappedEntries: ParsedEntry[] = [];

		for (let i = 0; i < data.length; i++) {
			const row = data[i];
			const dateStr = getColumn(row, 'Data');
			const odometerStr = getColumn(row, odoColName);
			const quantityStr = getColumn(row, fuelColName);
			const priceStr = getColumn(row, 'Price (optional)');
			const notes = getColumn(row, 'Notes (optional)');
			// Story 7.1 (review P1) — `Full` ('0' → partial) and `Missed` ('1' → missed predecessor).
			const isPartialFill = isACarPartial(getColumn(row, 'Full'));
			const precededByMissedFill = isACarFlagSet(getColumn(row, 'Missed'));

			const date = parseACarDate(dateStr);
			const odometer = normalizeDecimal(odometerStr);
			const rawQuantity = normalizeDecimal(quantityStr);
			const totalCost = normalizeDecimal(priceStr); // aCar Price IS total cost — NOT per-unit

			// Story 8.3 AC7 (S11) — a UK-gallon signal converts the parsed quantity to litres at parse
			// time (1 UK gal = 4.54609 L) and reports 'L', rather than importing the raw UK-gallon
			// number under the 'gal' (US-gallon-shaped) label — a ~20% consumption/MPG skew otherwise.
			const quantity =
				fuelIsUKGallons && !isNaN(rawQuantity) ? rawQuantity * LITERS_PER_UK_GALLON : rawQuantity;

			const entry: Partial<NormalizedImportEntry> = {
				date: date ?? undefined,
				odometer: odometerStr ? odometer : undefined,
				quantity: quantityStr ? quantity : undefined,
				unit: detectedUnits.fuel,
				distanceUnit: detectedUnits.distance,
				totalCost,
				notes: notes.replace(/^"|"$/g, '') || '',
				type: 'fuel',
				sourceVehicleName: vehicleName || undefined,
				isPartialFill,
				precededByMissedFill
			};

			mappedEntries.push({ data: entry, rowNumber: i + 1 });
		}

		// Sort by date, validate (odometer-decrease chain), then re-sort by rowNumber for display.
		// aCar is single-vehicle-per-file, so the decrease chain uses one constant group.
		const validatedRows = sortValidateResort(mappedEntries, () => '');

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
