// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '$lib/db/db';
import { commitImportRows } from '$lib/utils/importCommit';
import { findDuplicateRows } from '$lib/utils/importDuplicates';
import type { ImportRow, VehicleAssignment } from '$lib/utils/importTypes';
import { MAX_VEHICLES, DEFAULT_CURRENCY } from '$lib/config';

function makeFuelRow(
	rowNumber: number,
	overrides: Partial<ImportRow['data']> = {},
	status: ImportRow['status'] = 'valid'
): ImportRow {
	return {
		rowNumber,
		status,
		data: {
			date: new Date(2024, 0, rowNumber),
			odometer: 10000 + rowNumber * 200,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 60,
			notes: '',
			type: 'fuel',
			sourceVehicleName: 'TestCar',
			...overrides
		},
		issues: status === 'error' ? ['Missing odometer reading'] : []
	};
}

function makeMaintenanceRow(
	rowNumber: number,
	overrides: Partial<ImportRow['data']> = {},
	status: ImportRow['status'] = 'valid'
): ImportRow {
	return {
		rowNumber,
		status,
		data: {
			date: new Date(2024, 0, rowNumber),
			odometer: 10000 + rowNumber * 200,
			quantity: 0,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 100,
			notes: 'Oil change',
			type: 'maintenance',
			maintenanceType: 'Oil Change',
			sourceVehicleName: 'TestCar',
			...overrides
		},
		issues: []
	};
}

function makeExistingAssignment(
	sourceVehicleName: string,
	existingVehicleId: number,
	rowCount = 1
): VehicleAssignment {
	return {
		sourceVehicleName,
		rowCount,
		assignmentType: 'existing',
		existingVehicleId
	};
}

function makeNewAssignment(sourceVehicleName: string, rowCount = 1): VehicleAssignment {
	return {
		sourceVehicleName,
		rowCount,
		assignmentType: 'new',
		newVehicle: {
			name: sourceVehicleName,
			make: 'TestMake',
			model: 'TestModel'
		}
	};
}

describe('commitImportRows', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it('commits fuel rows with correct NewFuelLog fields and calculated consumption', async () => {
		// Create an existing vehicle
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [makeFuelRow(1, { odometer: 10000 }), makeFuelRow(2, { odometer: 10200 })];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)];

		const result = await commitImportRows(rows, assignments);

		expect(result.error).toBeNull();
		expect(result.data!.fuelCount).toBe(2);
		expect(result.data!.totalImported).toBe(2);

		const logs = await db.fuelLogs.toArray();
		expect(logs).toHaveLength(2);
		expect(logs[0].vehicleId).toBe(vehicleId);
		expect(logs[0].date).toBeInstanceOf(Date);
		expect(logs[0].unit).toBe('L');
		expect(logs[0].distanceUnit).toBe('km');
	});

	it('commits maintenance rows with correct NewExpense fields', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [makeMaintenanceRow(1)];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number)];

		const result = await commitImportRows(rows, assignments);

		expect(result.error).toBeNull();
		expect(result.data!.maintenanceCount).toBe(1);

		const expenses = await db.expenses.toArray();
		expect(expenses).toHaveLength(1);
		expect(expenses[0].vehicleId).toBe(vehicleId);
		expect(expenses[0].type).toBe('Oil Change');
		expect(expenses[0].cost).toBe(100);
	});

	it('coerces a non-finite totalCost to 0 at the commit boundary (H8 regression)', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		// NaN passes `?? 0` (nullish covers only null/undefined), so without the finite coercion a
		// NaN cost lands in Dexie. The row itself stays a warning row upstream — unchanged here.
		const rows = [
			makeFuelRow(1, { totalCost: NaN }, 'warning'),
			makeMaintenanceRow(2, { totalCost: NaN }, 'warning')
		];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)];

		const result = await commitImportRows(rows, assignments);
		expect(result.error).toBeNull();

		const logs = await db.fuelLogs.toArray();
		expect(logs).toHaveLength(1);
		expect(logs[0].totalCost).toBe(0);

		const expenses = await db.expenses.toArray();
		expect(expenses).toHaveLength(1);
		expect(expenses[0].cost).toBe(0);
	});

	it('stamps imported fuel AND expense rows with the home currency (defaults to DEFAULT_CURRENCY)', async () => {
		// Story 5.3 AC4: imported rows carry a currency defaulting to home currency. In the node test
		// env there is no localStorage, so getSettings() yields DEFAULT_CURRENCY — assert it propagates
		// to BOTH tables, locking the importCommit.ts:26/137/154 behavior the Preview now surfaces.
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [makeFuelRow(1), makeMaintenanceRow(2)];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)];

		const result = await commitImportRows(rows, assignments);
		expect(result.error).toBeNull();

		const logs = await db.fuelLogs.toArray();
		const expenses = await db.expenses.toArray();
		expect(logs).toHaveLength(1);
		expect(expenses).toHaveLength(1);
		expect(logs[0].currency).toBe(DEFAULT_CURRENCY);
		expect(expenses[0].currency).toBe(DEFAULT_CURRENCY);
	});

	it('creates new vehicles before committing rows', async () => {
		const rows = [makeFuelRow(1)];
		const assignments = [makeNewAssignment('TestCar')];

		const result = await commitImportRows(rows, assignments);

		expect(result.error).toBeNull();
		expect(result.data!.vehiclesCreated).toEqual(['TestCar']);

		const vehicles = await db.vehicles.toArray();
		expect(vehicles).toHaveLength(1);
		expect(vehicles[0].name).toBe('TestCar');
		expect(vehicles[0].make).toBe('TestMake');
	});

	it('maps source vehicle names to correct vehicle IDs', async () => {
		const v1Id = await db.vehicles.add({ name: 'Car A', make: 'Honda', model: 'Civic' } as any);
		const v2Id = await db.vehicles.add({ name: 'Car B', make: 'Toyota', model: 'Corolla' } as any);

		const rows = [
			makeFuelRow(1, { sourceVehicleName: 'Car A' }),
			makeFuelRow(2, { sourceVehicleName: 'Car B' })
		];
		const assignments = [
			makeExistingAssignment('Car A', v1Id as number),
			makeExistingAssignment('Car B', v2Id as number)
		];

		const result = await commitImportRows(rows, assignments);

		expect(result.error).toBeNull();
		const logs = await db.fuelLogs.toArray();
		expect(logs.find((l) => l.vehicleId === v1Id)).toBeTruthy();
		expect(logs.find((l) => l.vehicleId === v2Id)).toBeTruthy();
	});

	it('calculates consumption: first row per vehicle gets 0, subsequent use calculateConsumption()', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [
			makeFuelRow(1, { odometer: 10000, quantity: 40 }),
			makeFuelRow(2, { odometer: 10500, quantity: 45 })
		];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)];

		const result = await commitImportRows(rows, assignments);
		expect(result.error).toBeNull();

		const logs = await db.fuelLogs.toArray();
		// Sort by odometer to match calculation order
		logs.sort((a, b) => a.odometer - b.odometer);

		// First row: consumption = 0
		expect(logs[0].calculatedConsumption).toBe(0);
		// Second row: (45 / 500) * 100 = 9.0 L/100km
		expect(logs[1].calculatedConsumption).toBe(9);
	});

	it('sorts fuel rows by odometer per vehicle for correct consumption calculation', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		// Rows in reverse odometer order
		const rows = [
			makeFuelRow(1, { odometer: 10500, quantity: 45 }),
			makeFuelRow(2, { odometer: 10000, quantity: 40 })
		];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)];

		const result = await commitImportRows(rows, assignments);
		expect(result.error).toBeNull();

		const logs = await db.fuelLogs.toArray();
		logs.sort((a, b) => a.odometer - b.odometer);

		// Even though row order was reversed, sort ensures correct consumption
		expect(logs[0].calculatedConsumption).toBe(0); // 10000 km (first after sort)
		expect(logs[1].calculatedConsumption).toBe(9); // (45/500)*100 = 9
	});

	it('defers partial fills, zeroes missed-preceded intervals, and persists the flags (Story 7.1)', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [
			makeFuelRow(1, { odometer: 10000, quantity: 40 }),
			makeFuelRow(2, { odometer: 10500, quantity: 45 }),
			makeFuelRow(3, { odometer: 11000, quantity: 20, isPartialFill: true }),
			makeFuelRow(4, { odometer: 11500, quantity: 30 }),
			makeFuelRow(5, { odometer: 12000, quantity: 42, precededByMissedFill: true })
		];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 5)];

		const result = await commitImportRows(rows, assignments);
		expect(result.error).toBeNull();

		const logs = (await db.fuelLogs.toArray()).sort((a, b) => a.odometer - b.odometer);
		expect(logs[0].calculatedConsumption).toBe(0); // first fill
		expect(logs[1].calculatedConsumption).toBe(9); // full: (45/500)*100
		expect(logs[2].calculatedConsumption).toBe(0); // partial deferred
		expect(logs[2].isPartialFill).toBe(true);
		// full fill spanning the partial: litres (20+30) over 1000 km → (50/1000)*100 = 5
		expect(logs[3].calculatedConsumption).toBe(5);
		expect(logs[4].calculatedConsumption).toBe(0); // missed-preceded → excluded
		expect(logs[4].precededByMissedFill).toBe(true);
	});

	it('rolls back entire import on transaction failure (Dexie atomicity)', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		// Pre-populate existing data that should survive rollback
		await db.fuelLogs.add({
			vehicleId: vehicleId as number,
			date: new Date(2023, 0, 1),
			odometer: 5000,
			quantity: 30,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 50,
			calculatedConsumption: 0,
			notes: 'existing'
		} as any);

		const rows = [makeFuelRow(1, { odometer: 10000 }), makeFuelRow(2, { odometer: 10200 })];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)];

		// Mock fuelLogs.add to throw on the second call, forcing a transaction failure
		const originalAdd = db.fuelLogs.add.bind(db.fuelLogs);
		let addCallCount = 0;
		vi.spyOn(db.fuelLogs, 'add').mockImplementation(
			(...args: Parameters<typeof db.fuelLogs.add>) => {
				addCallCount++;
				if (addCallCount === 2) {
					throw new Error('Simulated Dexie add failure');
				}
				return originalAdd(...args);
			}
		);

		const result = await commitImportRows(rows, assignments);

		expect(result.error).not.toBeNull();
		expect(result.error!.code).toBe('IMPORT_FAILED');

		// Existing data should still be intact after rollback
		const allLogs = await db.fuelLogs.toArray();
		const existingLog = allLogs.find((l) => l.notes === 'existing');
		expect(existingLog).toBeTruthy();

		// No import data should have been persisted (transaction rolled back)
		const importedLogs = allLogs.filter((l) => l.notes !== 'existing');
		expect(importedLogs).toHaveLength(0);
	});

	it('returns correct ImportCommitResult counts', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [
			makeFuelRow(1),
			makeFuelRow(2),
			makeMaintenanceRow(3),
			makeFuelRow(4, {}, 'error') // error row = skipped
		];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 4)];

		const result = await commitImportRows(rows, assignments);

		expect(result.error).toBeNull();
		expect(result.data).toEqual({
			fuelCount: 2,
			maintenanceCount: 1,
			skippedCount: 1,
			vehiclesCreated: [],
			vehiclesMatched: ['TestCar'],
			totalImported: 3
		});
	});

	it('calls onProgress callback with current/total', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [makeFuelRow(1), makeFuelRow(2)];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)];

		const progressCalls: Array<[number, number]> = [];
		const onProgress = (current: number, total: number) => {
			progressCalls.push([current, total]);
		};

		const result = await commitImportRows(rows, assignments, onProgress);

		expect(result.error).toBeNull();
		expect(progressCalls).toEqual([
			[1, 2],
			[2, 2]
		]);
	});

	it('rejects when MAX_VEHICLES would be exceeded', async () => {
		// Fill up to MAX_VEHICLES
		for (let i = 0; i < MAX_VEHICLES; i++) {
			await db.vehicles.add({
				name: `Car ${i}`,
				make: 'Test',
				model: 'Model'
			} as any);
		}

		const rows = [makeFuelRow(1, { sourceVehicleName: 'New Car' })];
		const assignments = [makeNewAssignment('New Car')];

		const result = await commitImportRows(rows, assignments);

		expect(result.error).not.toBeNull();
		expect(result.error!.code).toBe('MAX_VEHICLES');
	});

	it('handles mixed fuel + maintenance rows', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [makeFuelRow(1), makeMaintenanceRow(2), makeFuelRow(3)];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 3)];

		const result = await commitImportRows(rows, assignments);

		expect(result.error).toBeNull();
		expect(result.data!.fuelCount).toBe(2);
		expect(result.data!.maintenanceCount).toBe(1);

		const logs = await db.fuelLogs.toArray();
		const expenses = await db.expenses.toArray();
		expect(logs).toHaveLength(2);
		expect(expenses).toHaveLength(1);
	});

	it('handles multiple vehicle groups', async () => {
		const v1Id = await db.vehicles.add({ name: 'Car A', make: 'Honda', model: 'Civic' } as any);

		const rows = [
			makeFuelRow(1, { sourceVehicleName: 'Car A' }),
			makeFuelRow(2, { sourceVehicleName: 'Car B' })
		];
		const assignments = [
			makeExistingAssignment('Car A', v1Id as number),
			makeNewAssignment('Car B')
		];

		const result = await commitImportRows(rows, assignments);

		expect(result.error).toBeNull();
		expect(result.data!.vehiclesCreated).toEqual(['Car B']);
		expect(result.data!.vehiclesMatched).toEqual(['Car A']);
		expect(result.data!.totalImported).toBe(2);
	});

	it('handles rows with sourceVehicleName undefined (single-vehicle import)', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [makeFuelRow(1, { sourceVehicleName: undefined })];
		const assignments = [makeExistingAssignment('Unknown Vehicle', vehicleId as number)];

		const result = await commitImportRows(rows, assignments);

		expect(result.error).toBeNull();
		expect(result.data!.fuelCount).toBe(1);
	});

	it('handles zero importable rows gracefully', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [makeFuelRow(1, {}, 'error'), makeFuelRow(2, {}, 'error')];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)];

		const result = await commitImportRows(rows, assignments);

		expect(result.error).toBeNull();
		expect(result.data!.totalImported).toBe(0);
		expect(result.data!.skippedCount).toBe(2);
	});

	it('preserves existing data on rollback', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		// Add existing data
		await db.fuelLogs.add({
			vehicleId: vehicleId as number,
			date: new Date(2023, 0, 1),
			odometer: 5000,
			quantity: 30,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 50,
			calculatedConsumption: 0
		} as any);

		await db.expenses.add({
			vehicleId: vehicleId as number,
			date: new Date(2023, 0, 1),
			type: 'Oil Change',
			cost: 80
		} as any);

		const existingLogCount = await db.fuelLogs.count();
		const existingExpenseCount = await db.expenses.count();

		expect(existingLogCount).toBe(1);
		expect(existingExpenseCount).toBe(1);

		// Even after a commit (success or failure), existing data should remain
		const rows = [makeFuelRow(1)];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number)];

		await commitImportRows(rows, assignments);

		const allLogs = await db.fuelLogs.toArray();
		const existingLog = allLogs.find((l) => l.odometer === 5000);
		expect(existingLog).toBeTruthy();

		const allExpenses = await db.expenses.toArray();
		expect(allExpenses).toHaveLength(1);
	});
});

describe('commitImportRows — ADR-006 AD-WB-3 (write-boundary hardening)', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it('H3: rejects an unpaired unit/distanceUnit row at commit — excluded from the DB, counted as skipped', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		// A UK-style Fuelly export detected as litres+miles — the invariant the repo validator
		// enforces (validateNewFuelLog) and that import previously bypassed entirely (raw db.add).
		const rows = [
			makeFuelRow(1, { odometer: 10000, quantity: 40, unit: 'L', distanceUnit: 'mi' }),
			makeFuelRow(2, { odometer: 10200, quantity: 41 }) // valid, same vehicle
		];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)];

		const result = await commitImportRows(rows, assignments);
		expect(result.error).toBeNull();
		expect(result.data!.fuelCount).toBe(1);
		expect(result.data!.skippedCount).toBe(1);
		expect(result.data!.totalImported).toBe(1);

		const logs = await db.fuelLogs.toArray();
		expect(logs).toHaveLength(1);
		expect(logs.some((l) => l.distanceUnit === 'mi')).toBe(false);
	});

	it('H3: rejects a non-positive odometer/quantity row at commit (repo-grade backstop beyond importValidation)', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [
			makeFuelRow(1, { odometer: 0 }),
			makeFuelRow(2, { odometer: 10200, quantity: -5 }),
			makeFuelRow(3, { odometer: 10400, quantity: 40 }) // valid
		];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 3)];

		const result = await commitImportRows(rows, assignments);
		expect(result.error).toBeNull();
		expect(result.data!.fuelCount).toBe(1);
		expect(result.data!.skippedCount).toBe(2);

		const logs = await db.fuelLogs.toArray();
		expect(logs).toHaveLength(1);
		expect(logs[0].odometer).toBe(10400);
		// The surviving row is the FIRST fuel log ever persisted for this vehicle — its consumption
		// must be the honest first-ever-fill 0, not a number computed against the excluded rows'
		// odometers. Before the pre-consumption filter, the two rejected rows still anchored the
		// timeline engine's synthetic pass (row1's odo=0 became a bogus "first anchor", row2 then
		// re-anchored to 10200 despite failing validation), so this row computed a poisoned 20
		// L/100km — a rejected row was influencing a persisted row's data (ADR-006 AD-WB-3).
		expect(logs[0].calculatedConsumption).toBe(0);
	});

	it('H3 (poisoning): a row rejected at commit does not become the anchor for a valid neighbor in the same batch', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		// Row 1 is rejected (quantity <= 0) but has an odometer BELOW row 2's — if it were left in the
		// synthetic timeline pass, it would anchor row 2's span at a bogus low point. row2 (the only
		// row that persists) must instead read as a first-ever fill: consumption 0.
		const rows = [
			makeFuelRow(1, { odometer: 9000, quantity: -1 }),
			makeFuelRow(2, { odometer: 10400, quantity: 40 })
		];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)];

		const result = await commitImportRows(rows, assignments);
		expect(result.error).toBeNull();
		expect(result.data!.fuelCount).toBe(1);
		expect(result.data!.skippedCount).toBe(1);

		const logs = await db.fuelLogs.toArray();
		expect(logs).toHaveLength(1);
		expect(logs[0].odometer).toBe(10400);
		expect(logs[0].calculatedConsumption).toBe(0);
	});

	it('H3: rejects an invalid expense row at commit without blocking valid rows in the same batch', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [
			// odometer: '' || 'Imported' fallback means an empty maintenanceType can't reach the
			// validator empty — use a negative odometer instead (odometer is truthy so no fallback).
			makeMaintenanceRow(1, { odometer: -5 }), // negative odometer -> invalid
			makeMaintenanceRow(2, { totalCost: -10 }) // negative cost -> invalid
		];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)];

		const result = await commitImportRows(rows, assignments);
		expect(result.error).toBeNull();
		expect(result.data!.maintenanceCount).toBe(0);
		expect(result.data!.skippedCount).toBe(2);

		const expenses = await db.expenses.toArray();
		expect(expenses).toHaveLength(0);
	});

	it('H6: a mid-commit failure leaves ZERO orphan vehicles, not just zero rows', async () => {
		const rows = [
			makeFuelRow(1, { sourceVehicleName: 'BrandNewCar' }),
			makeFuelRow(2, { sourceVehicleName: 'BrandNewCar' })
		];
		const assignments = [makeNewAssignment('BrandNewCar')];

		// Force the SECOND fuelLogs.add to throw, after the vehicle has already been created
		// earlier in the SAME transaction — pre-ADR-006, the vehicle creation happened in an
		// entirely separate, already-committed step and would have survived this failure.
		let addCallCount = 0;
		const originalAdd = db.fuelLogs.add.bind(db.fuelLogs);
		vi.spyOn(db.fuelLogs, 'add').mockImplementation(
			(...args: Parameters<typeof db.fuelLogs.add>) => {
				addCallCount++;
				if (addCallCount === 2) {
					throw new Error('Simulated Dexie add failure');
				}
				return originalAdd(...args);
			}
		);

		const result = await commitImportRows(rows, assignments);
		expect(result.error).not.toBeNull();

		// The vehicle created earlier in the SAME failed transaction must be rolled back too.
		const vehicles = await db.vehicles.toArray();
		expect(vehicles).toHaveLength(0);
		const logs = await db.fuelLogs.toArray();
		expect(logs).toHaveLength(0);
	});

	it('H6: a retry after a mid-commit failure creates the vehicle fresh — no duplicate', async () => {
		const rows = [
			makeFuelRow(1, { sourceVehicleName: 'BrandNewCar' }),
			makeFuelRow(2, { sourceVehicleName: 'BrandNewCar' })
		];
		const assignments = [makeNewAssignment('BrandNewCar')];

		let addCallCount = 0;
		const originalAdd = db.fuelLogs.add.bind(db.fuelLogs);
		const addSpy = vi
			.spyOn(db.fuelLogs, 'add')
			.mockImplementation((...args: Parameters<typeof db.fuelLogs.add>) => {
				addCallCount++;
				if (addCallCount === 2) {
					throw new Error('Simulated Dexie add failure');
				}
				return originalAdd(...args);
			});

		const firstAttempt = await commitImportRows(rows, assignments);
		expect(firstAttempt.error).not.toBeNull();
		expect(await db.vehicles.count()).toBe(0);

		addSpy.mockRestore();

		// Retry with the SAME assignments (assignmentType still 'new') — the failed attempt's
		// vehicle never persisted, so this creates it once, not a duplicate pair (H6).
		const secondAttempt = await commitImportRows(rows, assignments);
		expect(secondAttempt.error).toBeNull();
		expect(secondAttempt.data!.vehiclesCreated).toEqual(['BrandNewCar']);

		const vehicles = await db.vehicles.toArray();
		expect(vehicles).toHaveLength(1);
		const logs = await db.fuelLogs.toArray();
		expect(logs).toHaveLength(2);
	});

	it('H6: an invalid new-vehicle assignment rolls back the whole commit — no partial vehicle, no rows', async () => {
		const rows = [makeFuelRow(1, { sourceVehicleName: 'BadCar' })];
		const assignments: VehicleAssignment[] = [
			{
				sourceVehicleName: 'BadCar',
				rowCount: 1,
				assignmentType: 'new',
				newVehicle: { name: '', make: 'Honda', model: 'Civic' } // empty name -> invalid
			}
		];

		const result = await commitImportRows(rows, assignments);
		expect(result.error).not.toBeNull();
		expect(result.error!.code).toBe('VEHICLE_CREATE_FAILED');

		expect(await db.vehicles.count()).toBe(0);
		expect(await db.fuelLogs.count()).toBe(0);
	});

	it('Story 8.3 AC1/AC2: externalSkippedCount (Review/duplicate skips) folds into the final skippedCount', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		const rows = [makeFuelRow(1, { odometer: 10000 })];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 1)];

		const result = await commitImportRows(rows, assignments, undefined, 2);
		expect(result.error).toBeNull();
		expect(result.data!.fuelCount).toBe(1);
		expect(result.data!.skippedCount).toBe(2);
	});

	it('Story 8.3 AC11: end-to-end reconciliation — 1 Review-skip + 1 duplicate-skip + 1 commit-rejected all land in the one final skippedCount', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any);

		// Pre-existing fuel log — row 2 below will duplicate this exactly.
		await db.fuelLogs.add({
			vehicleId,
			date: new Date(2026, 0, 5),
			odometer: 20000,
			quantity: 30,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 45,
			calculatedConsumption: 0
		} as any);

		// Row 1 is the "Review-skip" — simulated by never including it in the array handed to
		// commitImportRows at all (buildFinalRows already stripped it in the real wizard flow), and
		// its count folded into externalSkippedCount below (reviewSkippedCount = 1).
		// Row 2 duplicates the seeded log exactly — found via findDuplicateRows, then excluded.
		// Row 3 has a non-positive quantity — passes importValidation as a warning but is rejected by
		// the repo-grade validator at commit time (commitRejectedCount).
		// Row 4 is a normal valid row.
		const rows = [
			makeFuelRow(2, { odometer: 20000, date: new Date(2026, 0, 5) }),
			makeFuelRow(3, { odometer: 20400, quantity: -5 }),
			makeFuelRow(4, { odometer: 20600 })
		];
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 4)];

		const dupResult = await findDuplicateRows(rows, assignments);
		expect(dupResult.error).toBeNull();
		expect(dupResult.data!.duplicateRowNumbers.has(2)).toBe(true);

		const rowsAfterDuplicateSkip = rows.filter(
			(r) => !dupResult.data!.duplicateRowNumbers.has(r.rowNumber)
		);
		const reviewSkippedCount = 1; // row 1, never in `rows` at all
		const duplicateSkippedCount = dupResult.data!.duplicateRowNumbers.size; // 1 (row 2)

		const result = await commitImportRows(
			rowsAfterDuplicateSkip,
			assignments,
			undefined,
			reviewSkippedCount + duplicateSkippedCount
		);

		expect(result.error).toBeNull();
		expect(result.data!.fuelCount).toBe(1); // only row 4 persists
		expect(result.data!.skippedCount).toBe(3); // 1 review + 1 duplicate + 1 commit-rejected (row 3)
	});
});
