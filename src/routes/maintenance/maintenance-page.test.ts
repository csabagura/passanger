import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { RESULT_CARD_DISMISS_MS } from '$lib/config';
import MaintenancePage from './+page.svelte';

const mockGetVehicleById = vi.fn();
const mockGetAllVehicles = vi.fn();
const mockGetAllExpenses = vi.fn();
const mockSaveExpense = vi.fn();
const mockUpdateExpense = vi.fn();
const mockDeleteExpense = vi.fn();
const mockGetAllFuelLogs = vi.fn();
const mockUpdateFuelLog = vi.fn();
const mockUpdateFuelLogsAtomic = vi.fn();
const mockDeleteFuelLog = vi.fn();

vi.mock('$lib/db/repositories/vehicles', () => ({
	getVehicleById: (...args: unknown[]) => mockGetVehicleById(...args),
	getAllVehicles: (...args: unknown[]) => mockGetAllVehicles(...args)
}));

vi.mock('$lib/db/repositories/expenses', () => ({
	getAllExpenses: (...args: unknown[]) => mockGetAllExpenses(...args),
	saveExpense: (...args: unknown[]) => mockSaveExpense(...args),
	updateExpense: (...args: unknown[]) => mockUpdateExpense(...args),
	deleteExpense: (...args: unknown[]) => mockDeleteExpense(...args)
}));

vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: (...args: unknown[]) => mockGetAllFuelLogs(...args),
	saveFuelLog: vi.fn(),
	updateFuelLog: (...args: unknown[]) => mockUpdateFuelLog(...args),
	updateFuelLogsAtomic: (...args: unknown[]) => mockUpdateFuelLogsAtomic(...args),
	deleteFuelLog: (...args: unknown[]) => mockDeleteFuelLog(...args)
}));

vi.mock('svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('svelte')>();
	return {
		...actual,
		getContext: (key: string) => {
			if (key === 'settings') {
				return {
					settings: {
						fuelUnit: 'L/100km' as const,
						currency: '€'
					}
				};
			}
			return undefined;
		}
	};
});

const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		}
	};
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

function getEntryCardLabels(): string[] {
	return screen.getAllByRole('group').map((group) => group.getAttribute('aria-label') ?? '');
}

function createFuelEntry(overrides: Record<string, unknown> = {}) {
	return {
		id: 2,
		vehicleId: 7,
		date: new Date(2026, 2, 10, 12, 0, 0, 0),
		odometer: 87400,
		quantity: 42,
		unit: 'L' as const,
		distanceUnit: 'km' as const,
		totalCost: 78,
		calculatedConsumption: 7.2,
		notes: '',
		...overrides
	};
}

function createMaintenanceEntry(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		vehicleId: 7,
		date: new Date(2026, 2, 10, 12, 0, 0, 0),
		type: 'Service',
		cost: 100,
		...overrides
	};
}

async function settlePage() {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

describe('Maintenance page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
		mockGetAllVehicles.mockResolvedValue({ data: [], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });
		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockDeleteExpense.mockResolvedValue({ data: undefined, error: null });
		mockDeleteFuelLog.mockResolvedValue({
			data: { deletedLogId: 0, updatedLogs: [] },
			error: null
		});
	});

	afterEach(() => {
		cleanup();
	});

	it('shows a single CTA to the Fuel Entry vehicle setup flow when no vehicle exists', async () => {
		render(MaintenancePage);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		const cta = screen.getByRole('link', { name: /go to fuel entry/i });
		expect(cta.getAttribute('href')).toBe('/fuel-entry');
		expect(screen.getByText('No vehicle yet')).toBeTruthy();
	});

	it('renders the current vehicle header, create form, and mixed edit entry list when a vehicle is selected', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang', year: 2016 },
			error: null
		});
		mockGetAllExpenses.mockResolvedValue({
			data: [
				{
					id: 1,
					vehicleId: 7,
					date: new Date(2026, 2, 10, 12, 0, 0, 0),
					type: 'Service',
					cost: 100
				}
			],
			error: null
		});
		mockGetAllFuelLogs.mockResolvedValue({
			data: [
				{
					id: 2,
					vehicleId: 7,
					date: new Date(2026, 2, 9, 12, 0, 0, 0),
					odometer: 87400,
					quantity: 42,
					unit: 'L',
					distanceUnit: 'km',
					totalCost: 78,
					calculatedConsumption: 7.2,
					notes: ''
				}
			],
			error: null
		});

		render(MaintenancePage);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		expect(screen.getByRole('heading', { name: 'Old Faithful' })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy();
		expect(screen.getByText('Recent entries')).toBeTruthy();
		expect(screen.getByText('Service')).toBeTruthy();
		expect(screen.getByRole('button', { name: /edit maintenance entry from/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /edit fuel entry from/i })).toBeTruthy();
	});

	it('refreshes the mixed entry list immediately after a successful maintenance save', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllExpenses.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({
			data: [
				{
					id: 9,
					vehicleId: 7,
					date: new Date(2026, 2, 10, 12, 0, 0, 0),
					type: 'Insurance',
					cost: 120
				}
			],
			error: null
		});
		mockSaveExpense.mockResolvedValue({
			data: {
				id: 9,
				vehicleId: 7,
				date: new Date(2026, 2, 10, 12, 0, 0, 0),
				type: 'Insurance',
				cost: 120
			},
			error: null
		});

		render(MaintenancePage);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		await fireEvent.input(screen.getByLabelText(/^type$/i), {
			target: { value: 'Insurance' }
		});
		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '120' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		expect(mockGetAllExpenses).toHaveBeenCalledTimes(2);
		expect(mockGetAllFuelLogs).toHaveBeenCalledTimes(2);
		expect(screen.getByText('Insurance')).toBeTruthy();
	});

	it('can enter and cancel fuel edit mode without leaving the maintenance tab', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllFuelLogs.mockResolvedValue({
			data: [
				{
					id: 2,
					vehicleId: 7,
					date: new Date(2026, 2, 10, 12, 0, 0, 0),
					odometer: 87400,
					quantity: 42,
					unit: 'L',
					distanceUnit: 'km',
					totalCost: 78,
					calculatedConsumption: 7.2,
					notes: ''
				}
			],
			error: null
		});

		render(MaintenancePage);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		await fireEvent.click(screen.getByRole('button', { name: /edit fuel entry from/i }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		expect(screen.getByRole('heading', { name: /editing fuel entry/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /save changes/i })).toBeTruthy();
		expect((screen.getByLabelText(/quantity/i) as HTMLInputElement).value).toBe('42');

		await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		expect(screen.queryByRole('heading', { name: /editing fuel entry/i })).toBeNull();
		expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy();
		expect(mockUpdateFuelLogsAtomic).not.toHaveBeenCalled();
	});

	it('keeps the inline maintenance confirmation visible until it dismisses before returning to create mode', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		const initialExpense = {
			id: 9,
			vehicleId: 7,
			date: new Date(2026, 2, 10, 12, 0, 0, 0),
			type: 'Oil Change',
			cost: 120,
			notes: 'Initial'
		};
		const updatedExpense = {
			...initialExpense,
			cost: 130,
			notes: 'Initial plus filter'
		};

		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllExpenses
			.mockResolvedValueOnce({ data: [initialExpense], error: null })
			.mockResolvedValueOnce({ data: [updatedExpense], error: null });
		mockUpdateExpense.mockResolvedValue({
			data: updatedExpense,
			error: null
		});

		render(MaintenancePage);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		await fireEvent.click(screen.getByRole('button', { name: /edit maintenance entry from/i }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '130' }
		});
		await fireEvent.input(screen.getByLabelText(/notes/i), {
			target: { value: 'Initial plus filter' }
		});

		vi.useFakeTimers();

		try {
			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

			await Promise.resolve();
			await Promise.resolve();
			flushSync();

			expect(mockUpdateExpense).toHaveBeenCalledTimes(1);
			expect(mockGetAllExpenses).toHaveBeenCalledTimes(2);
			expect(screen.getByRole('heading', { name: /editing maintenance entry/i })).toBeTruthy();
			expect(screen.queryByText('Updated Oil Change.')).toBeNull();
			expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
			expect(screen.getByText('€130.00')).toBeTruthy();

			const successCard = screen.getByRole('status');
			expect(successCard.textContent).toContain('Updated Oil Change for €130.00 on Mar 10, 2026.');

			await vi.advanceTimersByTimeAsync(RESULT_CARD_DISMISS_MS - 1);
			flushSync();
			expect(screen.getByRole('heading', { name: /editing maintenance entry/i })).toBeTruthy();
			expect(screen.getByRole('status').textContent).toContain('Updated Oil Change');

			await vi.advanceTimersByTimeAsync(1);
			flushSync();
			expect(screen.queryByRole('heading', { name: /editing maintenance entry/i })).toBeNull();
			expect(screen.queryByRole('status')).toBeNull();
			expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy();
		} finally {
			vi.useRealTimers();
		}
	});

	it('returns a backdated edited entry to true newest-first order after the temporary save pin expires', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		const newerExpense = {
			id: 10,
			vehicleId: 7,
			date: new Date(2026, 2, 10, 12, 0, 0, 0),
			type: 'Insurance',
			cost: 200,
			notes: 'Current month'
		};
		const olderExpense = {
			id: 9,
			vehicleId: 7,
			date: new Date(2026, 2, 8, 12, 0, 0, 0),
			type: 'Oil Change',
			cost: 120,
			notes: 'Older record'
		};
		const updatedOlderExpense = {
			...olderExpense,
			cost: 130,
			notes: 'Updated older record'
		};

		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllExpenses
			.mockResolvedValueOnce({ data: [newerExpense, olderExpense], error: null })
			.mockResolvedValueOnce({ data: [newerExpense, updatedOlderExpense], error: null });
		mockUpdateExpense.mockResolvedValue({
			data: updatedOlderExpense,
			error: null
		});

		render(MaintenancePage);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		expect(getEntryCardLabels()[0]).toContain('Mar 10, 2026');

		await fireEvent.click(
			screen.getAllByRole('button', { name: /edit maintenance entry from/i })[1]
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		vi.useFakeTimers();

		try {
			await fireEvent.input(screen.getByLabelText(/cost/i), {
				target: { value: '130' }
			});
			await fireEvent.input(screen.getByLabelText(/notes/i), {
				target: { value: 'Updated older record' }
			});
			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

			await Promise.resolve();
			await Promise.resolve();
			flushSync();

			expect(getEntryCardLabels()[0]).toContain('Mar 8, 2026');

			await vi.advanceTimersByTimeAsync(RESULT_CARD_DISMISS_MS);
			flushSync();

			expect(getEntryCardLabels()[0]).toContain('Mar 10, 2026');
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps the Story 1.6 inline fuel result card visible on maintenance edits until it fades, even if the refresh reload fails', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		const initialLog = {
			id: 2,
			vehicleId: 7,
			date: new Date(2026, 2, 9, 12, 0, 0, 0),
			odometer: 87400,
			quantity: 42,
			unit: 'L' as const,
			distanceUnit: 'km' as const,
			totalCost: 78,
			calculatedConsumption: 10.5,
			notes: ''
		};
		const successorLog = {
			id: 3,
			vehicleId: 7,
			date: new Date(2026, 2, 10, 12, 0, 0, 0),
			odometer: 87800,
			quantity: 40,
			unit: 'L' as const,
			distanceUnit: 'km' as const,
			totalCost: 76,
			calculatedConsumption: 10,
			notes: ''
		};
		const updatedLog = {
			...initialLog,
			odometer: 87600,
			quantity: 40,
			totalCost: 80,
			calculatedConsumption: 6.6666666667
		};
		const updatedSuccessorLog = {
			...successorLog,
			calculatedConsumption: 20
		};

		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllFuelLogs
			.mockResolvedValueOnce({ data: [successorLog, initialLog], error: null })
			.mockResolvedValueOnce({ data: [successorLog, initialLog], error: null })
			.mockResolvedValueOnce({
				data: null,
				error: { code: 'GET_FAILED', message: 'Refresh failed' }
			});
		mockUpdateFuelLogsAtomic.mockResolvedValue({
			data: [updatedLog, updatedSuccessorLog],
			error: null
		});

		render(MaintenancePage);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		await fireEvent.click(screen.getAllByRole('button', { name: /edit fuel entry from/i })[1]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		vi.useFakeTimers();

		try {
			await fireEvent.input(screen.getByLabelText(/odometer/i), {
				target: { value: '87600' }
			});
			await fireEvent.input(screen.getByLabelText(/quantity/i), {
				target: { value: '40' }
			});
			await fireEvent.input(screen.getByLabelText(/total cost/i), {
				target: { value: '80' }
			});
			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

			await Promise.resolve();
			await Promise.resolve();
			flushSync();

			expect(mockUpdateFuelLogsAtomic).toHaveBeenCalledTimes(1);
			expect(screen.getByRole('heading', { name: /editing fuel entry/i })).toBeTruthy();
			expect(screen.queryByText('Updated fuel entry.')).toBeNull();
			expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
			expect(
				screen.getByRole('group', {
					name: /Fuel entry, Mar 9, 2026, 40 L, €80\.00, 6\.7 L\/100km/i
				})
			).toBeTruthy();
			expect(
				screen.getByRole('group', {
					name: /Fuel entry, Mar 10, 2026, 40 L, €76\.00, 20\.0 L\/100km/i
				})
			).toBeTruthy();
			expect(screen.getByText(/could not load saved entries/i)).toBeTruthy();

			const successCard = screen.getByRole('status');
			expect(successCard.textContent).toContain('Updated');
			expect(successCard.textContent).toContain('6.7 L/100km');
			expect(successCard.textContent).toContain('€80.00');
			expect(successCard.textContent).toContain('40.0 L');
			expect(successCard.getAttribute('style')).toContain('opacity: 1');

			await vi.advanceTimersByTimeAsync(2999);
			flushSync();
			expect(screen.getByRole('heading', { name: /editing fuel entry/i })).toBeTruthy();
			expect(screen.getByRole('status').getAttribute('style')).toContain('opacity: 1');

			await vi.advanceTimersByTimeAsync(1);
			flushSync();
			expect(screen.getByRole('heading', { name: /editing fuel entry/i })).toBeTruthy();
			expect(screen.getByRole('status').getAttribute('style')).toContain('opacity: 0');

			await vi.advanceTimersByTimeAsync(150);
			flushSync();
			expect(screen.queryByRole('heading', { name: /editing fuel entry/i })).toBeNull();
			expect(screen.queryByRole('status')).toBeNull();
			expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy();
		} finally {
			vi.useRealTimers();
		}
	});

	it('can arm and cancel maintenance deletion without mutating the repository', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		const maintenanceEntry = createMaintenanceEntry({ id: 9, type: 'Insurance', cost: 120 });

		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllExpenses.mockResolvedValue({ data: [maintenanceEntry], error: null });

		render(MaintenancePage);
		await settlePage();

		await fireEvent.click(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		);
		expect(screen.getByText('Delete this entry? This cannot be undone.')).toBeTruthy();

		await fireEvent.click(
			screen.getByRole('button', { name: /cancel deleting maintenance entry from Mar 10, 2026/i })
		);

		expect(mockDeleteExpense).not.toHaveBeenCalled();
		expect(screen.queryByText('Delete this entry? This cannot be undone.')).toBeNull();
		expect(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		).toBeTruthy();
	});

	it('deletes a maintenance entry from the mixed list without leaving the maintenance tab', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		const maintenanceEntry = createMaintenanceEntry({ id: 9, type: 'Insurance', cost: 120 });

		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllExpenses
			.mockResolvedValueOnce({ data: [maintenanceEntry], error: null })
			.mockResolvedValueOnce({ data: [], error: null });

		render(MaintenancePage);
		await settlePage();

		await fireEvent.click(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		);
		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete maintenance entry from Mar 10, 2026/i })
		);
		await settlePage();

		expect(mockDeleteExpense).toHaveBeenCalledWith(maintenanceEntry.id);
		expect(screen.queryByText('Insurance')).toBeNull();
		expect(screen.getByRole('heading', { name: /recent entries/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy();
	});

	it('can arm and cancel fuel deletion without mutating the repository', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		const fuelEntry = createFuelEntry({ id: 2 });

		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllFuelLogs.mockResolvedValue({ data: [fuelEntry], error: null });

		render(MaintenancePage);
		await settlePage();

		await fireEvent.click(
			screen.getByRole('button', { name: /delete fuel entry from Mar 10, 2026/i })
		);
		expect(screen.getByText('Delete this entry? This cannot be undone.')).toBeTruthy();

		await fireEvent.click(
			screen.getByRole('button', { name: /cancel deleting fuel entry from Mar 10, 2026/i })
		);

		expect(mockDeleteFuelLog).not.toHaveBeenCalled();
		expect(screen.queryByText('Delete this entry? This cannot be undone.')).toBeNull();
		expect(
			screen.getByRole('button', { name: /delete fuel entry from Mar 10, 2026/i })
		).toBeTruthy();
	});

	it('updates the visible successor card immediately after deleting a middle fuel log', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		const firstLog = createFuelEntry({
			id: 1,
			date: new Date(2026, 2, 8, 12, 0, 0, 0),
			odometer: 100,
			quantity: 10,
			totalCost: 20,
			calculatedConsumption: 0
		});
		const deletedLog = createFuelEntry({
			id: 2,
			date: new Date(2026, 2, 9, 12, 0, 0, 0),
			odometer: 200,
			quantity: 10,
			totalCost: 20,
			calculatedConsumption: 10
		});
		const successorLog = createFuelEntry({
			id: 3,
			date: new Date(2026, 2, 10, 12, 0, 0, 0),
			odometer: 300,
			quantity: 10,
			totalCost: 20,
			calculatedConsumption: 10
		});
		const updatedSuccessorLog = { ...successorLog, calculatedConsumption: 5 };

		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllFuelLogs
			.mockResolvedValueOnce({ data: [successorLog, deletedLog, firstLog], error: null })
			.mockResolvedValueOnce({
				data: null,
				error: { code: 'GET_FAILED', message: 'Refresh failed' }
			});
		mockDeleteFuelLog.mockResolvedValue({
			data: {
				deletedLogId: deletedLog.id,
				updatedLogs: [updatedSuccessorLog]
			},
			error: null
		});

		render(MaintenancePage);
		await settlePage();

		await fireEvent.click(
			screen.getByRole('button', { name: /delete fuel entry from Mar 9, 2026/i })
		);
		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete fuel entry from Mar 9, 2026/i })
		);
		await settlePage();

		expect(mockDeleteFuelLog).toHaveBeenCalledWith(deletedLog.id);
		expect(
			screen.queryByRole('group', {
				name: /Fuel entry, Mar 9, 2026, 10 L, €20\.00, 10\.0 L\/100km/i
			})
		).toBeNull();
		expect(
			screen.getByRole('group', {
				name: /Fuel entry, Mar 10, 2026, 10 L, €20\.00, 5\.0 L\/100km/i
			})
		).toBeTruthy();
		expect(screen.getByText(/could not load saved entries/i)).toBeTruthy();
	});

	it('refreshes the open fuel edit timeline after deleting a different fuel log', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		const firstLog = createFuelEntry({
			id: 1,
			date: new Date(2026, 2, 8, 12, 0, 0, 0),
			odometer: 100,
			quantity: 10,
			totalCost: 20,
			calculatedConsumption: 0
		});
		const deletedLog = createFuelEntry({
			id: 2,
			date: new Date(2026, 2, 9, 12, 0, 0, 0),
			odometer: 200,
			quantity: 10,
			totalCost: 20,
			calculatedConsumption: 10
		});
		const editedLog = createFuelEntry({
			id: 3,
			date: new Date(2026, 2, 10, 12, 0, 0, 0),
			odometer: 300,
			quantity: 10,
			totalCost: 20,
			calculatedConsumption: 10
		});
		const refreshedEditedLog = { ...editedLog, calculatedConsumption: 5 };
		const savedEditedLog = {
			...refreshedEditedLog,
			odometer: 150,
			calculatedConsumption: 20
		};
		let currentFuelLogs = [editedLog, deletedLog, firstLog];

		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllFuelLogs.mockImplementation(async () => ({
			data: [...currentFuelLogs],
			error: null
		}));
		mockDeleteFuelLog.mockImplementation(async (id: number) => {
			expect(id).toBe(deletedLog.id);
			currentFuelLogs = [refreshedEditedLog, firstLog];
			return {
				data: {
					deletedLogId: deletedLog.id,
					updatedLogs: [refreshedEditedLog]
				},
				error: null
			};
		});
		mockUpdateFuelLogsAtomic.mockImplementation(async () => {
			currentFuelLogs = [savedEditedLog, firstLog];
			return {
				data: [savedEditedLog],
				error: null
			};
		});

		render(MaintenancePage);
		await settlePage();

		await fireEvent.click(
			screen.getByRole('button', { name: /edit fuel entry from Mar 10, 2026/i })
		);
		await settlePage();

		expect(screen.getByText('Last: 200 km')).toBeTruthy();

		await fireEvent.click(
			screen.getByRole('button', { name: /delete fuel entry from Mar 9, 2026/i })
		);
		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete fuel entry from Mar 9, 2026/i })
		);
		await settlePage();

		expect(screen.getByText('Last: 100 km')).toBeTruthy();

		await fireEvent.input(screen.getByLabelText(/odometer/i), {
			target: { value: '150' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
		await settlePage();

		expect(mockUpdateFuelLogsAtomic).toHaveBeenCalledTimes(1);
		expect(screen.queryByText(/higher than the last logged value/i)).toBeNull();
	});

	it('exits edit mode cleanly when the currently edited entry is deleted', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		const maintenanceEntry = createMaintenanceEntry({ id: 9, type: 'Oil Change', cost: 120 });

		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllExpenses
			.mockResolvedValueOnce({ data: [maintenanceEntry], error: null })
			.mockResolvedValueOnce({ data: [], error: null });

		render(MaintenancePage);
		await settlePage();

		await fireEvent.click(
			screen.getByRole('button', { name: /edit maintenance entry from Mar 10, 2026/i })
		);
		await settlePage();
		expect(screen.getByRole('heading', { name: /editing maintenance entry/i })).toBeTruthy();

		await fireEvent.click(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		);
		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete maintenance entry from Mar 10, 2026/i })
		);
		await settlePage();

		expect(screen.queryByRole('heading', { name: /editing maintenance entry/i })).toBeNull();
		expect(screen.queryByText('Oil Change')).toBeNull();
		expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy();
	});

	it('moves focus to the next entry card after a successful delete', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		const newerEntry = createMaintenanceEntry({ id: 9, type: 'Insurance', cost: 120 });
		const olderEntry = createMaintenanceEntry({
			id: 8,
			date: new Date(2026, 2, 9, 12, 0, 0, 0),
			type: 'Tyres',
			cost: 250
		});
		let currentExpenses = [newerEntry, olderEntry];

		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllExpenses.mockImplementation(async () => ({
			data: [...currentExpenses],
			error: null
		}));
		mockDeleteExpense.mockImplementation(async (id: number) => {
			currentExpenses = currentExpenses.filter((entry) => entry.id !== id);
			return { data: undefined, error: null };
		});

		render(MaintenancePage);
		await settlePage();

		await fireEvent.click(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		);
		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete maintenance entry from Mar 10, 2026/i })
		);
		await settlePage();

		const remainingCard = screen.getByRole('group', {
			name: /maintenance entry, Mar 9, 2026, Tyres, €250\.00/i
		});
		expect(document.activeElement).toBe(remainingCard);
	});

	it('moves focus to the empty-state target when deleting the last remaining entry', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		const maintenanceEntry = createMaintenanceEntry({ id: 9, type: 'Insurance', cost: 120 });
		let currentExpenses = [maintenanceEntry];

		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllExpenses.mockImplementation(async () => ({
			data: [...currentExpenses],
			error: null
		}));
		mockDeleteExpense.mockImplementation(async (id: number) => {
			currentExpenses = currentExpenses.filter((entry) => entry.id !== id);
			return { data: undefined, error: null };
		});

		render(MaintenancePage);
		await settlePage();

		await fireEvent.click(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		);
		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete maintenance entry from Mar 10, 2026/i })
		);
		await settlePage();

		const emptyState = screen.getByRole('group', { name: /no saved entries yet/i });
		expect(document.activeElement).toBe(emptyState);
	});

	it('keeps the entry visible and announces a delete failure accessibly', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		const maintenanceEntry = createMaintenanceEntry({ id: 9, type: 'Insurance', cost: 120 });

		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
			error: null
		});
		mockGetAllExpenses.mockResolvedValue({ data: [maintenanceEntry], error: null });
		mockDeleteExpense.mockResolvedValue({
			data: null,
			error: { code: 'NOT_FOUND', message: 'Expense 9 not found' }
		});

		render(MaintenancePage);
		await settlePage();

		await fireEvent.click(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		);
		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete maintenance entry from Mar 10, 2026/i })
		);
		await settlePage();

		expect(screen.getByText('Insurance')).toBeTruthy();
		expect(screen.getByRole('alert').textContent).toContain(
			'Could not delete maintenance entry. Please try again.'
		);
		expect(
			screen.getByRole('button', { name: /confirm delete maintenance entry from Mar 10, 2026/i })
		).toBeTruthy();
		expect(
			screen.getByRole('button', { name: /cancel deleting maintenance entry from Mar 10, 2026/i })
		).toBeTruthy();
	});

	it('disables Edit buttons on other cards while an edit form is already open', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		mockGetVehicleById.mockResolvedValue({
			data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang', year: 2016 },
			error: null
		});
		mockGetAllFuelLogs.mockResolvedValue({
			data: [createFuelEntry({ id: 2, date: new Date(2026, 2, 10, 12, 0, 0, 0) })],
			error: null
		});
		mockGetAllExpenses.mockResolvedValue({
			data: [createMaintenanceEntry({ id: 1, date: new Date(2026, 2, 9, 12, 0, 0, 0) })],
			error: null
		});

		render(MaintenancePage);
		await settlePage();

		// Click Edit on the fuel entry to open the edit form
		await fireEvent.click(
			screen.getByRole('button', { name: /edit fuel entry from Mar 10, 2026/i })
		);
		flushSync();
		expect(screen.getByRole('heading', { name: /editing fuel entry/i })).toBeTruthy();

		// The Edit button on the maintenance card should be disabled
		const maintEditButton = screen.getByRole('button', {
			name: /edit maintenance entry from Mar 9, 2026/i
		}) as HTMLButtonElement;
		expect(maintEditButton.disabled).toBe(true);
	});

	it('recovers from a stale persisted vehicle id before showing the empty-state CTA', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '999');
		mockGetVehicleById.mockResolvedValue({
			data: null,
			error: { code: 'NOT_FOUND', message: 'Missing vehicle' }
		});
		mockGetAllVehicles.mockResolvedValue({
			data: [{ id: 7, name: 'Recovered Car', make: 'Ford', model: 'Fiesta', year: 2014 }],
			error: null
		});

		render(MaintenancePage);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();

		expect(mockGetVehicleById).toHaveBeenCalledWith(999);
		expect(mockGetAllVehicles).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('heading', { name: 'Recovered Car' })).toBeTruthy();
		expect(localStorageMock.getItem('passanger_vehicle_id')).toBe('7');
	});
});
