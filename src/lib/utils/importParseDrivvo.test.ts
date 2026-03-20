import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseDrivvoCSV } from './importParseDrivvo';
import type { DetectedUnits } from '$lib/utils/importTypes';

const METRIC_UNITS: DetectedUnits = { fuel: 'L', distance: 'km' };

const SAMPLE_DRIVVO_CSV = `##Refuelling
Odometer,Date,Fuel type,Volume price,Total price,Fuel amount,Full fillup,,,,,,,,,,,,Notes
12345,5/3/2024,gasoline,1.85,55.50,30.0,Yes,,,,,,,,,,,,Highway trip
12700,12/3/2024,gasoline,1.90,52.73,27.75,Yes,,,,,,,,,,,,

##Service
Odometer,Date,Cost,Title,,Notes
12500,10/3/2024,150.00,Oil change,,Regular service

##Expense
Odometer,Date,Cost,Title,,,Notes
12600,15/3/2024,45.00,Parking fee,,,Monthly pass

##Vehicle
Name,Model,Plate,,Year,Description
My Car,Honda Civic,ABC-123,,2020,Daily driver`;

const DRIVVO_REFUELLING_ONLY = `##Refuelling
Odometer,Date,Fuel type,Volume price,Total price,Fuel amount,Full fillup,,,,,,,,,,,,Notes
12345,5/3/2024,gasoline,1.85,55.50,30.0,Yes,,,,,,,,,,,,Highway trip`;

const DRIVVO_SERVICE_ONLY = `##Service
Odometer,Date,Cost,Title,,Notes
12500,10/3/2024,150.00,Oil change,,Regular service`;

const DRIVVO_SPANISH = `#Reabastecimiento
Odometer,Date,Fuel type,Volume price,Total price,Fuel amount,Full fillup,,,,,,,,,,,,Notes
12345,5/3/2024,gasolina,1.85,55.50,30.0,Si,,,,,,,,,,,,Viaje

#Servicio
Odometer,Date,Cost,Title,,Notes
12500,10/3/2024,150.00,Cambio de aceite,,Servicio regular`;

const DRIVVO_COMMA_DECIMAL = `##Refuelling
Odometer,Date,Fuel type,Volume price,Total price,Fuel amount,Full fillup,,,,,,,,,,,,Notes
12345,5/3/2024,gasoline,"1,85","55,50","30,0",Yes,,,,,,,,,,,,,`;

describe('parseDrivvoCSV', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 2, 16));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('correctly maps Refuelling section to fuel entries', async () => {
		const result = await parseDrivvoCSV(SAMPLE_DRIVVO_CSV, METRIC_UNITS);
		expect(result.error).toBeNull();
		expect(result.data).not.toBeNull();

		const fuelRows = result.data!.rows.filter((r) => r.data.type === 'fuel');
		expect(fuelRows).toHaveLength(2);

		const first = fuelRows[0];
		expect(first.data.odometer).toBe(12345);
		expect(first.data.quantity).toBeCloseTo(30.0);
		expect(first.data.totalCost).toBeCloseTo(55.50);
		expect(first.data.type).toBe('fuel');
		expect(first.data.notes).toBe('Highway trip');
	});

	it('correctly maps Service section to maintenance entries with maintenanceType', async () => {
		const result = await parseDrivvoCSV(SAMPLE_DRIVVO_CSV, METRIC_UNITS);
		const serviceRows = result.data!.rows.filter(
			(r) => r.data.type === 'maintenance' && r.data.maintenanceType === 'Oil change'
		);
		expect(serviceRows).toHaveLength(1);
		expect(serviceRows[0].data.totalCost).toBeCloseTo(150.0);
		expect(serviceRows[0].data.notes).toBe('Regular service');
	});

	it('correctly maps Expense section to maintenance entries', async () => {
		const result = await parseDrivvoCSV(SAMPLE_DRIVVO_CSV, METRIC_UNITS);
		const expenseRows = result.data!.rows.filter(
			(r) => r.data.type === 'maintenance' && r.data.maintenanceType === 'Parking fee'
		);
		expect(expenseRows).toHaveLength(1);
		expect(expenseRows[0].data.totalCost).toBeCloseTo(45.0);
		expect(expenseRows[0].data.notes).toBe('Monthly pass');
	});

	it('parses D/M/YYYY date format correctly (day-first)', async () => {
		const result = await parseDrivvoCSV(SAMPLE_DRIVVO_CSV, METRIC_UNITS);
		const fuelRows = result.data!.rows.filter((r) => r.data.type === 'fuel');

		// 5/3/2024 → March 5, 2024 (NOT May 3)
		expect(fuelRows[0].data.date).toEqual(new Date(2024, 2, 5));
		// 12/3/2024 → March 12, 2024
		expect(fuelRows[1].data.date).toEqual(new Date(2024, 2, 12));
	});

	it('handles locale-variant boolean "Yes" → true', async () => {
		const result = await parseDrivvoCSV(DRIVVO_REFUELLING_ONLY, METRIC_UNITS);
		expect(result.error).toBeNull();
		// Boolean values are parsed but don't map to passanger fields;
		// they're just not causing errors
		expect(result.data!.rows[0].data.type).toBe('fuel');
	});

	it('handles locale-variant boolean "Si" (Spanish)', async () => {
		const result = await parseDrivvoCSV(DRIVVO_SPANISH, METRIC_UNITS);
		expect(result.error).toBeNull();
		const fuelRows = result.data!.rows.filter((r) => r.data.type === 'fuel');
		expect(fuelRows).toHaveLength(1);
	});

	it('handles sparse columns — notes at index 18 for refuelling', async () => {
		const result = await parseDrivvoCSV(DRIVVO_REFUELLING_ONLY, METRIC_UNITS);
		expect(result.data!.rows[0].data.notes).toBe('Highway trip');
	});

	it('handles comma decimal separator', async () => {
		const result = await parseDrivvoCSV(DRIVVO_COMMA_DECIMAL, METRIC_UNITS);
		expect(result.error).toBeNull();

		const row = result.data!.rows[0];
		expect(row.data.totalCost).toBeCloseTo(55.50);
		expect(row.data.quantity).toBeCloseTo(30.0);
	});

	it('extracts vehicle name from Vehicle section', async () => {
		const result = await parseDrivvoCSV(SAMPLE_DRIVVO_CSV, METRIC_UNITS);
		for (const row of result.data!.rows) {
			expect(row.data.sourceVehicleName).toBe('My Car');
		}
	});

	it('returns mixed fuel + maintenance entries in result', async () => {
		const result = await parseDrivvoCSV(SAMPLE_DRIVVO_CSV, METRIC_UNITS);
		const types = result.data!.rows.map((r) => r.data.type);
		expect(types).toContain('fuel');
		expect(types).toContain('maintenance');
	});

	it('handles Spanish locale section headers', async () => {
		const result = await parseDrivvoCSV(DRIVVO_SPANISH, METRIC_UNITS);
		expect(result.error).toBeNull();
		expect(result.data!.rows.length).toBeGreaterThan(0);

		const fuelRows = result.data!.rows.filter((r) => r.data.type === 'fuel');
		const maintRows = result.data!.rows.filter((r) => r.data.type === 'maintenance');
		expect(fuelRows).toHaveLength(1);
		expect(maintRows).toHaveLength(1);
	});

	it('parses Service-only file when Refuelling section is missing', async () => {
		const result = await parseDrivvoCSV(DRIVVO_SERVICE_ONLY, METRIC_UNITS);
		expect(result.error).toBeNull();
		expect(result.data!.rows).toHaveLength(1);
		expect(result.data!.rows[0].data.type).toBe('maintenance');
	});

	it('returns error for empty file with no data sections', async () => {
		const result = await parseDrivvoCSV('just some text\nnothing', METRIC_UNITS);
		expect(result.error).not.toBeNull();
		expect(result.error!.code).toBe('PARSE_FAILED');
	});

	it('propagates userUnits to all rows', async () => {
		const imperial: DetectedUnits = { fuel: 'gal', distance: 'mi' };
		const result = await parseDrivvoCSV(SAMPLE_DRIVVO_CSV, imperial);

		for (const row of result.data!.rows) {
			expect(row.data.unit).toBe('gal');
			expect(row.data.distanceUnit).toBe('mi');
		}
	});

	it('returns null detectedUnits (Drivvo has no unit info in file)', async () => {
		const result = await parseDrivvoCSV(SAMPLE_DRIVVO_CSV, METRIC_UNITS);
		expect(result.data!.detectedUnits).toBeNull();
	});

	it('builds dry-run summary with correct counts', async () => {
		const result = await parseDrivvoCSV(SAMPLE_DRIVVO_CSV, METRIC_UNITS);
		const summary = result.data!.summary;

		expect(summary.totalRows).toBe(4); // 2 fuel + 1 service + 1 expense
		expect(summary.detectedVehicleNames).toContain('My Car');
	});

	it('skips quantity validation for maintenance entries', async () => {
		const result = await parseDrivvoCSV(DRIVVO_SERVICE_ONLY, METRIC_UNITS);
		const row = result.data!.rows[0];
		// Service rows have no quantity — should NOT get "Missing fuel quantity" error
		expect(row.issues).not.toContain('Missing fuel quantity');
	});

	it('builds column mapping for refuelling sections', async () => {
		const result = await parseDrivvoCSV(DRIVVO_REFUELLING_ONLY, METRIC_UNITS);
		const mapping = result.data!.columnMapping;
		expect(mapping.some((m) => m.sourceColumn === 'Odometer')).toBe(true);
		expect(mapping.some((m) => m.sourceColumn === 'Date')).toBe(true);
		expect(mapping.some((m) => m.sourceColumn === 'Total price')).toBe(true);
		expect(mapping.some((m) => m.sourceColumn === 'Fuel amount')).toBe(true);
	});

	it('handles European number format "1.234,56"', async () => {
		const csv = `##Refuelling
Odometer,Date,Fuel type,Volume price,Total price,Fuel amount,Full fillup,,,,,,,,,,,,Notes
12345,5/3/2024,gasoline,"1,85","1.055,50","30,0",Yes,,,,,,,,,,,,,`;

		const result = await parseDrivvoCSV(csv, METRIC_UNITS);
		expect(result.error).toBeNull();
		// "1.055,50" → 1055.50
		expect(result.data!.rows[0].data.totalCost).toBeCloseTo(1055.50);
	});

	it('handles empty notes gracefully', async () => {
		const csv = `##Refuelling
Odometer,Date,Fuel type,Volume price,Total price,Fuel amount,Full fillup
12345,5/3/2024,gasoline,1.85,55.50,30.0,Yes`;

		const result = await parseDrivvoCSV(csv, METRIC_UNITS);
		expect(result.error).toBeNull();
		expect(result.data!.rows[0].data.notes).toBe('');
	});

	it('detects odometer decrease across mixed entry types', async () => {
		const csv = `##Refuelling
Odometer,Date,Fuel type,Volume price,Total price,Fuel amount,Full fillup
12700,15/3/2024,gasoline,1.85,55.50,30.0,Yes

##Service
Odometer,Date,Cost,Title,,Notes
12500,16/3/2024,150.00,Oil change,,`;

		const result = await parseDrivvoCSV(csv, METRIC_UNITS);
		const rows = result.data!.rows;
		// After date sorting: 15/3 (12700) then 16/3 (12500) — decrease
		const serviceRow = rows.find((r) => r.data.type === 'maintenance')!;
		expect(serviceRow.issues).toContain('Odometer is lower than the previous entry');
	});
});
