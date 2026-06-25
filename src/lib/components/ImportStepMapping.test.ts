import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { ImportRow, ImportDryRunSummary, ImportParseResult } from '$lib/utils/importTypes';

const mockRows: ImportRow[] = [
	{
		rowNumber: 1,
		status: 'valid',
		data: {
			date: new Date(2021, 5, 6),
			odometer: 186886,
			quantity: 57.432,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 72.88,
			notes: '',
			type: 'fuel',
			sourceVehicleName: 'Renegade'
		},
		issues: []
	},
	{
		rowNumber: 2,
		status: 'valid',
		data: {
			date: new Date(2021, 5, 12),
			odometer: 187205,
			quantity: 50.441,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 66.53,
			notes: '',
			type: 'fuel',
			sourceVehicleName: 'Renegade'
		},
		issues: []
	},
	{
		rowNumber: 3,
		status: 'warning',
		data: {
			date: new Date(2021, 5, 19),
			odometer: 187500,
			quantity: 45.2,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 0,
			notes: '',
			type: 'fuel',
			sourceVehicleName: 'Renegade'
		},
		issues: ['Cost is zero \u2014 is this correct?']
	}
];

const mockSummary: ImportDryRunSummary = {
	totalRows: 3,
	validCount: 2,
	warningCount: 1,
	errorCount: 0,
	detectedVehicleNames: ['Renegade'],
	dateRange: { start: new Date(2021, 5, 6), end: new Date(2021, 5, 19) }
};

const mockFuellyParseResult: ImportParseResult = {
	rows: mockRows,
	summary: mockSummary,
	detectedUnits: { fuel: 'L', distance: 'km' },
	columnMapping: [
		{ sourceColumn: 'fuelup_date', targetField: 'Date', status: 'mapped' },
		{ sourceColumn: 'odometer', targetField: 'Odometer', status: 'mapped' },
		{ sourceColumn: 'litres', targetField: 'Fuel quantity', status: 'mapped' },
		{ sourceColumn: 'price', targetField: 'Total cost', status: 'calculated' },
		{ sourceColumn: 'notes', targetField: 'Notes', status: 'mapped' },
		{ sourceColumn: 'car_name', targetField: 'Vehicle', status: 'mapped' },
		{ sourceColumn: 'model', targetField: '(ignored)', status: 'ignored' },
		{ sourceColumn: 'l/100km', targetField: '(ignored)', status: 'ignored' }
	]
};

const mockACarParseResult: ImportParseResult = {
	rows: [
		{
			rowNumber: 1,
			status: 'valid',
			data: {
				date: new Date(2018, 9, 7),
				odometer: 424,
				quantity: 33.04,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 1172.92,
				notes: '',
				type: 'fuel',
				sourceVehicleName: 'Toyota Auris'
			},
			issues: []
		}
	],
	summary: {
		totalRows: 1,
		validCount: 1,
		warningCount: 0,
		errorCount: 0,
		detectedVehicleNames: ['Toyota Auris'],
		dateRange: { start: new Date(2018, 9, 7), end: new Date(2018, 9, 7) }
	},
	detectedUnits: { fuel: 'L', distance: 'km' },
	columnMapping: [
		{ sourceColumn: 'Data', targetField: 'Date', status: 'mapped' },
		{ sourceColumn: 'Odo (km)', targetField: 'Odometer', status: 'mapped' },
		{ sourceColumn: 'Fuel (litres)', targetField: 'Fuel quantity', status: 'mapped' },
		{ sourceColumn: 'Price (optional)', targetField: 'Total cost', status: 'mapped' },
		{ sourceColumn: 'Notes (optional)', targetField: 'Notes', status: 'mapped' }
	]
};

const mockDrivvoParseResult: ImportParseResult = {
	rows: [
		{
			rowNumber: 1,
			status: 'valid',
			data: {
				date: new Date(2024, 2, 5),
				odometer: 12345,
				quantity: 30.0,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 55.5,
				notes: 'Highway trip',
				type: 'fuel',
				sourceVehicleName: 'My Car'
			},
			issues: []
		},
		{
			rowNumber: 2,
			status: 'valid',
			data: {
				date: new Date(2024, 2, 10),
				odometer: 12500,
				totalCost: 150.0,
				notes: 'Regular service',
				type: 'maintenance',
				maintenanceType: 'Oil change',
				sourceVehicleName: 'My Car'
			},
			issues: []
		}
	],
	summary: {
		totalRows: 2,
		validCount: 2,
		warningCount: 0,
		errorCount: 0,
		detectedVehicleNames: ['My Car'],
		dateRange: { start: new Date(2024, 2, 5), end: new Date(2024, 2, 10) }
	},
	detectedUnits: null,
	columnMapping: [
		{ sourceColumn: 'Odometer', targetField: 'Odometer', status: 'mapped' },
		{ sourceColumn: 'Date', targetField: 'Date', status: 'mapped' },
		{ sourceColumn: 'Total price', targetField: 'Total cost', status: 'mapped' },
		{ sourceColumn: 'Fuel amount', targetField: 'Fuel quantity', status: 'mapped' },
		{ sourceColumn: 'Notes', targetField: 'Notes', status: 'mapped' }
	]
};

// Mock all parsers — use mockReturnValue in beforeEach for clean isolation
const mockParseFuellyCSV = vi.fn();
const mockParseACarCSV = vi.fn();
const mockParseDrivvoCSV = vi.fn();

vi.mock('$lib/utils/importParseFuelly', () => ({
	parseFuellyCSV: mockParseFuellyCSV
}));

vi.mock('$lib/utils/importParseACar', () => ({
	parseACarCSV: mockParseACarCSV
}));

vi.mock('$lib/utils/importParseDrivvo', () => ({
	parseDrivvoCSV: mockParseDrivvoCSV
}));

import ImportStepMapping from './ImportStepMapping.svelte';

describe('ImportStepMapping', () => {
	beforeEach(() => {
		mockParseFuellyCSV.mockReset();
		mockParseACarCSV.mockReset();
		mockParseDrivvoCSV.mockReset();
		mockParseFuellyCSV.mockResolvedValue({ data: mockFuellyParseResult, error: null });
		mockParseACarCSV.mockResolvedValue({ data: mockACarParseResult, error: null });
		mockParseDrivvoCSV.mockResolvedValue({ data: mockDrivvoParseResult, error: null });
	});

	afterEach(() => {
		cleanup();
	});

	// --- Value-first preview (Story 5.3) ---

	it('leads with a value-first headline: entry count + date span', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByTestId('import-preview')).toBeTruthy();
		});

		const preview = screen.getByTestId('import-preview');
		const text = (preview.textContent ?? '').replace(/\s+/g, ' ').trim();
		expect(text).toContain('3 entries spanning Jun 2021 – Jun 2021');
	});

	it('shows the fuel/expense split and total spend in the home currency', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByTestId('import-preview')).toBeTruthy();
		});

		const text = (screen.getByTestId('import-preview').textContent ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		// 3 fuel rows, no expenses; total = 72.88 + 66.53 + 0 = 139.41 (default home currency €).
		expect(text).toContain('3 fuel-ups');
		expect(text).toContain('Total spend');
		expect(text).toContain('139.41');
		expect(text).toContain('Amounts shown in €');
	});

	it('degrades the headline to a count only when the date range is null', async () => {
		mockParseFuellyCSV.mockResolvedValue({
			data: {
				...mockFuellyParseResult,
				summary: { ...mockSummary, dateRange: null }
			},
			error: null
		});

		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByTestId('import-preview')).toBeTruthy();
		});

		const text = (screen.getByTestId('import-preview').textContent ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		expect(text).toContain('3 entries');
		expect(text).not.toContain('spanning');
	});

	it('counts only committable (valid|warning) rows — excludes error rows that will not import', async () => {
		// AC1 fidelity (5.3 review): commitImportRows writes only valid|warning rows, so the
		// value-first preview must promise only what will actually import. An error row carrying a
		// finite cost + type (a fuel row missing its odometer) must NOT inflate the count or spend.
		const rowsWithError: ImportRow[] = [
			mockRows[0], // valid fuel, totalCost 72.88
			mockRows[1], // valid fuel, totalCost 66.53
			{
				rowNumber: 3,
				status: 'error',
				data: {
					date: new Date(2021, 5, 25),
					quantity: 40,
					unit: 'L',
					distanceUnit: 'km',
					totalCost: 999.99,
					notes: '',
					type: 'fuel',
					sourceVehicleName: 'Renegade'
				},
				issues: ['Missing odometer reading']
			}
		];
		mockParseFuellyCSV.mockResolvedValue({
			data: {
				...mockFuellyParseResult,
				rows: rowsWithError,
				summary: { ...mockSummary, totalRows: 3, validCount: 2, warningCount: 0, errorCount: 1 }
			},
			error: null
		});

		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByTestId('import-preview')).toBeTruthy();
		});

		const text = (screen.getByTestId('import-preview').textContent ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		// Only the 2 committable rows are promised — the €999.99 error row is excluded from both the
		// headline count and the total spend (72.88 + 66.53 = 139.41).
		expect(text).toContain('2 entries');
		expect(text).toContain('2 fuel-ups');
		expect(text).toContain('139.41');
		expect(text).not.toContain('999.99');
	});

	it('collapses the mapping into a default-closed disclosure for a clean Fuelly parse', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByText('How we mapped this')).toBeTruthy();
		});

		const details = screen.getByText('How we mapped this').closest('details');
		expect(details).toBeTruthy();
		expect((details as HTMLDetailsElement).open).toBe(false);
	});

	it('auto-opens the mapping disclosure for Drivvo (units supplied, detection incomplete)', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'drivvo-csv',
				confirmedFormat: 'drivvo',
				onMappingConfirmed: vi.fn()
			}
		});

		const selects = screen.getAllByRole('combobox');
		await fireEvent.change(selects[0], { target: { value: 'L' } });
		await fireEvent.change(selects[1], { target: { value: 'km' } });
		await fireEvent.click(screen.getByRole('button', { name: /parse data/i }));

		await waitFor(() => {
			expect(screen.getByText('How we mapped this')).toBeTruthy();
		});

		const details = screen.getByText('How we mapped this').closest('details');
		expect((details as HTMLDetailsElement).open).toBe(true);
	});

	// --- Fuelly tests (existing, adapted) ---

	it('renders column mapping table after successful parse', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByText("Here's how we'll map your data")).toBeTruthy();
		});

		expect(screen.getByText('fuelup_date')).toBeTruthy();
		expect(screen.getByText('Date')).toBeTruthy();
		expect(screen.getByText('odometer')).toBeTruthy();
		expect(screen.getByText('Odometer')).toBeTruthy();
		expect(screen.getByText('Total cost')).toBeTruthy();
	});

	it('shows calculated badge for price → Total cost mapping', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByText('calc')).toBeTruthy();
		});
	});

	it('shows unit confirmation with detected units', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByText(/Your file uses/)).toBeTruthy();
			expect(screen.getByText(/correct\?/i)).toBeTruthy();
			expect(screen.getByText('Fuel unit')).toBeTruthy();
			expect(screen.getByText('Distance')).toBeTruthy();
		});
	});

	it('shows data preview with 3 row cards', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByText('Data preview')).toBeTruthy();
		});

		expect(screen.getByText(/Row 1:/)).toBeTruthy();
		expect(screen.getByText(/Row 2:/)).toBeTruthy();
		expect(screen.getByText(/Row 3:/)).toBeTruthy();
	});

	it('shows dry-run summary strip with counts', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			const summaryEl = screen.getByTestId('dry-run-summary');
			expect(summaryEl).toBeTruthy();
			const text = (summaryEl.textContent ?? '').replace(/\s+/g, ' ').trim();
			expect(text).toContain('3 rows');
			expect(text).toContain('2 ready');
			expect(text).toContain('1 warnings');
			expect(text).toContain('1 vehicle');
		});
	});

	it('shows price note about cost calculation for Fuelly only', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByText(/total cost calculated as price/i)).toBeTruthy();
		});
	});

	it('enables Continue button after successful parse', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			const continueBtn = screen.getByRole('button', { name: /continue/i });
			expect(continueBtn.hasAttribute('disabled')).toBe(false);
		});
	});

	it('calls onMappingConfirmed with rows and summary when Continue is clicked', async () => {
		const onMappingConfirmed = vi.fn();
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed
			}
		});

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /continue/i })).toBeTruthy();
		});

		await fireEvent.click(screen.getByRole('button', { name: /continue/i }));

		expect(onMappingConfirmed).toHaveBeenCalledTimes(1);
		expect(onMappingConfirmed).toHaveBeenCalledWith({
			rows: mockRows,
			summary: mockSummary
		});
	});

	it('shows error state on parse failure', async () => {
		mockParseFuellyCSV.mockResolvedValue({
			data: null,
			error: { code: 'PARSE_FAILED', message: 'Could not parse the CSV file.' }
		});

		render(ImportStepMapping, {
			props: {
				rawCSV: 'bad-csv',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText('Could not parse file')).toBeTruthy();
			expect(screen.getByText(/re-uploading/i)).toBeTruthy();
		});
	});

	it('has toggleable ignored columns section', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByText(/ignored columns/i)).toBeTruthy();
		});

		expect(screen.queryByText('model')).toBeNull();

		await fireEvent.click(screen.getByText(/ignored columns/i));

		expect(screen.getByText('model')).toBeTruthy();
	});

	it('propagates unit overrides to row data when Continue is clicked', async () => {
		const onMappingConfirmed = vi.fn();
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed
			}
		});

		await waitFor(() => {
			expect(screen.getByText('Fuel unit')).toBeTruthy();
		});

		const selects = screen.getAllByRole('combobox');
		const fuelSelect = selects[0];
		await fireEvent.change(fuelSelect, { target: { value: 'gal' } });

		const distanceSelect = selects[1];
		await fireEvent.change(distanceSelect, { target: { value: 'mi' } });

		await fireEvent.click(screen.getByRole('button', { name: /continue/i }));

		expect(onMappingConfirmed).toHaveBeenCalledTimes(1);
		const passedRows = onMappingConfirmed.mock.calls[0][0].rows;
		for (const row of passedRows) {
			expect(row.data.unit).toBe('gal');
			expect(row.data.distanceUnit).toBe('mi');
		}
	});

	it('passes original units when no override is applied', async () => {
		const onMappingConfirmed = vi.fn();
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed
			}
		});

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /continue/i })).toBeTruthy();
		});

		await fireEvent.click(screen.getByRole('button', { name: /continue/i }));

		expect(onMappingConfirmed).toHaveBeenCalledTimes(1);
		const passedRows = onMappingConfirmed.mock.calls[0][0].rows;
		expect(passedRows[0].data.unit).toBe('L');
		expect(passedRows[0].data.distanceUnit).toBe('km');
	});

	it('shows vehicle names in data preview cards', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			const vehicleLabels = screen.getAllByText('Renegade');
			expect(vehicleLabels.length).toBeGreaterThanOrEqual(3);
		});
	});

	// --- aCar tests ---

	it('renders aCar parse results correctly', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'acar-csv',
				confirmedFormat: 'acar',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByText("Here's how we'll map your data")).toBeTruthy();
		});

		expect(screen.getByText('Data')).toBeTruthy();
		expect(screen.getByText('Toyota Auris')).toBeTruthy();
	});

	it('shows "Your file declares" for aCar unit confirmation', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'acar-csv',
				confirmedFormat: 'acar',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByText(/your file declares/i)).toBeTruthy();
		});
	});

	it('does not show price note for aCar', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'acar-csv',
				confirmedFormat: 'acar',
				onMappingConfirmed: vi.fn()
			}
		});

		await waitFor(() => {
			expect(screen.getByText("Here's how we'll map your data")).toBeTruthy();
		});

		expect(screen.queryByText(/total cost calculated as price/i)).toBeNull();
	});

	// --- Drivvo tests ---

	it('renders Drivvo with mandatory unit selection first', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'drivvo-csv',
				confirmedFormat: 'drivvo',
				onMappingConfirmed: vi.fn()
			}
		});

		expect(screen.getByText(/what units does your data use/i)).toBeTruthy();
		expect(screen.getByText('Fuel unit')).toBeTruthy();
		expect(screen.getByText('Distance')).toBeTruthy();
	});

	it('shows Parse data button for Drivvo (disabled until units selected)', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'drivvo-csv',
				confirmedFormat: 'drivvo',
				onMappingConfirmed: vi.fn()
			}
		});

		const parseBtn = screen.getByRole('button', { name: /parse data/i });
		expect(parseBtn.hasAttribute('disabled')).toBe(true);
	});

	it('enables Parse data button after both units are selected for Drivvo', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'drivvo-csv',
				confirmedFormat: 'drivvo',
				onMappingConfirmed: vi.fn()
			}
		});

		const selects = screen.getAllByRole('combobox');
		await fireEvent.change(selects[0], { target: { value: 'L' } });
		await fireEvent.change(selects[1], { target: { value: 'km' } });

		const parseBtn = screen.getByRole('button', { name: /parse data/i });
		expect(parseBtn.hasAttribute('disabled')).toBe(false);
	});

	it('renders Drivvo results after Parse data is clicked', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'drivvo-csv',
				confirmedFormat: 'drivvo',
				onMappingConfirmed: vi.fn()
			}
		});

		const selects = screen.getAllByRole('combobox');
		await fireEvent.change(selects[0], { target: { value: 'L' } });
		await fireEvent.change(selects[1], { target: { value: 'km' } });

		await fireEvent.click(screen.getByRole('button', { name: /parse data/i }));

		await waitFor(() => {
			expect(screen.getByText("Here's how we'll map your data")).toBeTruthy();
		});

		expect(screen.getAllByText('My Car').length).toBeGreaterThanOrEqual(1);
	});

	it('does not show price note for Drivvo', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'drivvo-csv',
				confirmedFormat: 'drivvo',
				onMappingConfirmed: vi.fn()
			}
		});

		const selects = screen.getAllByRole('combobox');
		await fireEvent.change(selects[0], { target: { value: 'L' } });
		await fireEvent.change(selects[1], { target: { value: 'km' } });

		await fireEvent.click(screen.getByRole('button', { name: /parse data/i }));

		await waitFor(() => {
			expect(screen.getByText("Here's how we'll map your data")).toBeTruthy();
		});

		expect(screen.queryByText(/total cost calculated as price/i)).toBeNull();
	});

	it('shows entry type labels for Drivvo mixed types (Fuel/Service)', async () => {
		render(ImportStepMapping, {
			props: {
				rawCSV: 'drivvo-csv',
				confirmedFormat: 'drivvo',
				onMappingConfirmed: vi.fn()
			}
		});

		const selects = screen.getAllByRole('combobox');
		await fireEvent.change(selects[0], { target: { value: 'L' } });
		await fireEvent.change(selects[1], { target: { value: 'km' } });

		await fireEvent.click(screen.getByRole('button', { name: /parse data/i }));

		await waitFor(() => {
			expect(screen.getByText('Fuel')).toBeTruthy();
			expect(screen.getByText('Service')).toBeTruthy();
		});
	});

	// Spinner test at end to avoid mock leak issues with pending promises
	it('shows loading spinner while parsing', async () => {
		let resolvePromise: (v: unknown) => void;
		mockParseFuellyCSV.mockReturnValue(
			new Promise((resolve) => {
				resolvePromise = resolve;
			})
		);
		render(ImportStepMapping, {
			props: {
				rawCSV: 'csv-content',
				confirmedFormat: 'fuelly',
				onMappingConfirmed: vi.fn()
			}
		});

		expect(screen.getByRole('status')).toBeTruthy();
		expect(screen.getByText('Parsing your data...')).toBeTruthy();

		// Resolve to prevent leaking
		resolvePromise!({ data: mockFuellyParseResult, error: null });
	});
});
