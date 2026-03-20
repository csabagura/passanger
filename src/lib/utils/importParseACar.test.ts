import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseACarCSV } from './importParseACar';

const SAMPLE_ACAR_CSV = `## Vehicle
"Name","Description","DistUnit","FuelUnit","ConsumptionUnit","ImportCSVDateFormat","VIN","Insurance","Plate","Make","Model","Year","TankCount","Tank1Type","Tank2Type","Active","Tank1Capacity","Tank2Capacity"
"Toyota Auris","","0","0","0","yyyy-MM-dd","","","","toyota","auris","2018","1","100","0","1","50.0","0.0"

## Log
"Data","Odo (km)","Fuel (litres)","Full","Price (optional)","l/100km (optional)","latitude (optional)","longitude (optional)","City (optional)","Notes (optional)","Missed","TankNumber","FuelType","VolumePrice","StationID (optional)","ExcludeDistance","UniqueId","TankCalc"
"2018-10-07","424","33.04","1","1172.92","0.0","50.0436","14.4406","Praha, Olbrachtova - Mol","","0","1","0","35.5","329285","0","105","0.0"
"2018-10-14","850","30.12","1","1065.24","0.0","50.0500","14.4500","","Highway trip","0","1","0","35.4","0","0","106","0.0"`;

const IMPERIAL_ACAR_CSV = `## Vehicle
"Name","Description","DistUnit","FuelUnit","ConsumptionUnit"
"F-150","","1","1","1"

## Log
"Data","Odo (mi)","Fuel (us gallons)","Full","Price (optional)","mpg (optional)","Notes (optional)"
"2022-01-15","72000","12.5","1","48.75","0.0","Gas station on I-95"
"2022-01-28","72300","11.8","1","46.02","0.0",""`;

describe('parseACarCSV', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 2, 16));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('correctly maps aCar columns to passanger fields', async () => {
		const result = await parseACarCSV(SAMPLE_ACAR_CSV);
		expect(result.error).toBeNull();
		expect(result.data).not.toBeNull();

		const rows = result.data!.rows;
		expect(rows).toHaveLength(2);

		const firstRow = rows[0];
		expect(firstRow.data.date).toEqual(new Date(2018, 9, 7));
		expect(firstRow.data.odometer).toBe(424);
		expect(firstRow.data.quantity).toBeCloseTo(33.04);
		expect(firstRow.data.unit).toBe('L');
		expect(firstRow.data.distanceUnit).toBe('km');
		expect(firstRow.data.type).toBe('fuel');
		expect(firstRow.data.sourceVehicleName).toBe('Toyota Auris');
	});

	it('uses Price as total cost directly (NOT multiplied by quantity)', async () => {
		const result = await parseACarCSV(SAMPLE_ACAR_CSV);
		const rows = result.data!.rows;

		// aCar Price IS total cost — 1172.92, NOT price * quantity
		expect(rows[0].data.totalCost).toBeCloseTo(1172.92);
		expect(rows[1].data.totalCost).toBeCloseTo(1065.24);
	});

	it('parses YYYY-MM-DD date format correctly', async () => {
		const result = await parseACarCSV(SAMPLE_ACAR_CSV);
		const rows = result.data!.rows;

		expect(rows[0].data.date).toEqual(new Date(2018, 9, 7)); // Oct 7, 2018
		expect(rows[1].data.date).toEqual(new Date(2018, 9, 14)); // Oct 14, 2018
	});

	it('detects metric units from Vehicle section codes (DistUnit=0 → km, FuelUnit=0 → L)', async () => {
		const result = await parseACarCSV(SAMPLE_ACAR_CSV);
		expect(result.data!.detectedUnits).not.toBeNull();
		expect(result.data!.detectedUnits!.fuel).toBe('L');
		expect(result.data!.detectedUnits!.distance).toBe('km');
	});

	it('detects units from column headers (Odo (km), Fuel (litres))', async () => {
		const result = await parseACarCSV(SAMPLE_ACAR_CSV);
		expect(result.data!.detectedUnits!.distance).toBe('km');
		expect(result.data!.detectedUnits!.fuel).toBe('L');
	});

	it('extracts vehicle name from Vehicle section', async () => {
		const result = await parseACarCSV(SAMPLE_ACAR_CSV);
		for (const row of result.data!.rows) {
			expect(row.data.sourceVehicleName).toBe('Toyota Auris');
		}
	});

	it('extracts notes from Notes column', async () => {
		const result = await parseACarCSV(SAMPLE_ACAR_CSV);
		expect(result.data!.rows[0].data.notes).toBe('');
		expect(result.data!.rows[1].data.notes).toBe('Highway trip');
	});

	it('detects imperial units from headers and Vehicle codes', async () => {
		const result = await parseACarCSV(IMPERIAL_ACAR_CSV);
		expect(result.data!.detectedUnits!.fuel).toBe('gal');
		expect(result.data!.detectedUnits!.distance).toBe('mi');

		const row = result.data!.rows[0];
		expect(row.data.unit).toBe('gal');
		expect(row.data.distanceUnit).toBe('mi');
		expect(row.data.odometer).toBe(72000);
		expect(row.data.quantity).toBeCloseTo(12.5);
		expect(row.data.totalCost).toBeCloseTo(48.75);
	});

	it('returns error for missing ## Vehicle section', async () => {
		const csv = `## Log
"Data","Odo (km)","Fuel (litres)"
"2018-10-07","424","33.04"`;

		const result = await parseACarCSV(csv);
		expect(result.error).not.toBeNull();
		expect(result.error!.code).toBe('PARSE_FAILED');
		expect(result.error!.message).toContain('vehicle information');
	});

	it('returns error for missing ## Log section', async () => {
		const csv = `## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","0","0"`;

		const result = await parseACarCSV(csv);
		expect(result.error).not.toBeNull();
		expect(result.error!.code).toBe('PARSE_FAILED');
		expect(result.error!.message).toContain('fuel log data');
	});

	it('returns error for empty Log section', async () => {
		const csv = `## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","0","0"

## Log
"Data","Odo (km)","Fuel (litres)"`;

		const result = await parseACarCSV(csv);
		expect(result.error).not.toBeNull();
		expect(result.error!.code).toBe('PARSE_FAILED');
	});

	it('marks all rows valid for a clean CSV file', async () => {
		const result = await parseACarCSV(SAMPLE_ACAR_CSV);
		for (const row of result.data!.rows) {
			expect(row.status).toBe('valid');
			expect(row.issues).toEqual([]);
		}
	});

	it('builds dry-run summary with correct counts', async () => {
		const result = await parseACarCSV(SAMPLE_ACAR_CSV);
		const summary = result.data!.summary;

		expect(summary.totalRows).toBe(2);
		expect(summary.validCount).toBe(2);
		expect(summary.warningCount).toBe(0);
		expect(summary.errorCount).toBe(0);
		expect(summary.detectedVehicleNames).toContain('Toyota Auris');
	});

	it('builds column mapping with mapped and ignored entries', async () => {
		const result = await parseACarCSV(SAMPLE_ACAR_CSV);
		const mapping = result.data!.columnMapping;

		const mapped = mapping.filter((m) => m.status === 'mapped');
		const ignored = mapping.filter((m) => m.status === 'ignored');

		expect(mapped.length).toBeGreaterThanOrEqual(5);
		// Price is mapped (not calculated) for aCar
		const priceEntry = mapped.find((m) => m.targetField === 'Total cost');
		expect(priceEntry).toBeTruthy();
		expect(priceEntry!.status).toBe('mapped');
		expect(ignored.length).toBeGreaterThan(0);
	});

	it('surfaces validation issues for rows with missing fields', async () => {
		const csv = `## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","0","0"

## Log
"Data","Odo (km)","Fuel (litres)","Full","Price (optional)"
"","","33.04","1","1172.92"`;

		const result = await parseACarCSV(csv);
		const row = result.data!.rows[0];
		expect(row.status).toBe('error');
		expect(row.issues).toContain('Missing date');
		expect(row.issues).toContain('Missing odometer reading');
	});

	it('detects odometer decrease within entries', async () => {
		const csv = `## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","0","0"

## Log
"Data","Odo (km)","Fuel (litres)","Full","Price (optional)"
"2018-10-07","1000","33.04","1","50"
"2018-10-14","900","30.12","1","45"`;

		const result = await parseACarCSV(csv);
		const rows = result.data!.rows;
		const secondRow = rows.find((r) => r.rowNumber === 2)!;
		expect(secondRow.issues).toContain('Odometer is lower than the previous entry');
	});

	it('preserves original row numbers in output', async () => {
		const result = await parseACarCSV(SAMPLE_ACAR_CSV);
		const rows = result.data!.rows;
		expect(rows[0].rowNumber).toBe(1);
		expect(rows[1].rowNumber).toBe(2);
	});

	it('builds date range in summary', async () => {
		const result = await parseACarCSV(SAMPLE_ACAR_CSV);
		const summary = result.data!.summary;
		expect(summary.dateRange).not.toBeNull();
		expect(summary.dateRange!.start).toEqual(new Date(2018, 9, 7));
		expect(summary.dateRange!.end).toEqual(new Date(2018, 9, 14));
	});

	it('handles BOM in the file', async () => {
		const csv = `\uFEFF## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","0","0"

## Log
"Data","Odo (km)","Fuel (litres)","Full","Price (optional)"
"2018-10-07","424","33.04","1","1172.92"`;

		const result = await parseACarCSV(csv);
		expect(result.error).toBeNull();
		expect(result.data!.rows).toHaveLength(1);
	});
});
