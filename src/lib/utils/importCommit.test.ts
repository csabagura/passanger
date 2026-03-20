// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '$lib/db/db'
import { commitImportRows } from '$lib/utils/importCommit'
import type { ImportRow, VehicleAssignment } from '$lib/utils/importTypes'
import { MAX_VEHICLES } from '$lib/config'

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
	}
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
	}
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
	}
}

function makeNewAssignment(
	sourceVehicleName: string,
	rowCount = 1
): VehicleAssignment {
	return {
		sourceVehicleName,
		rowCount,
		assignmentType: 'new',
		newVehicle: {
			name: sourceVehicleName,
			make: 'TestMake',
			model: 'TestModel'
		}
	}
}

describe('commitImportRows', () => {
	beforeEach(async () => {
		await db.delete()
		await db.open()
	})

	it('commits fuel rows with correct NewFuelLog fields and calculated consumption', async () => {
		// Create an existing vehicle
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any)

		const rows = [makeFuelRow(1, { odometer: 10000 }), makeFuelRow(2, { odometer: 10200 })]
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)]

		const result = await commitImportRows(rows, assignments)

		expect(result.error).toBeNull()
		expect(result.data!.fuelCount).toBe(2)
		expect(result.data!.totalImported).toBe(2)

		const logs = await db.fuelLogs.toArray()
		expect(logs).toHaveLength(2)
		expect(logs[0].vehicleId).toBe(vehicleId)
		expect(logs[0].date).toBeInstanceOf(Date)
		expect(logs[0].unit).toBe('L')
		expect(logs[0].distanceUnit).toBe('km')
	})

	it('commits maintenance rows with correct NewExpense fields', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any)

		const rows = [makeMaintenanceRow(1)]
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number)]

		const result = await commitImportRows(rows, assignments)

		expect(result.error).toBeNull()
		expect(result.data!.maintenanceCount).toBe(1)

		const expenses = await db.expenses.toArray()
		expect(expenses).toHaveLength(1)
		expect(expenses[0].vehicleId).toBe(vehicleId)
		expect(expenses[0].type).toBe('Oil Change')
		expect(expenses[0].cost).toBe(100)
	})

	it('creates new vehicles before committing rows', async () => {
		const rows = [makeFuelRow(1)]
		const assignments = [makeNewAssignment('TestCar')]

		const result = await commitImportRows(rows, assignments)

		expect(result.error).toBeNull()
		expect(result.data!.vehiclesCreated).toEqual(['TestCar'])

		const vehicles = await db.vehicles.toArray()
		expect(vehicles).toHaveLength(1)
		expect(vehicles[0].name).toBe('TestCar')
		expect(vehicles[0].make).toBe('TestMake')
	})

	it('maps source vehicle names to correct vehicle IDs', async () => {
		const v1Id = await db.vehicles.add({ name: 'Car A', make: 'Honda', model: 'Civic' } as any)
		const v2Id = await db.vehicles.add({ name: 'Car B', make: 'Toyota', model: 'Corolla' } as any)

		const rows = [
			makeFuelRow(1, { sourceVehicleName: 'Car A' }),
			makeFuelRow(2, { sourceVehicleName: 'Car B' })
		]
		const assignments = [
			makeExistingAssignment('Car A', v1Id as number),
			makeExistingAssignment('Car B', v2Id as number)
		]

		const result = await commitImportRows(rows, assignments)

		expect(result.error).toBeNull()
		const logs = await db.fuelLogs.toArray()
		expect(logs.find((l) => l.vehicleId === v1Id)).toBeTruthy()
		expect(logs.find((l) => l.vehicleId === v2Id)).toBeTruthy()
	})

	it('calculates consumption: first row per vehicle gets 0, subsequent use calculateConsumption()', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any)

		const rows = [
			makeFuelRow(1, { odometer: 10000, quantity: 40 }),
			makeFuelRow(2, { odometer: 10500, quantity: 45 })
		]
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)]

		const result = await commitImportRows(rows, assignments)
		expect(result.error).toBeNull()

		const logs = await db.fuelLogs.toArray()
		// Sort by odometer to match calculation order
		logs.sort((a, b) => a.odometer - b.odometer)

		// First row: consumption = 0
		expect(logs[0].calculatedConsumption).toBe(0)
		// Second row: (45 / 500) * 100 = 9.0 L/100km
		expect(logs[1].calculatedConsumption).toBe(9)
	})

	it('sorts fuel rows by odometer per vehicle for correct consumption calculation', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any)

		// Rows in reverse odometer order
		const rows = [
			makeFuelRow(1, { odometer: 10500, quantity: 45 }),
			makeFuelRow(2, { odometer: 10000, quantity: 40 })
		]
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)]

		const result = await commitImportRows(rows, assignments)
		expect(result.error).toBeNull()

		const logs = await db.fuelLogs.toArray()
		logs.sort((a, b) => a.odometer - b.odometer)

		// Even though row order was reversed, sort ensures correct consumption
		expect(logs[0].calculatedConsumption).toBe(0) // 10000 km (first after sort)
		expect(logs[1].calculatedConsumption).toBe(9) // (45/500)*100 = 9
	})

	it('rolls back entire import on transaction failure (Dexie atomicity)', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any)

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
		} as any)

		const rows = [
			makeFuelRow(1, { odometer: 10000 }),
			makeFuelRow(2, { odometer: 10200 })
		]
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)]

		// Mock fuelLogs.add to throw on the second call, forcing a transaction failure
		const originalAdd = db.fuelLogs.add.bind(db.fuelLogs)
		let addCallCount = 0
		vi.spyOn(db.fuelLogs, 'add').mockImplementation(async (...args: any[]) => {
			addCallCount++
			if (addCallCount === 2) {
				throw new Error('Simulated Dexie add failure')
			}
			return originalAdd(...args)
		})

		const result = await commitImportRows(rows, assignments)

		expect(result.error).not.toBeNull()
		expect(result.error!.code).toBe('IMPORT_FAILED')

		// Existing data should still be intact after rollback
		const allLogs = await db.fuelLogs.toArray()
		const existingLog = allLogs.find((l) => l.notes === 'existing')
		expect(existingLog).toBeTruthy()

		// No import data should have been persisted (transaction rolled back)
		const importedLogs = allLogs.filter((l) => l.notes !== 'existing')
		expect(importedLogs).toHaveLength(0)
	})

	it('returns correct ImportCommitResult counts', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any)

		const rows = [
			makeFuelRow(1),
			makeFuelRow(2),
			makeMaintenanceRow(3),
			makeFuelRow(4, {}, 'error') // error row = skipped
		]
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 4)]

		const result = await commitImportRows(rows, assignments)

		expect(result.error).toBeNull()
		expect(result.data).toEqual({
			fuelCount: 2,
			maintenanceCount: 1,
			skippedCount: 1,
			vehiclesCreated: [],
			vehiclesMatched: ['TestCar'],
			totalImported: 3
		})
	})

	it('calls onProgress callback with current/total', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any)

		const rows = [makeFuelRow(1), makeFuelRow(2)]
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)]

		const progressCalls: Array<[number, number]> = []
		const onProgress = (current: number, total: number) => {
			progressCalls.push([current, total])
		}

		const result = await commitImportRows(rows, assignments, onProgress)

		expect(result.error).toBeNull()
		expect(progressCalls).toEqual([
			[1, 2],
			[2, 2]
		])
	})

	it('rejects when MAX_VEHICLES would be exceeded', async () => {
		// Fill up to MAX_VEHICLES
		for (let i = 0; i < MAX_VEHICLES; i++) {
			await db.vehicles.add({
				name: `Car ${i}`,
				make: 'Test',
				model: 'Model'
			} as any)
		}

		const rows = [makeFuelRow(1, { sourceVehicleName: 'New Car' })]
		const assignments = [makeNewAssignment('New Car')]

		const result = await commitImportRows(rows, assignments)

		expect(result.error).not.toBeNull()
		expect(result.error!.code).toBe('MAX_VEHICLES')
	})

	it('handles mixed fuel + maintenance rows', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any)

		const rows = [makeFuelRow(1), makeMaintenanceRow(2), makeFuelRow(3)]
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 3)]

		const result = await commitImportRows(rows, assignments)

		expect(result.error).toBeNull()
		expect(result.data!.fuelCount).toBe(2)
		expect(result.data!.maintenanceCount).toBe(1)

		const logs = await db.fuelLogs.toArray()
		const expenses = await db.expenses.toArray()
		expect(logs).toHaveLength(2)
		expect(expenses).toHaveLength(1)
	})

	it('handles multiple vehicle groups', async () => {
		const v1Id = await db.vehicles.add({ name: 'Car A', make: 'Honda', model: 'Civic' } as any)

		const rows = [
			makeFuelRow(1, { sourceVehicleName: 'Car A' }),
			makeFuelRow(2, { sourceVehicleName: 'Car B' })
		]
		const assignments = [
			makeExistingAssignment('Car A', v1Id as number),
			makeNewAssignment('Car B')
		]

		const result = await commitImportRows(rows, assignments)

		expect(result.error).toBeNull()
		expect(result.data!.vehiclesCreated).toEqual(['Car B'])
		expect(result.data!.vehiclesMatched).toEqual(['Car A'])
		expect(result.data!.totalImported).toBe(2)
	})

	it('handles rows with sourceVehicleName undefined (single-vehicle import)', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any)

		const rows = [makeFuelRow(1, { sourceVehicleName: undefined })]
		const assignments = [makeExistingAssignment('Unknown Vehicle', vehicleId as number)]

		const result = await commitImportRows(rows, assignments)

		expect(result.error).toBeNull()
		expect(result.data!.fuelCount).toBe(1)
	})

	it('handles zero importable rows gracefully', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any)

		const rows = [makeFuelRow(1, {}, 'error'), makeFuelRow(2, {}, 'error')]
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number, 2)]

		const result = await commitImportRows(rows, assignments)

		expect(result.error).toBeNull()
		expect(result.data!.totalImported).toBe(0)
		expect(result.data!.skippedCount).toBe(2)
	})

	it('preserves existing data on rollback', async () => {
		const vehicleId = await db.vehicles.add({
			name: 'TestCar',
			make: 'Honda',
			model: 'Civic'
		} as any)

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
		} as any)

		await db.expenses.add({
			vehicleId: vehicleId as number,
			date: new Date(2023, 0, 1),
			type: 'Oil Change',
			cost: 80
		} as any)

		const existingLogCount = await db.fuelLogs.count()
		const existingExpenseCount = await db.expenses.count()

		expect(existingLogCount).toBe(1)
		expect(existingExpenseCount).toBe(1)

		// Even after a commit (success or failure), existing data should remain
		const rows = [makeFuelRow(1)]
		const assignments = [makeExistingAssignment('TestCar', vehicleId as number)]

		await commitImportRows(rows, assignments)

		const allLogs = await db.fuelLogs.toArray()
		const existingLog = allLogs.find((l) => l.odometer === 5000)
		expect(existingLog).toBeTruthy()

		const allExpenses = await db.expenses.toArray()
		expect(allExpenses).toHaveLength(1)
	})
})
