import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseFuellyCSV } from './importParseFuelly';

// Use real papaparse for parser tests (no mock)

const SAMPLE_FUELLY_CSV = `car_name,model,l/100km,odometer,km,litres,price,city_percentage,fuelup_date,date_added,tags,notes,missed_fuelup,partial_fuelup,latitude,longitude,brand
Renegade,Jeep,18.71,186886,306.998,57.432,1.269,50,06/06/2021 0:00,06/06/2021,,,0,0,,,
Renegade,Jeep,15.82,187205,319.016,50.441,1.319,50,06/12/2021 0:00,06/12/2021,,,0,0,,,`;

const IMPERIAL_FUELLY_CSV = `car_name,model,mpg,odometer,miles,gallons,price,city_percentage,fuelup_date,date_added,tags,notes,missed_fuelup,partial_fuelup,latitude,longitude,brand
MyTruck,Ford,22.5,116234,192.3,8.541,3.459,50,01/15/2022 0:00,01/15/2022,,,0,0,,,`;

const MULTI_VEHICLE_CSV = `car_name,model,l/100km,odometer,km,litres,price,city_percentage,fuelup_date,date_added,tags,notes,missed_fuelup,partial_fuelup,latitude,longitude,brand
Renegade,Jeep,18.71,186886,306.998,57.432,1.269,50,06/06/2021 0:00,06/06/2021,,,0,0,,,
Civic,Honda,7.5,45000,350,26.25,1.45,80,06/08/2021 0:00,06/08/2021,,,0,0,,,
Renegade,Jeep,15.82,187205,319.016,50.441,1.319,50,06/12/2021 0:00,06/12/2021,,,0,0,,,`;

const MISSING_FIELDS_CSV = `car_name,model,l/100km,odometer,km,litres,price,city_percentage,fuelup_date,date_added,tags,notes,missed_fuelup,partial_fuelup,latitude,longitude,brand
Renegade,Jeep,18.71,,306.998,57.432,1.269,50,,06/06/2021,,,0,0,,,`;

describe('parseFuellyCSV', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 2, 16));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('correctly maps Fuelly columns to passanger fields', async () => {
		const result = await parseFuellyCSV(SAMPLE_FUELLY_CSV);
		expect(result.error).toBeNull();
		expect(result.data).not.toBeNull();

		const rows = result.data!.rows;
		expect(rows).toHaveLength(2);

		const firstRow = rows[0];
		expect(firstRow.data.date).toEqual(new Date(2021, 5, 6));
		expect(firstRow.data.odometer).toBe(186886);
		expect(firstRow.data.quantity).toBeCloseTo(57.432);
		expect(firstRow.data.unit).toBe('L');
		expect(firstRow.data.distanceUnit).toBe('km');
		expect(firstRow.data.notes).toBe('');
		expect(firstRow.data.type).toBe('fuel');
		expect(firstRow.data.sourceVehicleName).toBe('Renegade');
	});

	it('calculates totalCost as price * quantity', async () => {
		const result = await parseFuellyCSV(SAMPLE_FUELLY_CSV);
		const rows = result.data!.rows;

		// 57.432 * 1.269 = 72.881208
		expect(rows[0].data.totalCost).toBeCloseTo(72.881208, 4);
		// 50.441 * 1.319 ≈ 66.53168
		expect(rows[1].data.totalCost).toBeCloseTo(50.441 * 1.319, 4);
	});

	it('detects metric units from column headers (litres → L, km → km)', async () => {
		const result = await parseFuellyCSV(SAMPLE_FUELLY_CSV);
		expect(result.data!.detectedUnits.fuel).toBe('L');
		expect(result.data!.detectedUnits.distance).toBe('km');
	});

	it('detects imperial units from column headers (gallons → gal, miles → mi)', async () => {
		const result = await parseFuellyCSV(IMPERIAL_FUELLY_CSV);
		expect(result.data!.detectedUnits.fuel).toBe('gal');
		expect(result.data!.detectedUnits.distance).toBe('mi');
	});

	it('parses imperial CSV with correct quantity mapping', async () => {
		const result = await parseFuellyCSV(IMPERIAL_FUELLY_CSV);
		const row = result.data!.rows[0];
		expect(row.data.quantity).toBeCloseTo(8.541);
		expect(row.data.unit).toBe('gal');
		expect(row.data.distanceUnit).toBe('mi');
		// totalCost = 8.541 * 3.459 = 29.543319
		expect(row.data.totalCost).toBeCloseTo(29.543319, 4);
	});

	it('parses Fuelly date format MM/DD/YYYY correctly', async () => {
		const result = await parseFuellyCSV(SAMPLE_FUELLY_CSV);
		const rows = result.data!.rows;
		// 06/06/2021 → June 6, 2021
		expect(rows[0].data.date).toEqual(new Date(2021, 5, 6));
		// 06/12/2021 → June 12, 2021
		expect(rows[1].data.date).toEqual(new Date(2021, 5, 12));
	});

	it('extracts vehicle name from car_name column', async () => {
		const result = await parseFuellyCSV(SAMPLE_FUELLY_CSV);
		expect(result.data!.rows[0].data.sourceVehicleName).toBe('Renegade');
	});

	it('detects multiple vehicles from interleaved CSV', async () => {
		const result = await parseFuellyCSV(MULTI_VEHICLE_CSV);
		const summary = result.data!.summary;

		expect(summary.detectedVehicleNames).toHaveLength(2);
		expect(summary.detectedVehicleNames).toContain('Renegade');
		expect(summary.detectedVehicleNames).toContain('Civic');
	});

	it('groups rows by vehicle for odometer decrease detection', async () => {
		// Renegade: 186886 → 187205 (increasing, OK)
		// Civic: 45000 (single entry, OK)
		const result = await parseFuellyCSV(MULTI_VEHICLE_CSV);
		const rows = result.data!.rows;
		// No odometer decrease warnings expected
		for (const row of rows) {
			expect(row.issues).not.toContain('Odometer is lower than the previous entry');
		}
	});

	it('marks all rows as valid for a clean CSV', async () => {
		const result = await parseFuellyCSV(SAMPLE_FUELLY_CSV);
		const rows = result.data!.rows;
		for (const row of rows) {
			expect(row.status).toBe('valid');
			expect(row.issues).toEqual([]);
		}
	});

	it('surfaces missing fields as error/warning issues', async () => {
		const result = await parseFuellyCSV(MISSING_FIELDS_CSV);
		const row = result.data!.rows[0];
		// Missing odometer and missing date
		expect(row.status).toBe('error');
		expect(row.issues).toContain('Missing date');
		expect(row.issues).toContain('Missing odometer reading');
	});

	it('builds dry-run summary with correct counts', async () => {
		const result = await parseFuellyCSV(SAMPLE_FUELLY_CSV);
		const summary = result.data!.summary;

		expect(summary.totalRows).toBe(2);
		expect(summary.validCount).toBe(2);
		expect(summary.warningCount).toBe(0);
		expect(summary.errorCount).toBe(0);
	});

	it('builds dry-run summary with date range', async () => {
		const result = await parseFuellyCSV(SAMPLE_FUELLY_CSV);
		const summary = result.data!.summary;

		expect(summary.dateRange).not.toBeNull();
		expect(summary.dateRange!.start).toEqual(new Date(2021, 5, 6));
		expect(summary.dateRange!.end).toEqual(new Date(2021, 5, 12));
	});

	it('builds column mapping with mapped, calculated, and ignored entries', async () => {
		const result = await parseFuellyCSV(SAMPLE_FUELLY_CSV);
		const mapping = result.data!.columnMapping;

		const mapped = mapping.filter((m) => m.status === 'mapped');
		const calculated = mapping.filter((m) => m.status === 'calculated');
		const ignored = mapping.filter((m) => m.status === 'ignored');

		expect(mapped.length).toBeGreaterThanOrEqual(5);
		expect(calculated).toHaveLength(1);
		expect(calculated[0].sourceColumn).toBe('price');
		expect(calculated[0].targetField).toBe('Total cost');
		expect(ignored.length).toBeGreaterThan(0);
	});

	it('returns error for empty CSV content', async () => {
		const result = await parseFuellyCSV('');
		expect(result.error).not.toBeNull();
		expect(result.error!.code).toBe('PARSE_FAILED');
	});

	it('returns error for header-only CSV', async () => {
		const csv =
			'car_name,model,l/100km,odometer,km,litres,price,city_percentage,fuelup_date,date_added,tags,notes,missed_fuelup,partial_fuelup,latitude,longitude,brand';
		const result = await parseFuellyCSV(csv);
		expect(result.error).not.toBeNull();
		expect(result.error!.code).toBe('PARSE_FAILED');
	});

	it('handles mixed valid/warning/error rows in summary', async () => {
		const csv = `car_name,model,l/100km,odometer,km,litres,price,city_percentage,fuelup_date,date_added,tags,notes,missed_fuelup,partial_fuelup,latitude,longitude,brand
Renegade,Jeep,18.71,186886,306.998,57.432,1.269,50,06/06/2021 0:00,06/06/2021,,,0,0,,,
Renegade,Jeep,15.82,187205,319.016,50.441,,50,06/12/2021 0:00,06/12/2021,,,0,0,,,
Renegade,Jeep,14.00,,300,40.5,1.3,50,,06/18/2021,,,0,0,,,`;

		const result = await parseFuellyCSV(csv);
		const summary = result.data!.summary;

		expect(summary.totalRows).toBe(3);
		expect(summary.validCount).toBe(1); // first row OK
		expect(summary.warningCount).toBe(1); // second row: missing price → NaN cost (warning)
		expect(summary.errorCount).toBe(1); // third row: missing odometer + date
	});

	it('preserves original row numbers in output (not sorted order)', async () => {
		const result = await parseFuellyCSV(MULTI_VEHICLE_CSV);
		const rows = result.data!.rows;
		// Rows should be in original CSV order
		expect(rows[0].rowNumber).toBe(1);
		expect(rows[1].rowNumber).toBe(2);
		expect(rows[2].rowNumber).toBe(3);
	});

	it('handles single-digit month/day in date parsing', async () => {
		const csv = `car_name,model,l/100km,odometer,km,litres,price,city_percentage,fuelup_date,date_added,tags,notes,missed_fuelup,partial_fuelup,latitude,longitude,brand
Car,Make,10,50000,300,40,1.5,50,1/5/2022 0:00,1/5/2022,,,0,0,,,`;

		const result = await parseFuellyCSV(csv);
		const row = result.data!.rows[0];
		expect(row.data.date).toEqual(new Date(2022, 0, 5)); // January 5, 2022
	});

	it('returns error for CSV with broken quoting (PapaParse errors)', async () => {
		const malformedCSV = `car_name,model,l/100km,odometer,km,litres,price,city_percentage,fuelup_date,date_added,tags,notes,missed_fuelup,partial_fuelup,latitude,longitude,brand
"Renegade,Jeep,18.71,186886,306.998,57.432,1.269,50,06/06/2021 0:00,06/06/2021,,,0,0,,,`;

		const result = await parseFuellyCSV(malformedCSV);
		expect(result.error).not.toBeNull();
		expect(result.error!.code).toBe('PARSE_FAILED');
		expect(result.error!.message).toContain('malformed');
	});

	it('detects odometer decrease within the same vehicle', async () => {
		const csv = `car_name,model,l/100km,odometer,km,litres,price,city_percentage,fuelup_date,date_added,tags,notes,missed_fuelup,partial_fuelup,latitude,longitude,brand
MyCar,Make,10,50000,300,40,1.5,50,01/01/2022 0:00,01/01/2022,,,0,0,,,
MyCar,Make,10,49000,300,40,1.5,50,01/15/2022 0:00,01/15/2022,,,0,0,,,`;

		const result = await parseFuellyCSV(csv);
		const rows = result.data!.rows;
		const secondRow = rows.find((r) => r.rowNumber === 2)!;
		expect(secondRow.issues).toContain('Odometer is lower than the previous entry');
	});
});
