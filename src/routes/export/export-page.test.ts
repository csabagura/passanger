import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { SETTINGS_STORAGE_KEY } from '$lib/config';
import ExportPage from './+page.svelte';

const mockGetVehicleById = vi.fn();
const mockGetAllVehicles = vi.fn();
const mockGetAllFuelLogs = vi.fn();
const mockGetAllExpenses = vi.fn();
const mockBuildHistoryExportCSV = vi.fn();
const mockBuildCSVFilename = vi.fn();
const mockDownloadCSV = vi.fn();
const mockUpdateSettings = vi.fn();

let settingsState: {
	value: {
		fuelUnit: 'L/100km' | 'MPG';
		currency: string;
	};
} = {
	value: {
		fuelUnit: 'L/100km' as const,
		currency: '€'
	}
};

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
	const settingsContext = {
		get settings() {
			return settingsState.value;
		},
		updateSettings(nextSettings: { fuelUnit: 'L/100km' | 'MPG'; currency: string }) {
			settingsState.value = nextSettings;
			mockUpdateSettings(nextSettings);
		}
	};

	return render(ExportPage, {
		context: new Map([['settings', settingsContext]])
	});
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

describe('Export page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
		settingsState = {
			value: {
				fuelUnit: 'L/100km',
				currency: '€'
			}
		};

		mockGetVehicleById.mockResolvedValue({
			data: null,
			error: { code: 'NOT_FOUND', message: 'Vehicle not found' }
		});
		mockGetAllVehicles.mockResolvedValue({ data: [], error: null });
		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });
		mockBuildHistoryExportCSV.mockReturnValue('mock-csv-content');
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

		mockGetAllVehicles.mockImplementationOnce(() => deferredVehicleRecovery.promise);

		renderPage();

		const exportButton = screen.getByRole('button', { name: 'Export CSV' });
		expect(exportButton).toBeTruthy();
		expect(exportButton.hasAttribute('disabled')).toBe(true);
		expect(screen.getByText('Checking your saved history on this device.')).toBeTruthy();
		expect(screen.queryByText('Nothing to export yet - log your first fill-up!')).toBeNull();

		deferredVehicleRecovery.resolve({ data: [testVehicle], error: null });
		await settlePage();
	});

	it('recovers the current vehicle, loads mixed entry summary state, and persists the recovered vehicle id', async () => {
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
		expect(screen.getByRole('heading', { name: 'Export' })).toBeTruthy();
		expect(screen.getByText(/Old Faithful/)).toBeTruthy();
		expect(screen.getByText('2 entries ready')).toBeTruthy();
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
		expect(mockGetAllVehicles).toHaveBeenCalledTimes(1);
		expect(screen.getByText(/Old Faithful/)).toBeTruthy();
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
		expect(mockGetAllVehicles).not.toHaveBeenCalled();
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
		mockGetAllFuelLogs
			.mockResolvedValueOnce({ data: [testFuelEntry], error: null })
			.mockResolvedValueOnce({ data: [testFuelEntry], error: null });
		mockGetAllExpenses
			.mockResolvedValueOnce({ data: [testExpense], error: null })
			.mockResolvedValueOnce({ data: [testExpense], error: null });

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
		expect(mockGetAllFuelLogs).toHaveBeenCalledTimes(2);
		expect(mockGetAllExpenses).toHaveBeenCalledTimes(2);
	});

	it('shows the empty state with a Fuel CTA when there are no saved entries', async () => {
		renderPage();
		await settlePage();

		expect(screen.getByText('Nothing to export yet - log your first fill-up!')).toBeTruthy();
		const link = screen.getByRole('link', { name: 'Go to Fuel Entry' });
		expect(link.getAttribute('href')).toBe('/fuel-entry');
		expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
	});

	it('shows the empty state for a returning user when the current vehicle loads but both repositories are empty', async () => {
		localStorageMock.setItem('passanger_vehicle_id', '7');
		mockGetVehicleById.mockResolvedValue({
			data: testVehicle,
			error: null
		});

		renderPage();
		await settlePage();

		expect(screen.getByText(/Old Faithful/)).toBeTruthy();
		expect(screen.getByText('Nothing to export yet - log your first fill-up!')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Go to Fuel Entry' }).getAttribute('href')).toBe(
			'/fuel-entry'
		);
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

		expect(mockGetAllFuelLogs).toHaveBeenCalledTimes(2);
		expect(mockGetAllExpenses).toHaveBeenCalledTimes(2);
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

	it('reveals labelled settings controls from the gear button', async () => {
		renderPage();
		await settlePage();

		await fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

		expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
		expect(screen.getByRole('radio', { name: 'L/100km' })).toBeTruthy();
		expect(screen.getByRole('radio', { name: 'MPG' })).toBeTruthy();
		expect(screen.getByLabelText('Currency prefix')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Export all data' }).getAttribute('href')).toBe(
			'#export-route-primary-action'
		);
	});

	it('saves preset settings through saveSettings and updateSettings while export remains visible', async () => {
		mockGetAllVehicles.mockResolvedValue({
			data: [testVehicle],
			error: null
		});
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		renderPage();
		await settlePage();

		await fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

		expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: '$' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		expect(mockUpdateSettings).toHaveBeenCalledWith({ fuelUnit: 'L/100km', currency: '$' });
		expect(JSON.parse(localStorageMock.getItem(SETTINGS_STORAGE_KEY)!)).toEqual({
			fuelUnit: 'L/100km',
			currency: '$'
		});
		expect(screen.getByRole('status').textContent).toContain('Settings saved.');
	});

	it('saves custom currency prefixes and fuel-unit changes', async () => {
		renderPage();
		await settlePage();

		await fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'MPG' }));
		await fireEvent.input(screen.getByLabelText('Currency prefix'), {
			target: { value: 'EUR ' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		expect(mockUpdateSettings).toHaveBeenCalledWith({ fuelUnit: 'MPG', currency: 'EUR ' });
		expect(JSON.parse(localStorageMock.getItem(SETTINGS_STORAGE_KEY)!)).toEqual({
			fuelUnit: 'MPG',
			currency: 'EUR '
		});
	});

	it('surfaces blocked settings persistence instead of updating runtime state', async () => {
		renderPage();
		await settlePage();

		const setItemSpy = vi.spyOn(localStorageMock, 'setItem').mockImplementationOnce(() => {
			throw new DOMException('SecurityError', 'SecurityError');
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
		await fireEvent.click(screen.getByRole('button', { name: '$' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		expect(mockUpdateSettings).not.toHaveBeenCalled();
		expect(localStorageMock.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
		expect(screen.getByRole('alert').textContent).toContain(
			'Could not save settings on this device.'
		);
		expect(screen.queryByRole('status')).toBeNull();

		setItemSpy.mockRestore();
	});

	it('rejects blank currency input instead of saving it', async () => {
		renderPage();
		await settlePage();

		await fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
		await fireEvent.input(screen.getByLabelText('Currency prefix'), {
			target: { value: '   ' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		expect(mockUpdateSettings).not.toHaveBeenCalled();
		expect(screen.getByRole('alert').textContent).toContain('Enter a currency symbol or prefix.');
		expect(localStorageMock.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
	});
});
