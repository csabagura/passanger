import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte'
import ImportStepVehicles from './ImportStepVehicles.svelte'
import type { ImportRow, VehicleAssignment } from '$lib/utils/importTypes'
import type { VehiclesContext } from '$lib/utils/vehicleContext'
import type { Vehicle } from '$lib/db/schema'

const testVehicle1: Vehicle = { id: 1, name: 'My Honda', make: 'Honda', model: 'Civic', year: 2020 }
const testVehicle2: Vehicle = { id: 2, name: 'Work Truck', make: 'Ford', model: 'F-150', year: 2022 }

function makeContext(vehicles: Vehicle[] = [testVehicle1]): VehiclesContext {
	return {
		get vehicles() {
			return vehicles
		},
		get activeVehicle() {
			return vehicles[0] ?? null
		},
		get activeVehicleId() {
			return vehicles[0]?.id ?? null
		},
		get loaded() {
			return true
		},
		switchVehicle: vi.fn(),
		refreshVehicles: vi.fn().mockResolvedValue(undefined)
	}
}

function makeFuelRow(
	rowNumber: number,
	sourceVehicleName = 'TestCar',
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
			sourceVehicleName
		},
		issues: []
	}
}

function renderStep(
	rows: ImportRow[],
	ctx: VehiclesContext = makeContext(),
	onVehiclesAssigned: (data: { assignments: VehicleAssignment[] }) => void = vi.fn()
) {
	const contextMap = new Map<string, unknown>()
	contextMap.set('vehicles', ctx)
	return render(ImportStepVehicles, {
		props: {
			rows,
			onVehiclesAssigned
		},
		context: contextMap
	})
}

describe('ImportStepVehicles', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		cleanup()
	})

	it('groups rows by sourceVehicleName and shows one card per group', () => {
		const rows = [makeFuelRow(1, 'Car A'), makeFuelRow(2, 'Car A'), makeFuelRow(3, 'Car B')]
		renderStep(rows, makeContext([testVehicle1, testVehicle2]))

		expect(screen.getByText(/"Car A"/)).toBeTruthy()
		expect(screen.getByText(/"Car B"/)).toBeTruthy()
	})

	it('shows row count per vehicle group', () => {
		const rows = [makeFuelRow(1, 'Car A'), makeFuelRow(2, 'Car A'), makeFuelRow(3, 'Car B')]
		renderStep(rows, makeContext([testVehicle1, testVehicle2]))

		expect(screen.getByText('2 rows')).toBeTruthy()
		expect(screen.getByText('1 row')).toBeTruthy()
	})

	it('auto-match: 1 group + 1 existing vehicle = auto-assigned with confirmation', async () => {
		const rows = [makeFuelRow(1, 'TestCar')]
		renderStep(rows)

		await waitFor(() => {
			expect(screen.getByText(/we'll add these rows to/i)).toBeTruthy()
		})

		// "My Honda" appears in confirmation message (bold) and dropdown option
		const confirmBox = screen.getByText(/we'll add these rows to/i).closest('div')
		expect(confirmBox?.textContent).toContain('My Honda')
	})

	it('dropdown shows existing vehicles for matching', () => {
		const rows = [makeFuelRow(1, 'Car A'), makeFuelRow(2, 'Car B')]
		renderStep(rows, makeContext([testVehicle1, testVehicle2]))

		const selects = screen.getAllByRole('combobox')
		expect(selects.length).toBeGreaterThanOrEqual(2)
	})

	it('Create new vehicle expands inline form', async () => {
		const rows = [makeFuelRow(1, 'TestCar')]
		renderStep(rows, makeContext([testVehicle1]))

		// Select "Create new vehicle"
		const select = screen.getByLabelText(/assign testcar/i)
		await fireEvent.change(select, { target: { value: '__new__' } })

		// Inline form should appear
		expect(screen.getByLabelText(/^name$/i)).toBeTruthy()
		expect(screen.getByLabelText(/^make$/i)).toBeTruthy()
		expect(screen.getByLabelText(/^model$/i)).toBeTruthy()
		expect(screen.getByLabelText(/year/i)).toBeTruthy()
	})

	it('inline form pre-fills Name from sourceVehicleName', async () => {
		const rows = [makeFuelRow(1, 'My Toyota')]
		renderStep(rows, makeContext([testVehicle1]))

		const select = screen.getByLabelText(/assign my toyota/i)
		await fireEvent.change(select, { target: { value: '__new__' } })

		const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement
		expect(nameInput.value).toBe('My Toyota')
	})

	it('inline form validates required fields (name, make, model)', async () => {
		const onAssigned = vi.fn()
		const rows = [makeFuelRow(1, 'TestCar')]
		renderStep(rows, makeContext([testVehicle1]), onAssigned)

		const select = screen.getByLabelText(/assign testcar/i)
		await fireEvent.change(select, { target: { value: '__new__' } })

		// Clear name field
		const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement
		await fireEvent.input(nameInput, { target: { value: '' } })

		// Try to submit — should show error for missing make/model at minimum
		const reviewBtn = screen.getByTestId('review-import-btn')
		await fireEvent.click(reviewBtn)

		expect(onAssigned).not.toHaveBeenCalled()
	})

	it('MAX_VEHICLES enforcement shows error when limit exceeded', async () => {
		// Create context with MAX_VEHICLES existing vehicles
		const vehicles = Array.from({ length: 5 }, (_, i) => ({
			id: i + 1,
			name: `Car ${i + 1}`,
			make: 'Test',
			model: 'Model',
			year: 2020
		}))
		const rows = [makeFuelRow(1, 'New Car')]
		renderStep(rows, makeContext(vehicles))

		const select = screen.getByLabelText(/assign new car/i)
		await fireEvent.change(select, { target: { value: '__new__' } })

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeTruthy()
			expect(screen.getByText(/already have 5 vehicles/i)).toBeTruthy()
		})
	})

	it('Review & Import disabled until all groups assigned', () => {
		const rows = [makeFuelRow(1, 'Car A'), makeFuelRow(2, 'Car B')]
		renderStep(rows, makeContext([testVehicle1, testVehicle2]))

		const reviewBtn = screen.getByTestId('review-import-btn')
		expect(reviewBtn.hasAttribute('disabled')).toBe(true)
	})

	it('Review & Import enabled when all groups assigned', async () => {
		const rows = [makeFuelRow(1, 'TestCar')]
		renderStep(rows)

		// Wait for auto-match
		await waitFor(() => {
			const reviewBtn = screen.getByTestId('review-import-btn')
			expect(reviewBtn.hasAttribute('disabled')).toBe(false)
		})
	})

	it('calls onVehiclesAssigned with correct assignments', async () => {
		const onAssigned = vi.fn()
		const rows = [makeFuelRow(1, 'TestCar')]
		renderStep(rows, makeContext([testVehicle1]), onAssigned)

		// Wait for auto-match
		await waitFor(() => {
			const reviewBtn = screen.getByTestId('review-import-btn')
			expect(reviewBtn.hasAttribute('disabled')).toBe(false)
		})

		await fireEvent.click(screen.getByTestId('review-import-btn'))

		expect(onAssigned).toHaveBeenCalledWith({
			assignments: [
				expect.objectContaining({
					sourceVehicleName: 'TestCar',
					assignmentType: 'existing',
					existingVehicleId: 1
				})
			]
		})
	})

	it('multiple vehicle groups: each assigned independently', async () => {
		const onAssigned = vi.fn()
		const rows = [makeFuelRow(1, 'Car A'), makeFuelRow(2, 'Car B')]
		renderStep(rows, makeContext([testVehicle1, testVehicle2]), onAssigned)

		// Assign Car A to My Honda
		const selects = screen.getAllByRole('combobox')
		await fireEvent.change(selects[0], { target: { value: '1' } })
		// Assign Car B to Work Truck
		await fireEvent.change(selects[1], { target: { value: '2' } })

		await waitFor(() => {
			const reviewBtn = screen.getByTestId('review-import-btn')
			expect(reviewBtn.hasAttribute('disabled')).toBe(false)
		})

		await fireEvent.click(screen.getByTestId('review-import-btn'))

		expect(onAssigned).toHaveBeenCalledWith({
			assignments: expect.arrayContaining([
				expect.objectContaining({ sourceVehicleName: 'Car A', existingVehicleId: 1 }),
				expect.objectContaining({ sourceVehicleName: 'Car B', existingVehicleId: 2 })
			])
		})
	})

	it('changing assignment from existing to new vehicle works', async () => {
		const rows = [makeFuelRow(1, 'TestCar')]
		renderStep(rows)

		// Wait for auto-match
		await waitFor(() => {
			expect(screen.getByText(/we'll add these rows to/i)).toBeTruthy()
		})

		// Change to "Create new vehicle"
		const select = screen.getByLabelText(/assign testcar/i)
		await fireEvent.change(select, { target: { value: '__new__' } })

		// Should now show inline form
		expect(screen.getByLabelText(/^name$/i)).toBeTruthy()
	})

	it('changing assignment from new to existing vehicle works', async () => {
		const rows = [makeFuelRow(1, 'TestCar')]
		renderStep(rows, makeContext([testVehicle1]))

		// Select "Create new vehicle" first
		const select = screen.getByLabelText(/assign testcar/i)
		await fireEvent.change(select, { target: { value: '__new__' } })
		expect(screen.getByLabelText(/^name$/i)).toBeTruthy()

		// Change back to existing
		await fireEvent.change(select, { target: { value: '1' } })
		expect(screen.queryByLabelText(/^name$/i)).toBeNull()
	})

	it('year field validation (1900–current year)', async () => {
		const onAssigned = vi.fn()
		const rows = [makeFuelRow(1, 'TestCar')]
		renderStep(rows, makeContext([testVehicle1]), onAssigned)

		const select = screen.getByLabelText(/assign testcar/i)
		await fireEvent.change(select, { target: { value: '__new__' } })

		// Fill in required fields
		const makeInput = screen.getByLabelText(/^make$/i)
		const modelInput = screen.getByLabelText(/^model$/i)
		await fireEvent.input(makeInput, { target: { value: 'Toyota' } })
		await fireEvent.input(modelInput, { target: { value: 'Camry' } })

		// Enter invalid year
		const yearInput = screen.getByLabelText(/year/i)
		await fireEvent.input(yearInput, { target: { value: '1800' } })

		// Click Review & Import
		await fireEvent.click(screen.getByTestId('review-import-btn'))

		// Should show validation error
		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeTruthy()
		})
		expect(onAssigned).not.toHaveBeenCalled()
	})

	it('ARIA: dropdown has correct label', () => {
		const rows = [makeFuelRow(1, 'TestCar')]
		renderStep(rows)

		const select = screen.getByLabelText(/assign testcar to a passanger vehicle/i)
		expect(select).toBeTruthy()
	})

	it('ARIA: MAX_VEHICLES error uses role="alert"', async () => {
		const vehicles = Array.from({ length: 5 }, (_, i) => ({
			id: i + 1,
			name: `Car ${i + 1}`,
			make: 'Test',
			model: 'Model',
			year: 2020
		}))
		const rows = [makeFuelRow(1, 'New Car')]
		renderStep(rows, makeContext(vehicles))

		const select = screen.getByLabelText(/assign new car/i)
		await fireEvent.change(select, { target: { value: '__new__' } })

		await waitFor(() => {
			const alert = screen.getByRole('alert')
			expect(alert).toBeTruthy()
		})
	})

	it('single group with no existing vehicles: shows create form directly', async () => {
		const rows = [makeFuelRow(1, 'TestCar')]
		renderStep(rows, makeContext([]))

		// Only option besides "Select vehicle..." should be "Create new vehicle"
		const select = screen.getByLabelText(/assign testcar/i)
		const options = select.querySelectorAll('option')
		// Should have: "Select vehicle...", "Create new vehicle"
		expect(options.length).toBe(2)
	})
})
