// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/db/db';
import { saveFuelLog } from '$lib/db/repositories/fuelLogs';
import { saveVehicle } from '$lib/db/repositories/vehicles';
import { findDuplicateRows } from '$lib/utils/importDuplicates';
import type { ImportRow, VehicleAssignment } from '$lib/utils/importTypes';

function makeFuelRow(rowNumber: number, overrides: Partial<ImportRow['data']> = {}): ImportRow {
	return {
		rowNumber,
		status: 'valid',
		data: {
			date: new Date(2026, 0, rowNumber),
			odometer: 10000 + rowNumber,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 60,
			notes: '',
			type: 'fuel',
			sourceVehicleName: 'TestCar',
			...overrides
		},
		issues: []
	};
}

function makeExistingAssignment(
	sourceVehicleName: string,
	existingVehicleId: number
): VehicleAssignment {
	return { sourceVehicleName, rowCount: 1, assignmentType: 'existing', existingVehicleId };
}

function makeNewAssignment(sourceVehicleName: string): VehicleAssignment {
	return {
		sourceVehicleName,
		rowCount: 1,
		assignmentType: 'new',
		newVehicle: { name: sourceVehicleName, make: 'Make', model: 'Model' }
	};
}

beforeEach(async () => {
	await db.delete();
	await db.open();
});

describe('findDuplicateRows', () => {
	it('flags an exact (vehicleId, day, odometer) match as a duplicate', async () => {
		const vehicle = await saveVehicle({ name: 'TestCar', make: 'A', model: 'B' });
		const vehicleId = vehicle.data!.id;
		await saveFuelLog({
			vehicleId,
			date: new Date(2026, 0, 1, 8, 30), // time component differs — must still match at day precision
			odometer: 10001,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 60,
			calculatedConsumption: 0
		});

		const rows = [makeFuelRow(1, { odometer: 10001 })];
		const assignments = [makeExistingAssignment('TestCar', vehicleId)];

		const result = await findDuplicateRows(rows, assignments);
		expect(result.error).toBeNull();
		expect(result.data!.duplicateRowNumbers.has(1)).toBe(true);
	});

	it('does not flag a near-match with a different odometer', async () => {
		const vehicle = await saveVehicle({ name: 'TestCar', make: 'A', model: 'B' });
		const vehicleId = vehicle.data!.id;
		await saveFuelLog({
			vehicleId,
			date: new Date(2026, 0, 1),
			odometer: 10001,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 60,
			calculatedConsumption: 0
		});

		const rows = [makeFuelRow(1, { odometer: 10999 })];
		const assignments = [makeExistingAssignment('TestCar', vehicleId)];

		const result = await findDuplicateRows(rows, assignments);
		expect(result.data!.duplicateRowNumbers.size).toBe(0);
	});

	it('never checks rows destined for a newly-created vehicle', async () => {
		const rows = [makeFuelRow(1, { odometer: 10001, sourceVehicleName: 'BrandNewCar' })];
		const assignments = [makeNewAssignment('BrandNewCar')];

		const result = await findDuplicateRows(rows, assignments);
		expect(result.data!.duplicateRowNumbers.size).toBe(0);
	});

	it('never checks maintenance-type rows (they land in expenses, not fuelLogs)', async () => {
		const vehicle = await saveVehicle({ name: 'TestCar', make: 'A', model: 'B' });
		const vehicleId = vehicle.data!.id;
		await saveFuelLog({
			vehicleId,
			date: new Date(2026, 0, 1),
			odometer: 10001,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 60,
			calculatedConsumption: 0
		});

		const rows = [makeFuelRow(1, { odometer: 10001, type: 'maintenance' })];
		const assignments = [makeExistingAssignment('TestCar', vehicleId)];

		const result = await findDuplicateRows(rows, assignments);
		expect(result.data!.duplicateRowNumbers.size).toBe(0);
	});

	it('returns no duplicates when there are no existing-vehicle assignments', async () => {
		const rows = [makeFuelRow(1)];
		const result = await findDuplicateRows(rows, []);
		expect(result.error).toBeNull();
		expect(result.data!.duplicateRowNumbers.size).toBe(0);
	});
});
