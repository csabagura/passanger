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

// Story 8.3 AC3 regression — a comma-decimal cell must parse via the shared normalizeDecimal, not
// silently truncate through bare parseFloat("45,2") -> 45.
const COMMA_DECIMAL_ACAR_CSV = `## Vehicle
"Name","Description","DistUnit","FuelUnit","ConsumptionUnit","ImportCSVDateFormat","VIN","Insurance","Plate","Make","Model","Year","TankCount","Tank1Type","Tank2Type","Active","Tank1Capacity","Tank2Capacity"
"Toyota Auris","","0","0","0","yyyy-MM-dd","","","","toyota","auris","2018","1","100","0","1","50.0","0.0"

## Log
"Data","Odo (km)","Fuel (litres)","Full","Price (optional)","l/100km (optional)","latitude (optional)","longitude (optional)","City (optional)","Notes (optional)","Missed","TankNumber","FuelType","VolumePrice","StationID (optional)","ExcludeDistance","UniqueId","TankCalc"
"2018-10-07","424,5","45,2","1","1172,92","0.0","50.0436","14.4406","Praha, Olbrachtova - Mol","","0","1","0","35.5","329285","0","105","0.0"`;

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

	it('parses comma-decimal odometer/quantity/price cells via shared normalizeDecimal (AC3)', async () => {
		const result = await parseACarCSV(COMMA_DECIMAL_ACAR_CSV);
		expect(result.error).toBeNull();
		const row = result.data!.rows[0];
		expect(row.data.odometer).toBeCloseTo(424.5);
		expect(row.data.quantity).toBeCloseTo(45.2);
		expect(row.data.quantity).not.toBe(45);
		expect(row.data.totalCost).toBeCloseTo(1172.92);
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

	describe('aCar unit fallback (Story 8.3 AC6/S8)', () => {
		it('falls back to the Vehicle-section DistUnit code when the header carries no unit hint', async () => {
			const csv = `## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","1","0"

## Log
"Data","Odo","Fuel (litres)","Price (optional)"
"2018-10-07","424","33.04","50"`;

			const result = await parseACarCSV(csv);
			expect(result.error).toBeNull();
			// DistUnit=1 (miles) — header "Odo" has no (km)/(mi) suffix at all, so it must NOT
			// silently default to km.
			expect(result.data!.detectedUnits!.distance).toBe('mi');
			expect(result.data!.rows[0].data.distanceUnit).toBe('mi');
		});

		it('a header WITH a unit hint still wins over the Vehicle-section code', async () => {
			const csv = `## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","1","0"

## Log
"Data","Odo (km)","Fuel (litres)","Price (optional)"
"2018-10-07","424","33.04","50"`;

			const result = await parseACarCSV(csv);
			expect(result.error).toBeNull();
			// Header explicitly says km even though DistUnit=1 (miles) — header wins.
			expect(result.data!.detectedUnits!.distance).toBe('km');
		});
	});

	describe('UK gallons (Story 8.3 AC7/S11)', () => {
		it('converts a UK-gallon header quantity to litres and reports unit L', async () => {
			const csv = `## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","0","0"

## Log
"Data","Odo (km)","Fuel (uk gallons)","Price (optional)"
"2018-10-07","424","10","50"`;

			const result = await parseACarCSV(csv);
			expect(result.error).toBeNull();
			expect(result.data!.detectedUnits!.fuel).toBe('L');
			// 10 UK gallons * 4.54609 = 45.4609 L
			expect(result.data!.rows[0].data.quantity).toBeCloseTo(45.4609, 3);
			expect(result.data!.rows[0].data.unit).toBe('L');
		});

		it('converts via the Vehicle-code FuelUnit=2 fallback when headers give no fuel-unit signal', async () => {
			const csv = `## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","0","2"

## Log
"Data","Odo (km)","Fuel (optional)","Price (optional)"
"2018-10-07","424","10","50"`;

			const result = await parseACarCSV(csv);
			expect(result.error).toBeNull();
			expect(result.data!.detectedUnits!.fuel).toBe('L');
			expect(result.data!.rows[0].data.quantity).toBeCloseTo(45.4609, 3);
		});

		it('a US-gallon file is unaffected (no conversion, still gal)', async () => {
			const result = await parseACarCSV(IMPERIAL_ACAR_CSV);
			expect(result.data!.detectedUnits!.fuel).toBe('gal');
			expect(result.data!.rows[0].data.unit).toBe('gal');
			expect(result.data!.rows[0].data.quantity).toBeCloseTo(12.5);
		});
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

	it("an unparseable-date row does not seed or poison another row's decrease chain (S7)", async () => {
		const csv = `## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","0","0"

## Log
"Data","Odo (km)","Fuel (litres)","Full","Price (optional)"
"not-a-date","999999","33.04","1","50"
"2018-10-07","1000","30.12","1","45"
"2018-10-14","1100","28.0","1","40"`;

		const result = await parseACarCSV(csv);
		const rows = result.data!.rows;
		const row1 = rows.find((r) => r.rowNumber === 1)!;
		const row2 = rows.find((r) => r.rowNumber === 2)!;
		const row3 = rows.find((r) => r.rowNumber === 3)!;

		expect(row1.issues).toContain('Missing date');
		expect(row2.issues).not.toContain('Odometer is lower than the previous entry');
		expect(row3.issues).not.toContain('Odometer is lower than the previous entry');
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

	it('maps the Full / Missed columns into the fill-quality flags (Story 7.1 / review P1)', async () => {
		const csv = `## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","0","0"

## Log
"Data","Odo (km)","Fuel (litres)","Full","Price (optional)","Missed"
"2018-10-07","424","33.04","1","1172.92","0"
"2018-10-14","850","15.00","0","500.00","0"
"2018-10-21","1200","31.50","1","1100.00","1"`;

		const result = await parseACarCSV(csv);
		expect(result.error).toBeNull();
		const rows = result.data!.rows;

		// Row 1: Full=1 → not partial; Missed=0 → not missed.
		expect(rows[0].data.isPartialFill).toBe(false);
		expect(rows[0].data.precededByMissedFill).toBe(false);
		// Row 2: Full=0 → PARTIAL (Full is the boolean inverse of isPartialFill).
		expect(rows[1].data.isPartialFill).toBe(true);
		expect(rows[1].data.precededByMissedFill).toBe(false);
		// Row 3: Missed=1 → missed predecessor.
		expect(rows[2].data.isPartialFill).toBe(false);
		expect(rows[2].data.precededByMissedFill).toBe(true);

		// The columns are surfaced as mapped (no longer "(ignored)").
		const mapping = result.data!.columnMapping;
		expect(mapping.find((c) => c.sourceColumn === 'Full')?.status).toBe('mapped');
		expect(mapping.find((c) => c.sourceColumn === 'Missed')?.status).toBe('mapped');
	});

	it('defaults both fill-quality flags to false when Full/Missed are absent (Story 7.1)', async () => {
		const csv = `## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","0","0"

## Log
"Data","Odo (km)","Fuel (litres)","Price (optional)"
"2018-10-07","424","33.04","1172.92"`;

		const result = await parseACarCSV(csv);
		expect(result.error).toBeNull();
		const rows = result.data!.rows;
		// An ABSENT Full column must not flag a partial (inverse semantics only apply to an
		// explicit '0'/'false'/'no').
		expect(rows[0].data.isPartialFill).toBe(false);
		expect(rows[0].data.precededByMissedFill).toBe(false);
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
