import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { VehiclesContext } from '$lib/utils/vehicleContext';

// Mock $app/paths and $app/navigation
vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

const mockGoto = vi.fn();
vi.mock('$app/navigation', () => ({
	goto: (...args: unknown[]) => mockGoto(...args)
}));

// Mock importCommit (used by ImportStepConfirm)
vi.mock('$lib/utils/importCommit', () => ({
	commitImportRows: vi.fn(() =>
		Promise.resolve({
			data: {
				fuelCount: 1,
				maintenanceCount: 0,
				skippedCount: 0,
				vehiclesCreated: [],
				vehiclesMatched: ['TestCar'],
				totalImported: 1
			},
			error: null
		})
	)
}));

// Mock papaparse (dynamically imported by ImportStepUpload)
vi.mock('papaparse', () => ({
	parse: vi.fn((content: string) => {
		const lines = content.split('\n').filter((line: string) => line.trim() !== '');
		return {
			data: lines.map((line: string) => line.split(',')),
			errors: []
		};
	})
}));

// Mock importDetect (used by ImportStepUpload)
const mockDetectCSVFormat = vi.fn((_csvContent: string): { data: string; error: null } => ({ data: 'fuelly', error: null }));
vi.mock('$lib/utils/importDetect', () => ({
	detectCSVFormat: (csvContent: string) => mockDetectCSVFormat(csvContent)
}));

const mockFuellyResult = {
	rows: [
		{
			rowNumber: 1,
			status: 'valid',
			data: {
				date: new Date(2024, 0, 1),
				odometer: 10000,
				quantity: 40,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 60,
				notes: '',
				type: 'fuel',
				sourceVehicleName: 'TestCar'
			},
			issues: []
		}
	],
	summary: {
		totalRows: 1,
		validCount: 1,
		warningCount: 0,
		errorCount: 0,
		detectedVehicleNames: ['TestCar'],
		dateRange: { start: new Date(2024, 0, 1), end: new Date(2024, 0, 1) }
	},
	detectedUnits: { fuel: 'L', distance: 'km' },
	columnMapping: [
		{ sourceColumn: 'fuelup_date', targetField: 'Date', status: 'mapped' },
		{ sourceColumn: 'odometer', targetField: 'Odometer', status: 'mapped' },
		{ sourceColumn: 'litres', targetField: 'Fuel quantity', status: 'mapped' },
		{ sourceColumn: 'price', targetField: 'Total cost', status: 'calculated' },
		{ sourceColumn: 'notes', targetField: 'Notes', status: 'mapped' },
		{ sourceColumn: 'car_name', targetField: 'Vehicle', status: 'mapped' }
	]
};

const mockACarResult = {
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
		{ sourceColumn: 'Odo (km)', targetField: 'Odometer', status: 'mapped' }
	]
};

const mockDrivvoResult = {
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
				notes: '',
				type: 'fuel',
				sourceVehicleName: 'My Car'
			},
			issues: []
		}
	],
	summary: {
		totalRows: 1,
		validCount: 1,
		warningCount: 0,
		errorCount: 0,
		detectedVehicleNames: ['My Car'],
		dateRange: { start: new Date(2024, 2, 5), end: new Date(2024, 2, 5) }
	},
	detectedUnits: null,
	columnMapping: [
		{ sourceColumn: 'Odometer', targetField: 'Odometer', status: 'mapped' },
		{ sourceColumn: 'Date', targetField: 'Date', status: 'mapped' }
	]
};

// Mock parsers (used by ImportStepMapping via dynamic import)
vi.mock('$lib/utils/importParseFuelly', () => ({
	parseFuellyCSV: vi.fn(() => Promise.resolve({ data: mockFuellyResult, error: null }))
}));

vi.mock('$lib/utils/importParseACar', () => ({
	parseACarCSV: vi.fn(() => Promise.resolve({ data: mockACarResult, error: null }))
}));

vi.mock('$lib/utils/importParseDrivvo', () => ({
	parseDrivvoCSV: vi.fn(() => Promise.resolve({ data: mockDrivvoResult, error: null }))
}));

import ImportWizard from './ImportWizard.svelte';

const testVehicle = { id: 1, name: 'My Car', make: 'Honda', model: 'Civic', year: 2020 };

function makeVehiclesContext(vehicles = [testVehicle]): VehiclesContext {
	return {
		get vehicles() {
			return vehicles;
		},
		get activeVehicle() {
			return vehicles[0] ?? null;
		},
		get activeVehicleId() {
			return vehicles[0]?.id ?? null;
		},
		get loaded() {
			return true;
		},
		switchVehicle: vi.fn(),
		refreshVehicles: vi.fn().mockResolvedValue(undefined)
	};
}

function renderWizard(ctx = makeVehiclesContext()) {
	const contextMap = new Map<string, unknown>();
	contextMap.set('vehicles', ctx);
	return render(ImportWizard, { context: contextMap });
}

/** Advance wizard to step 3 with a file uploaded (hasFile = true) */
async function advanceToStep3WithFile() {
	renderWizard();

	// Step 1: Select Fuelly source
	await fireEvent.click(screen.getByRole('button', { name: /fuelly/i }));

	// Step 2: Upload a valid CSV file
	const csv = 'fuelup_date,gallons\n2024-01-01,10\n2024-01-02,12';
	const file = new File([csv], 'test.csv', { type: 'text/csv' });
	const input = document.querySelector('input[type="file"]') as HTMLInputElement;
	await fireEvent.change(input, { target: { files: [file] } });

	// Wait for async file processing to complete
	await waitFor(() => {
		const continueBtn = screen.getByRole('button', { name: /continue/i });
		expect(continueBtn.hasAttribute('disabled')).toBe(false);
	});

	// Click Continue to advance to step 3
	await fireEvent.click(screen.getByRole('button', { name: /continue/i }));

	// Verify we're at step 3
	await waitFor(() => {
		expect(screen.getByText('Step 3 of 6: Mapping')).toBeTruthy();
	});
}

describe('ImportWizard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDetectCSVFormat.mockReturnValue({ data: 'fuelly', error: null });
	});

	afterEach(() => {
		cleanup();
	});

	it('renders step 1 with progress indicator showing 6 steps', () => {
		renderWizard();

		expect(screen.getByText('Step 1 of 6: Source')).toBeTruthy();
		expect(screen.getByText('Source')).toBeTruthy();
		expect(screen.getByText('Upload')).toBeTruthy();
		expect(screen.getByText('Mapping')).toBeTruthy();
		expect(screen.getByText('Review')).toBeTruthy();
		expect(screen.getByText('Vehicles')).toBeTruthy();
		expect(screen.getByText('Confirm')).toBeTruthy();
	});

	it('renders progress indicator with aria-current="step" on active step', () => {
		renderWizard();

		const nav = screen.getByRole('navigation', { name: /wizard progress/i });
		expect(nav).toBeTruthy();

		const currentStep = nav.querySelector('[aria-current="step"]');
		expect(currentStep).toBeTruthy();
		expect(currentStep?.textContent).toContain('Source');
	});

	it('renders Back button disabled on step 1', () => {
		renderWizard();

		const backButton = screen.getByRole('button', { name: /back/i });
		expect(backButton.hasAttribute('disabled')).toBe(true);
	});

	it('renders Cancel button enabled', () => {
		renderWizard();

		const cancelButton = screen.getByRole('button', { name: /cancel/i });
		expect(cancelButton.hasAttribute('disabled')).toBe(false);
	});

	it('navigates to /export when Cancel is clicked on step 1 (no file uploaded)', async () => {
		renderWizard();

		await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
		expect(mockGoto).toHaveBeenCalledWith('/export');
	});

	it('advances to step 2 when a source is selected', async () => {
		renderWizard();

		await fireEvent.click(screen.getByRole('button', { name: /fuelly/i }));

		expect(screen.getByText('Step 2 of 6: Upload')).toBeTruthy();
	});

	it('enables Back button on step 2', async () => {
		renderWizard();

		await fireEvent.click(screen.getByRole('button', { name: /fuelly/i }));

		const backButton = screen.getByRole('button', { name: /back/i });
		expect(backButton.hasAttribute('disabled')).toBe(false);
	});

	it('goes back to step 1 when Back is clicked on step 2', async () => {
		renderWizard();

		await fireEvent.click(screen.getByRole('button', { name: /fuelly/i }));
		expect(screen.getByText('Step 2 of 6: Upload')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: /back/i }));
		expect(screen.getByText('Step 1 of 6: Source')).toBeTruthy();
	});

	it('renders four source cards on step 1', () => {
		renderWizard();

		const buttons = screen.getAllByRole('button');
		const sourceButtons = buttons.filter((btn) =>
			btn.getAttribute('aria-label')?.startsWith('Import from')
		);
		expect(sourceButtons).toHaveLength(4);
	});

	it('renders instruction text on step 1', () => {
		renderWizard();

		expect(screen.getByText(/select the app you exported from/i)).toBeTruthy();
	});

	describe('Step 3: ImportStepMapping for Fuelly', () => {
		it('renders ImportStepMapping with column mapping after file upload for Fuelly format', async () => {
			await advanceToStep3WithFile();

			// ImportStepMapping should render with the mapping table
			await waitFor(() => {
				expect(screen.getByText("Here's how we'll map your data")).toBeTruthy();
			});

			// Verify data preview appears
			expect(screen.getByText('Data preview')).toBeTruthy();
		});
	});

	describe('Step 3: ImportStepMapping for aCar', () => {
		it('renders ImportStepMapping for aCar format', async () => {
			mockDetectCSVFormat.mockReturnValue({ data: 'acar', error: null });
			renderWizard();

			// Step 1: Select aCar source
			await fireEvent.click(screen.getByRole('button', { name: /acar/i }));

			// Step 2: Upload a valid CSV file
			const csv = '## Vehicle\nName\nToyota';
			const file = new File([csv], 'test.csv', { type: 'text/csv' });
			const input = document.querySelector('input[type="file"]') as HTMLInputElement;
			await fireEvent.change(input, { target: { files: [file] } });

			await waitFor(() => {
				const continueBtn = screen.getByRole('button', { name: /continue/i });
				expect(continueBtn.hasAttribute('disabled')).toBe(false);
			});

			await fireEvent.click(screen.getByRole('button', { name: /continue/i }));

			await waitFor(() => {
				expect(screen.getByText('Step 3 of 6: Mapping')).toBeTruthy();
			});

			// Should render ImportStepMapping (not "Coming soon")
			await waitFor(() => {
				expect(screen.getByText("Here's how we'll map your data")).toBeTruthy();
			});
		});
	});

	describe('Step 3: ImportStepMapping for Drivvo', () => {
		it('renders ImportStepMapping for Drivvo format', async () => {
			mockDetectCSVFormat.mockReturnValue({ data: 'drivvo', error: null });
			renderWizard();

			// Step 1: Select Drivvo source
			await fireEvent.click(screen.getByRole('button', { name: /drivvo/i }));

			// Step 2: Upload a valid CSV file
			const csv = '##Refuelling\nOdometer,Date\n12345,5/3/2024';
			const file = new File([csv], 'test.csv', { type: 'text/csv' });
			const input = document.querySelector('input[type="file"]') as HTMLInputElement;
			await fireEvent.change(input, { target: { files: [file] } });

			await waitFor(() => {
				const continueBtn = screen.getByRole('button', { name: /continue/i });
				expect(continueBtn.hasAttribute('disabled')).toBe(false);
			});

			await fireEvent.click(screen.getByRole('button', { name: /continue/i }));

			await waitFor(() => {
				expect(screen.getByText('Step 3 of 6: Mapping')).toBeTruthy();
			});

			// Should render ImportStepMapping with Drivvo unit selection (not "Coming soon")
			expect(screen.getByText(/what units does your data use/i)).toBeTruthy();
		});
	});

	describe('Cancel confirmation dialog', () => {
		it('shows confirmation dialog when Cancel is clicked after file upload', async () => {
			await advanceToStep3WithFile();

			await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

			expect(screen.getByRole('dialog', { name: /confirm cancel/i })).toBeTruthy();
			expect(screen.getByText('Cancel import?')).toBeTruthy();
			expect(screen.getByText(/progress will be lost/i)).toBeTruthy();
		});

		it('"Keep working" dismisses dialog without navigating', async () => {
			await advanceToStep3WithFile();

			await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
			await fireEvent.click(screen.getByRole('button', { name: /keep working/i }));

			expect(screen.queryByRole('dialog')).toBeNull();
			expect(mockGoto).not.toHaveBeenCalled();
		});

		it('"Cancel import" navigates to /export', async () => {
			await advanceToStep3WithFile();

			await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
			await fireEvent.click(screen.getByRole('button', { name: /cancel import/i }));

			expect(mockGoto).toHaveBeenCalledWith('/export');
		});

		it('Escape key dismisses dialog', async () => {
			await advanceToStep3WithFile();

			await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

			const dialog = screen.getByRole('dialog');
			await fireEvent.keyDown(dialog, { key: 'Escape' });

			expect(screen.queryByRole('dialog')).toBeNull();
			expect(mockGoto).not.toHaveBeenCalled();
		});

		it('moves focus into dialog when opened (focus trap regression)', async () => {
			await advanceToStep3WithFile();

			await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

			await waitFor(() => {
				const keepWorkingBtn = screen.getByRole('button', { name: /keep working/i });
				expect(document.activeElement).toBe(keepWorkingBtn);
			});
		});
	});

	describe('Step 4: ImportStepReview', () => {
		/** Advance wizard past step 3 (clicks Continue on mapping) */
		async function advancePastStep3() {
			await advanceToStep3WithFile();

			// Wait for mapping data to load, then click Continue
			await waitFor(() => {
				expect(screen.getByText("Here's how we'll map your data")).toBeTruthy();
			});
			const continueBtn = screen.getByRole('button', { name: /continue/i });
			await fireEvent.click(continueBtn);
		}

		it('Step 4 auto-skips to Step 5 when all rows are valid', async () => {
			// mockFuellyResult has all valid rows, so Step 4 should auto-skip
			await advancePastStep3();

			// Should skip directly to Step 5 (placeholder) — Step 4 is never visible
			await waitFor(() => {
				expect(screen.getByText('Step 5 of 6: Vehicles')).toBeTruthy();
			});
		});

		it('Back from Step 5 goes to Step 3 when Step 4 was auto-skipped', async () => {
			await advancePastStep3();

			// Should be at Step 5 after auto-skip
			await waitFor(() => {
				expect(screen.getByText('Step 5 of 6: Vehicles')).toBeTruthy();
			});

			// Click Back
			await fireEvent.click(screen.getByRole('button', { name: /back/i }));

			// Should go to Step 3, not Step 4
			await waitFor(() => {
				expect(screen.getByText('Step 3 of 6: Mapping')).toBeTruthy();
			});
		});

		it('Step 4 renders ImportStepReview when parsedRows has flagged rows', async () => {
			// Override mock to return flagged rows
			const { parseFuellyCSV } = await import('$lib/utils/importParseFuelly');
			const mockedParse = vi.mocked(parseFuellyCSV);
			mockedParse.mockResolvedValueOnce({
				data: {
					rows: [
						{
							rowNumber: 1,
							status: 'error',
							data: {
								date: new Date(2024, 0, 1),
								odometer: undefined,
								quantity: 40,
								unit: 'L' as const,
								distanceUnit: 'km' as const,
								totalCost: 60,
								notes: '',
								type: 'fuel' as const,
								sourceVehicleName: 'TestCar'
							},
							issues: ['Missing odometer reading']
						},
						{
							rowNumber: 2,
							status: 'valid',
							data: {
								date: new Date(2024, 0, 2),
								odometer: 10200,
								quantity: 42,
								unit: 'L' as const,
								distanceUnit: 'km' as const,
								totalCost: 62,
								notes: '',
								type: 'fuel' as const,
								sourceVehicleName: 'TestCar'
							},
							issues: []
						}
					],
					summary: {
						totalRows: 2,
						validCount: 1,
						warningCount: 0,
						errorCount: 1,
						detectedVehicleNames: ['TestCar'],
						dateRange: { start: new Date(2024, 0, 1), end: new Date(2024, 0, 2) }
					},
					detectedUnits: { fuel: 'L' as const, distance: 'km' as const },
					columnMapping: [
						{ sourceColumn: 'fuelup_date', targetField: 'Date', status: 'mapped' as const }
					]
				},
				error: null
			});

			renderWizard();

			// Step 1: Select Fuelly
			await fireEvent.click(screen.getByRole('button', { name: /fuelly/i }));

			// Step 2: Upload
			const csv = 'fuelup_date,gallons\n2024-01-01,10\n2024-01-02,12';
			const file = new File([csv], 'test.csv', { type: 'text/csv' });
			const input = document.querySelector('input[type="file"]') as HTMLInputElement;
			await fireEvent.change(input, { target: { files: [file] } });

			await waitFor(() => {
				const continueBtn = screen.getByRole('button', { name: /continue/i });
				expect(continueBtn.hasAttribute('disabled')).toBe(false);
			});

			await fireEvent.click(screen.getByRole('button', { name: /continue/i }));

			// Step 3: Mapping
			await waitFor(() => {
				expect(screen.getByText('Step 3 of 6: Mapping')).toBeTruthy();
			});

			await waitFor(() => {
				expect(screen.getByText("Here's how we'll map your data")).toBeTruthy();
			});

			const continueBtn = screen.getByRole('button', { name: /continue/i });
			await fireEvent.click(continueBtn);

			// Step 4: Review — should show ImportStepReview with flagged rows
			await waitFor(() => {
				expect(screen.getByText('Step 4 of 6: Review')).toBeTruthy();
			});

			// Should see the flagged row
			await waitFor(() => {
				expect(screen.getByTestId('review-card-1')).toBeTruthy();
			});
		});
	});

	describe('Step 5-6: Vehicle Assignment & Confirm', () => {
		/** Advance wizard to step 5 (auto-skip step 4 with all-valid rows) */
		async function advanceToStep5() {
			await advanceToStep3WithFile();

			await waitFor(() => {
				expect(screen.getByText("Here's how we'll map your data")).toBeTruthy();
			});
			const continueBtn = screen.getByRole('button', { name: /continue/i });
			await fireEvent.click(continueBtn);

			await waitFor(() => {
				expect(screen.getByText('Step 5 of 6: Vehicles')).toBeTruthy();
			});
		}

		it('Step 5 renders ImportStepVehicles with vehicle group cards', async () => {
			await advanceToStep5();

			// Should show the vehicle group card from mock data
			expect(screen.getByText(/assign each vehicle/i)).toBeTruthy();
			expect(screen.getByText(/"TestCar"/)).toBeTruthy();
		});

		it('Step 5 → Step 6 transition on vehicle assignment', async () => {
			await advanceToStep5();

			// Auto-match: 1 group + 1 existing vehicle (testVehicle)
			// The component auto-matches and shows confirmation
			await waitFor(() => {
				expect(screen.getByText(/we'll add these rows to/i)).toBeTruthy();
			});

			// Click "Review & Import" button
			const reviewBtn = screen.getByTestId('review-import-btn');
			await fireEvent.click(reviewBtn);

			// Should be on Step 6
			await waitFor(() => {
				expect(screen.getByText('Step 6 of 6: Confirm')).toBeTruthy();
			});
		});

		it('Step 6 renders ImportStepConfirm with summary', async () => {
			await advanceToStep5();

			// Auto-match and advance
			await waitFor(() => {
				expect(screen.getByTestId('review-import-btn')).toBeTruthy();
			});
			await fireEvent.click(screen.getByTestId('review-import-btn'));

			await waitFor(() => {
				expect(screen.getByText('Step 6 of 6: Confirm')).toBeTruthy();
			});

			// Should show import summary
			expect(screen.getByText(/will be imported/i)).toBeTruthy();
			expect(screen.getByTestId('import-btn')).toBeTruthy();
		});

		it('Back from Step 6 returns to Step 5', async () => {
			await advanceToStep5();

			await waitFor(() => {
				expect(screen.getByTestId('review-import-btn')).toBeTruthy();
			});
			await fireEvent.click(screen.getByTestId('review-import-btn'));

			await waitFor(() => {
				expect(screen.getByText('Step 6 of 6: Confirm')).toBeTruthy();
			});

			// Click Back
			await fireEvent.click(screen.getByRole('button', { name: /back/i }));

			await waitFor(() => {
				expect(screen.getByText('Step 5 of 6: Vehicles')).toBeTruthy();
			});
		});

		it('Back from Step 5 respects step4AutoSkipped (goes to Step 3 if auto-skipped)', async () => {
			await advanceToStep5();

			// Click Back from Step 5 — should go to Step 3 since step 4 was auto-skipped
			await fireEvent.click(screen.getByRole('button', { name: /back/i }));

			await waitFor(() => {
				expect(screen.getByText('Step 3 of 6: Mapping')).toBeTruthy();
			});
		});
	});
});
