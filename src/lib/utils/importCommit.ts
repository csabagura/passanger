// ARCH-EXCEPTION: Direct db import for multi-table atomic transaction
// Individual repository save functions cannot be wrapped in a single cross-table transaction
import { db } from '$lib/db/db'
import type { NewFuelLog, NewExpense } from '$lib/db/schema'
import { saveVehicle } from '$lib/db/repositories/vehicles'
import { ok, err } from '$lib/utils/result'
import type { Result } from '$lib/utils/result'
import { MAX_VEHICLES } from '$lib/config'
import { calculateConsumption } from '$lib/utils/calculations'
import type { ImportRow, VehicleAssignment, ImportCommitResult } from '$lib/utils/importTypes'

export async function commitImportRows(
	rows: ImportRow[],
	assignments: VehicleAssignment[],
	onProgress?: (current: number, total: number) => void
): Promise<Result<ImportCommitResult>> {
	// Step 1: Check MAX_VEHICLES before creating any
	const existingCount = await db.vehicles.count()
	const newVehicleCount = assignments.filter((a) => a.assignmentType === 'new').length
	if (existingCount + newVehicleCount > MAX_VEHICLES) {
		return err(
			'MAX_VEHICLES',
			`Cannot create ${newVehicleCount} new vehicle(s). You already have ${existingCount} of ${MAX_VEHICLES} vehicles.`
		)
	}

	// Step 2: Create new vehicles (outside transaction — needs MAX_VEHICLES check)
	const vehicleNameToId = new Map<string, number>()
	const vehiclesCreated: string[] = []
	const vehiclesMatched: string[] = []

	for (const assignment of assignments) {
		if (assignment.assignmentType === 'existing' && assignment.existingVehicleId != null) {
			vehicleNameToId.set(assignment.sourceVehicleName, assignment.existingVehicleId)
			vehiclesMatched.push(assignment.sourceVehicleName)
		} else if (assignment.assignmentType === 'new' && assignment.newVehicle) {
			const result = await saveVehicle(assignment.newVehicle)
			if (result.error) {
				return err(
					'VEHICLE_CREATE_FAILED',
					`Failed to create vehicle "${assignment.sourceVehicleName}": ${result.error.message}`
				)
			}
			vehicleNameToId.set(assignment.sourceVehicleName, result.data.id)
			vehiclesCreated.push(assignment.sourceVehicleName)
		}
	}

	// Step 3: Filter importable rows (valid or warning, exclude error)
	const importableRows = rows.filter((r) => r.status === 'valid' || r.status === 'warning')
	const skippedCount = rows.length - importableRows.length

	if (importableRows.length === 0) {
		return ok({
			fuelCount: 0,
			maintenanceCount: 0,
			skippedCount,
			vehiclesCreated,
			vehiclesMatched,
			totalImported: 0
		})
	}

	// Step 4: Separate fuel and maintenance rows, resolve vehicle IDs
	const fuelEntries: Array<{ row: ImportRow; vehicleId: number }> = []
	const maintenanceEntries: Array<{ row: ImportRow; vehicleId: number }> = []

	for (const row of importableRows) {
		const vehicleName = row.data.sourceVehicleName || 'Unknown Vehicle'
		const vehicleId = vehicleNameToId.get(vehicleName)
		if (vehicleId == null) {
			return err('IMPORT_FAILED', `No vehicle assignment found for "${vehicleName}"`)
		}

		if (row.data.type === 'maintenance') {
			maintenanceEntries.push({ row, vehicleId })
		} else {
			fuelEntries.push({ row, vehicleId })
		}
	}

	// Step 5: Calculate consumption for fuel rows
	// Group by vehicleId, sort by odometer ascending, first row gets 0
	const consumptionMap = new Map<ImportRow, number>()
	const byVehicle = new Map<number, Array<{ row: ImportRow; vehicleId: number }>>()
	for (const entry of fuelEntries) {
		const group = byVehicle.get(entry.vehicleId) || []
		group.push(entry)
		byVehicle.set(entry.vehicleId, group)
	}

	for (const [, group] of byVehicle) {
		group.sort((a, b) => (a.row.data.odometer ?? 0) - (b.row.data.odometer ?? 0))
		let prevOdometer: number | undefined
		for (const entry of group) {
			if (prevOdometer == null) {
				consumptionMap.set(entry.row, 0)
			} else {
				const consumption = calculateConsumption(
					entry.row.data.odometer ?? 0,
					prevOdometer,
					entry.row.data.quantity ?? 0,
					entry.row.data.unit ?? 'L'
				)
				consumptionMap.set(entry.row, consumption)
			}
			prevOdometer = entry.row.data.odometer
		}
	}

	// Step 6: Atomic transaction — commit all fuelLogs + expenses
	const totalRows = fuelEntries.length + maintenanceEntries.length
	let currentProgress = 0

	try {
		await db.transaction('rw', db.fuelLogs, db.expenses, async () => {
			for (const entry of fuelEntries) {
				const newFuelLog: NewFuelLog = {
					vehicleId: entry.vehicleId,
					date: entry.row.data.date!,
					odometer: entry.row.data.odometer!,
					quantity: entry.row.data.quantity!,
					unit: entry.row.data.unit!,
					distanceUnit: entry.row.data.distanceUnit!,
					totalCost: entry.row.data.totalCost ?? 0,
					calculatedConsumption: consumptionMap.get(entry.row) ?? 0,
					notes: entry.row.data.notes || undefined
				}
					// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dexie auto-generates id for auto-increment tables
				await db.fuelLogs.add(newFuelLog as any)
				currentProgress++
				onProgress?.(currentProgress, totalRows)
			}

			for (const entry of maintenanceEntries) {
				const newExpense: NewExpense = {
					vehicleId: entry.vehicleId,
					date: entry.row.data.date!,
					type: entry.row.data.maintenanceType || 'Imported',
					odometer: entry.row.data.odometer || undefined,
					cost: entry.row.data.totalCost ?? 0,
					notes: entry.row.data.notes || undefined
				}
					// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dexie auto-generates id for auto-increment tables
				await db.expenses.add(newExpense as any)
				currentProgress++
				onProgress?.(currentProgress, totalRows)
			}
		})
	} catch (e) {
		return err('IMPORT_FAILED', String(e))
	}

	return ok({
		fuelCount: fuelEntries.length,
		maintenanceCount: maintenanceEntries.length,
		skippedCount,
		vehiclesCreated,
		vehiclesMatched,
		totalImported: fuelEntries.length + maintenanceEntries.length
	})
}
