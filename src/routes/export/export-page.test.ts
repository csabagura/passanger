import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ExportPage from './+page.svelte';

const mockGetVehicleById = vi.fn();
const mockGetAllVehicles = vi.fn();
const mockGetAllFuelLogs = vi.fn();
const mockGetAllExpenses = vi.fn();
const mockBuildHistoryExportCSV = vi.fn();
const mockBuildHistoryExportCSVWithVehicles = vi.fn();
const mockBuildCSVFilename = vi.fn();
const mockDownloadCSV = vi.fn();

vi.mock('$lib/db/repositories/vehicles', () => ({
	getVehicleById: (...args: unknown[]) => mockGetVehicleById(...args),
	getAllVehicles: (...args: unknown[]) => mockGetAllVehicles(...args)
}));

vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: (...args: unknown[]) => mockGetAllFuelLogs(...args)
}));

vi.mock('$lib/db/repositories/expenses', () => ({
	getAllExpenses: (...args: unknown[]) => mockGetAllExpenses(...args)
}));

vi.mock('$lib/utils/csv', () => ({
	buildHistoryExportCSV: (...args: unknown[]) => mockBuildHistoryExportCSV(...args),
	buildHistoryExportCSVWithVehicles: (...args: unknown[]) =>
		mockBuildHistoryExportCSVWithVehicles(...args),
	buildCSVFilename: (...args: unknown[]) => mockBuildCSVFilename(...args),
	downloadCSV: (...args: unknown[]) => mockDownloadCSV(...args)
}));

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

function renderPage() {
	return render(ExportPage);
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

async function settlePage() {
	await waitFor(
		() => {
			expect(screen.queryByText('Checking your saved history on this device.')).toBeNull();
		},
		{ timeout: 2000 }
	);
}

const testVehicle = { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang', year: 2016 };
const testVehicle2 = { id: 12, name: 'City Runner', make: 'Toyota', model: 'Corolla', year: 2020 };
const testFuelEntry = {
	id: 2,
	vehicleId: 7,
	date: new Date(2026, 2, 10, 12, 0, 0, 0),
	odometer: 87400,
	quantity: 42,
	unit: 'L' as const,
	distanceUnit: 'km' as const,
	totalCost: 78,
	calculatedConsumption: 7.2,
	notes: 'Top off'
};
const testExpense = {
	id: 5,
	vehicleId: 7,
	date: new Date(2026, 2, 12, 12, 0, 0, 0),
	type: 'Oil Change',
	cost: 120,
	notes: 'Filter too'
};
const testFuelEntry2 = {
	id: 10,
	vehicleId: 12,
	date: new Date(2026, 2, 14, 12, 0, 0, 0),
	odometer: 34000,
	quantity: 35,
	unit: 'L' as const,
	distanceUnit: 'km' as const,
	totalCost: 60,
	calculatedConsumption: 6.5,
	notes: ''
};

describe('Export page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();

		mockGetVehicleById.mockResolvedValue({
			data: null,
			error: { code: 'NOT_FOUND', message: 'Vehicle not found' }
		});
		mockGetAllVehicles.mockResolvedValue({ data: [], error: null });
		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });
		mockBuildHistoryExportCSV.mockReturnValue('mock-csv-content');
		mockBuildHistoryExportCSVWithVehicles.mockReturnValue('mock-csv-content-with-vehicles');
		mockBuildCSVFilename.mockReturnValue('passanger-export-2026-03-12.csv');
		mockDownloadCSV.mockImplementation(() => undefined);
	});

	afterEach(() => {
		cleanup();
	});

	it('shows the primary export action immediately while local data is still resolving', async () => {
		const deferredVehicleRecovery = createDeferred<{
			data: Array<typeof testVehicle>;
			error: null;
		}>();

		mockGetAllVehicles.mockImplementation(() => deferredVehicleRecovery.promise);

		renderPage();

		const exportButton = screen.getByRole('button', { name: 'Export CSV' });
		expect(exportButton).toBeTruthy();
		expect(exportButton.hasAttribute('disabled')).toBe(true);
		expect(screen.getByText('Checking your saved history on this device.')).toBeTruthy();
		expect(screen.queryByText('Nothing to export yet - log your first fill-up!')).toBeNull();

		deferredVehicleRecovery.resolve({ data: [testVehicle], error: null });
		await settlePage();
	});

	it('recovers the current vehicle, loads entry summary state, and persists the recovered vehicle id', async () => {
		mockGetAllVehicles.mockResolvedValue({
			data: [testVehicle],
			error: null
		});
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		renderPage();
		expect(screen.queryByText('Preparing your export...')).toBeNull();
		await settlePage();

		const exportButton = screen.getByRole('button', { name: 'Export CSV' });
		expect(screen.getByText(/Old Faithful · Ford/)).toBeTruthy();
		expect(screen.getByText(/2 entries ready/)).toBeTruthy();
		expect(screen.getByText(/Date range:/)).toBeTruthy();
		expect(exportButton).toBeTruthy();
		expect(exportButton.className).not.toContain('w-full');
		expect(localStorageMock.getItem('passanger_vehicle_id')).toBe('7');
	});

	it('recovers from a stale stored vehicle id by clearing it and persisting the first available vehicle', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '99');
		mockGetAllVehicles.mockResolvedValue({
			data: [testVehicle],
			error: null
		});
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		renderPage();
		await settlePage();

		expect(mockGetVehicleById).toHaveBeenCalledWith(99);
		expect(mockGetAllVehicles).toHaveBeenCalled();
		expect(screen.getByText(/Old Faithful · Ford/)).toBeTruthy();
		expect(localStorageMock.getItem('passanger_vehicle_id')).toBe('7');
	});

	it('shows the load error and preserves the stored vehicle id when getVehicleById fails transiently', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		mockGetVehicleById.mockResolvedValue({
			data: null,
			error: { code: 'GET_FAILED', message: 'IndexedDB unavailable' }
		});

		renderPage();
		await settlePage();

		expect(mockGetVehicleById).toHaveBeenCalledWith(7);
		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByText('Could not prepare your export. Please try again.')).toBeTruthy();
		expect(localStorageMock.getItem('passanger_vehicle_id')).toBe('7');
	});

	it('re-fetches repositories on export, merges mixed entries, and hands them to the csv helper', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		mockGetVehicleById.mockResolvedValue({
			data: testVehicle,
			error: null
		});
		mockGetAllVehicles.mockResolvedValue({ data: [testVehicle], error: null });
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		renderPage();
		await settlePage();

		await fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

		await waitFor(() => {
			expect(mockBuildHistoryExportCSV).toHaveBeenCalledTimes(1);
		});

		const mergedEntries = mockBuildHistoryExportCSV.mock.calls[0][0] as Array<{
			kind: string;
			entry: { id: number };
		}>;
		expect(mergedEntries.map((entry) => `${entry.kind}-${entry.entry.id}`)).toEqual([
			'maintenance-5',
			'fuel-2'
		]);
		expect(mockDownloadCSV).toHaveBeenCalledWith(
			'mock-csv-content',
			'passanger-export-2026-03-12.csv'
		);
	});

	it('shows the empty state with a Log CTA when there are no saved entries', async () => {
		renderPage();
		await settlePage();

		expect(screen.getByText('Nothing to export yet - log your first fill-up!')).toBeTruthy();
		const link = screen.getByRole('link', { name: 'Go to Log' });
		expect(link.getAttribute('href')).toBe('/log');
		expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
	});

	it('shows the empty state for a returning user when the current vehicle loads but both repositories are empty', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		mockGetVehicleById.mockResolvedValue({
			data: testVehicle,
			error: null
		});
		mockGetAllVehicles.mockResolvedValue({ data: [testVehicle], error: null });

		renderPage();
		await settlePage();

		expect(screen.getByText(/Old Faithful · Ford/)).toBeTruthy();
		expect(screen.getByText('Nothing to export yet - log your first fill-up!')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Go to Log' }).getAttribute('href')).toBe('/log');
		expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
	});

	it('renders an accessible error instead of the empty state when repository loading fails', async () => {
		mockGetAllVehicles.mockResolvedValue({
			data: null,
			error: { code: 'GET_FAILED', message: 'IndexedDB unavailable' }
		});

		renderPage();
		await settlePage();

		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByText('Could not prepare your export. Please try again.')).toBeTruthy();
		expect(screen.queryByText('Nothing to export yet - log your first fill-up!')).toBeNull();
	});

	it('switches the button to an in-flight state and prevents duplicate exports while the first export is pending', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		mockGetVehicleById.mockResolvedValue({
			data: testVehicle,
			error: null
		});
		mockGetAllVehicles.mockResolvedValue({ data: [testVehicle], error: null });

		const deferredFuelExport = createDeferred<{
			data: Array<typeof testFuelEntry>;
			error: null;
		}>();
		const deferredExpenseExport = createDeferred<{
			data: Array<typeof testExpense>;
			error: null;
		}>();

		mockGetAllFuelLogs
			.mockResolvedValueOnce({ data: [testFuelEntry], error: null })
			.mockImplementationOnce(() => deferredFuelExport.promise);
		mockGetAllExpenses
			.mockResolvedValueOnce({ data: [testExpense], error: null })
			.mockImplementationOnce(() => deferredExpenseExport.promise);

		renderPage();
		await settlePage();

		await fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Exporting...' })).toBeTruthy();
		});

		const exportingButton = screen.getByRole('button', { name: 'Exporting...' });
		expect(exportingButton.hasAttribute('disabled')).toBe(true);

		await fireEvent.click(exportingButton);

		expect(mockBuildHistoryExportCSV).not.toHaveBeenCalled();

		deferredFuelExport.resolve({ data: [testFuelEntry], error: null });
		deferredExpenseExport.resolve({ data: [testExpense], error: null });

		await waitFor(() => {
			expect(mockBuildHistoryExportCSV).toHaveBeenCalledTimes(1);
		});
	});

	it('shows an inline error and skips download when export-time repository loading fails', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		mockGetVehicleById.mockResolvedValue({
			data: testVehicle,
			error: null
		});
		mockGetAllVehicles.mockResolvedValue({ data: [testVehicle], error: null });
		mockGetAllFuelLogs
			.mockResolvedValueOnce({ data: [testFuelEntry], error: null })
			.mockResolvedValueOnce({
				data: null,
				error: { code: 'GET_FAILED', message: 'IndexedDB unavailable' }
			});
		mockGetAllExpenses
			.mockResolvedValueOnce({ data: [testExpense], error: null })
			.mockResolvedValueOnce({ data: [testExpense], error: null });

		renderPage();
		await settlePage();

		await fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeTruthy();
		});

		expect(screen.getByText('Could not export your data. Please try again.')).toBeTruthy();
		expect(mockBuildHistoryExportCSV).not.toHaveBeenCalled();
		expect(mockDownloadCSV).not.toHaveBeenCalled();
	});

	describe('scope selector (multi-vehicle)', () => {
		it('shows scope selector when user has multiple vehicles', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({ data: testVehicle, error: null });
			mockGetAllVehicles.mockResolvedValue({
				data: [testVehicle, testVehicle2],
				error: null
			});
			mockGetAllFuelLogs.mockResolvedValue({
				data: [testFuelEntry, testFuelEntry2],
				error: null
			});
			mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

			renderPage();
			await settlePage();

			expect(screen.getByRole('radiogroup', { name: /Export scope/i })).toBeTruthy();
			expect(screen.getByRole('radio', { name: /Current vehicle/i })).toBeTruthy();
			expect(screen.getByRole('radio', { name: /All vehicles/i })).toBeTruthy();
		});

		it('hides scope selector when user has only one vehicle', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({ data: testVehicle, error: null });
			mockGetAllVehicles.mockResolvedValue({ data: [testVehicle], error: null });
			mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
			mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

			renderPage();
			await settlePage();

			expect(screen.queryByRole('radiogroup')).toBeNull();
		});

		it('defaults to all-vehicles scope when multiple vehicles exist', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({ data: testVehicle, error: null });
			mockGetAllVehicles.mockResolvedValue({
				data: [testVehicle, testVehicle2],
				error: null
			});
			mockGetAllFuelLogs.mockResolvedValue({
				data: [testFuelEntry, testFuelEntry2],
				error: null
			});
			mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

			renderPage();
			await settlePage();

			const allVehiclesRadio = screen.getByRole('radio', {
				name: /All vehicles/i
			}) as HTMLInputElement;
			expect(allVehiclesRadio.checked).toBe(true);
			expect(screen.getByText(/All vehicles\)/)).toBeTruthy();
		});

		it('updates entry summary when switching to current-vehicle scope', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({ data: testVehicle, error: null });
			mockGetAllVehicles.mockResolvedValue({
				data: [testVehicle, testVehicle2],
				error: null
			});
			mockGetAllFuelLogs
				.mockResolvedValueOnce({ data: [testFuelEntry, testFuelEntry2], error: null })
				.mockResolvedValueOnce({ data: [testFuelEntry], error: null });
			mockGetAllExpenses
				.mockResolvedValueOnce({ data: [testExpense], error: null })
				.mockResolvedValueOnce({ data: [], error: null });

			renderPage();
			await settlePage();

			const currentVehicleRadio = screen.getByRole('radio', { name: /Current vehicle/i });
			await fireEvent.click(currentVehicleRadio);

			await waitFor(() => {
				expect(screen.getByText(/Old Faithful\)/)).toBeTruthy();
			});
		});

		it('exports all vehicles data with vehicle column when all-vehicles scope selected', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({ data: testVehicle, error: null });
			mockGetAllVehicles.mockResolvedValue({
				data: [testVehicle, testVehicle2],
				error: null
			});
			mockGetAllFuelLogs.mockResolvedValue({
				data: [testFuelEntry, testFuelEntry2],
				error: null
			});
			mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

			renderPage();
			await settlePage();

			await fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

			await waitFor(() => {
				expect(mockBuildHistoryExportCSVWithVehicles).toHaveBeenCalledTimes(1);
			});

			expect(mockBuildHistoryExportCSV).not.toHaveBeenCalled();
			expect(mockDownloadCSV).toHaveBeenCalledWith(
				'mock-csv-content-with-vehicles',
				'passanger-export-2026-03-12.csv'
			);
		});

		it('exports current vehicle data without vehicle column when current-vehicle scope selected', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({ data: testVehicle, error: null });
			mockGetAllVehicles.mockResolvedValue({
				data: [testVehicle, testVehicle2],
				error: null
			});
			mockGetAllFuelLogs
				.mockResolvedValueOnce({ data: [testFuelEntry, testFuelEntry2], error: null })
				.mockResolvedValueOnce({ data: [testFuelEntry], error: null })
				.mockResolvedValueOnce({ data: [testFuelEntry], error: null });
			mockGetAllExpenses
				.mockResolvedValueOnce({ data: [testExpense], error: null })
				.mockResolvedValueOnce({ data: [], error: null })
				.mockResolvedValueOnce({ data: [], error: null });

			renderPage();
			await settlePage();

			const currentVehicleRadio = screen.getByRole('radio', { name: /Current vehicle/i });
			await fireEvent.click(currentVehicleRadio);
			await waitFor(() => {
				expect(screen.getByText(/Old Faithful\)/)).toBeTruthy();
			});

			await fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

			await waitFor(() => {
				expect(mockBuildHistoryExportCSV).toHaveBeenCalledTimes(1);
			});

			expect(mockBuildHistoryExportCSVWithVehicles).not.toHaveBeenCalled();
		});
	});

	describe('Import entry point', () => {
		it('renders "Import data from another app" link pointing to /import', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({ data: testVehicle, error: null });
			mockGetAllVehicles.mockResolvedValue({ data: [testVehicle], error: null });

			renderPage();
			await settlePage();

			const importLink = screen.getByRole('link', { name: /import data from another app/i });
			expect(importLink).toBeTruthy();
			expect(importLink.getAttribute('href')).toBe('/import');
		});

		it('shows import CTA even when there are no entries', async () => {
			mockGetAllVehicles.mockResolvedValue({ data: [testVehicle], error: null });
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({ data: testVehicle, error: null });

			renderPage();
			await settlePage();

			expect(screen.getByText(/switching from another app/i)).toBeTruthy();
		});
	});
});
