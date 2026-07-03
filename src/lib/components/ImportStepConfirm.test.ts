import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { VehiclesContext } from '$lib/utils/vehicleContext';
import type {
	ImportRow,
	ImportDryRunSummary,
	VehicleAssignment,
	ImportCommitResult
} from '$lib/utils/importTypes';

// Mock $app/paths and $app/navigation
vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

const mockGoto = vi.fn();
vi.mock('$app/navigation', () => ({
	goto: (...args: unknown[]) => mockGoto(...args)
}));

// Mock importCommit
const mockCommitResult: ImportCommitResult = {
	fuelCount: 5,
	maintenanceCount: 2,
	skippedCount: 1,
	vehiclesCreated: [],
	vehiclesMatched: ['TestCar'],
	totalImported: 7
};

const mockCommitImportRows = vi.fn();

vi.mock('$lib/utils/importCommit', () => ({
	commitImportRows: (...args: unknown[]) => mockCommitImportRows(...args)
}));

// Story 8.3 AC1 — default to "no duplicates found" so existing pre-commit-view tests are
// unaffected; individual tests override this to exercise the keep/skip flow.
const mockFindDuplicateRows = vi.fn();

vi.mock('$lib/utils/importDuplicates', () => ({
	findDuplicateRows: (...args: unknown[]) => mockFindDuplicateRows(...args)
}));

import ImportStepConfirm from './ImportStepConfirm.svelte';

const testVehicle = { id: 1, name: 'My Honda', make: 'Honda', model: 'Civic', year: 2020 };

function makeContext(): VehiclesContext {
	return {
		get vehicles() {
			return [testVehicle];
		},
		get activeVehicle() {
			return testVehicle;
		},
		get activeVehicleId() {
			return testVehicle.id;
		},
		get loaded() {
			return true;
		},
		switchVehicle: vi.fn(),
		refreshVehicles: vi.fn().mockResolvedValue(undefined)
	};
}

function makeFuelRow(rowNumber: number, status: ImportRow['status'] = 'valid'): ImportRow {
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
			sourceVehicleName: 'TestCar'
		},
		issues: status === 'error' ? ['Missing odometer'] : []
	};
}

function defaultSummary(): ImportDryRunSummary {
	return {
		totalRows: 8,
		validCount: 5,
		warningCount: 2,
		errorCount: 1,
		detectedVehicleNames: ['TestCar'],
		dateRange: { start: new Date(2024, 0, 1), end: new Date(2024, 11, 31) }
	};
}

function defaultAssignments(): VehicleAssignment[] {
	return [
		{
			sourceVehicleName: 'TestCar',
			rowCount: 8,
			assignmentType: 'existing',
			existingVehicleId: 1
		}
	];
}

function defaultRows(): ImportRow[] {
	return [
		...Array.from({ length: 5 }, (_, i) => makeFuelRow(i + 1, 'valid')),
		...Array.from({ length: 2 }, (_, i) => makeFuelRow(i + 6, 'warning')),
		makeFuelRow(8, 'error')
	];
}

function renderConfirm(
	overrides: {
		rows?: ImportRow[];
		summary?: ImportDryRunSummary;
		assignments?: VehicleAssignment[];
		reviewSkippedCount?: number;
		onImportComplete?: (result: ImportCommitResult) => void;
		onImportReset?: () => void;
		ctx?: VehiclesContext;
	} = {}
) {
	const ctx = overrides.ctx ?? makeContext();
	const contextMap = new Map<string, unknown>();
	contextMap.set('vehicles', ctx);
	return render(ImportStepConfirm, {
		props: {
			rows: overrides.rows ?? defaultRows(),
			summary: overrides.summary ?? defaultSummary(),
			assignments: overrides.assignments ?? defaultAssignments(),
			reviewSkippedCount: overrides.reviewSkippedCount ?? 0,
			onImportComplete: overrides.onImportComplete ?? vi.fn(),
			onImportReset: overrides.onImportReset ?? vi.fn()
		},
		context: contextMap
	});
}

describe('ImportStepConfirm', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCommitImportRows.mockImplementation(
			(_rows: unknown, _assignments: unknown, onProgress?: (c: number, t: number) => void) => {
				onProgress?.(1, 1);
				return Promise.resolve({ data: mockCommitResult, error: null } as const);
			}
		);
		mockFindDuplicateRows.mockResolvedValue({
			data: { duplicateRowNumbers: new Set() },
			error: null
		});
	});

	afterEach(() => {
		cleanup();
	});

	it('pre-commit view shows correct row counts (importable, skipped, corrected)', () => {
		renderConfirm();

		// 7 importable (5 valid + 2 warning), 1 skipped (error), 2 corrected (warning)
		expect(screen.getByText(/7 rows will be imported/)).toBeTruthy();
		expect(screen.getByText(/1 row skipped/)).toBeTruthy();
		expect(screen.getByText(/2 rows corrected/)).toBeTruthy();
	});

	it('shows vehicle assignment breakdown', () => {
		renderConfirm();
		expect(screen.getByText(/8 rows → My Honda/)).toBeTruthy();
	});

	it('shows date range', () => {
		renderConfirm();
		expect(screen.getByText(/data spans/i)).toBeTruthy();
	});

	it('shows caution notice', () => {
		renderConfirm();
		expect(screen.getByText(/imported data will appear in your history immediately/i)).toBeTruthy();
	});

	it('Import X Rows button shows correct count', () => {
		renderConfirm();
		const btn = screen.getByTestId('import-btn');
		expect(btn.textContent).toContain('Import 7 Rows');
	});

	it('click Import triggers commit and shows progress', async () => {
		renderConfirm();

		await fireEvent.click(screen.getByTestId('import-btn'));

		// Commit resolves immediately; check that commitImportRows was called
		await waitFor(() => {
			expect(mockCommitImportRows).toHaveBeenCalled();
		});
	});

	it('progress bar updates during commit', async () => {
		let resolveCommit: (value: unknown) => void;
		mockCommitImportRows.mockImplementation(
			(_rows: unknown, _assignments: unknown, onProgress?: (c: number, t: number) => void) => {
				return new Promise((resolve) => {
					resolveCommit = resolve;
					onProgress?.(3, 7);
				});
			}
		);

		renderConfirm();
		await fireEvent.click(screen.getByTestId('import-btn'));

		await waitFor(() => {
			const progressBar = document.querySelector('[role="progressbar"]');
			expect(progressBar).toBeTruthy();
			expect(progressBar?.getAttribute('aria-valuenow')).toBe('3');
			expect(progressBar?.getAttribute('aria-valuemax')).toBe('7');
		});

		// Resolve the commit to clean up
		resolveCommit!({ data: mockCommitResult, error: null });
	});

	it('successful commit shows result screen', async () => {
		renderConfirm();

		await fireEvent.click(screen.getByTestId('import-btn'));

		await waitFor(() => {
			expect(screen.getByText('Import complete')).toBeTruthy();
		});
	});

	it('result screen shows fuel + maintenance counts separately', async () => {
		renderConfirm();

		await fireEvent.click(screen.getByTestId('import-btn'));

		await waitFor(() => {
			expect(screen.getByText(/5 fuel entries imported/)).toBeTruthy();
			expect(screen.getByText(/2 maintenance entries imported/)).toBeTruthy();
		});
	});

	it('result screen shows vehicles created', async () => {
		mockCommitImportRows.mockResolvedValue({
			data: {
				...mockCommitResult,
				vehiclesCreated: ['New Car']
			},
			error: null
		});

		renderConfirm();
		await fireEvent.click(screen.getByTestId('import-btn'));

		await waitFor(() => {
			expect(screen.getByText(/1 vehicle created/)).toBeTruthy();
		});
	});

	it('result screen persists (no auto-navigation)', async () => {
		renderConfirm();
		await fireEvent.click(screen.getByTestId('import-btn'));

		await waitFor(() => {
			expect(screen.getByText('Import complete')).toBeTruthy();
		});

		// No goto should have been called automatically
		expect(mockGoto).not.toHaveBeenCalled();
	});

	it('View imported history navigates to /history', async () => {
		renderConfirm();
		await fireEvent.click(screen.getByTestId('import-btn'));

		await waitFor(() => {
			expect(screen.getByText('Import complete')).toBeTruthy();
		});

		await fireEvent.click(screen.getByText('View imported history'));
		expect(mockGoto).toHaveBeenCalledWith('/history');
	});

	it('View imported history switches to newly created vehicle', async () => {
		const newVehicle = { id: 42, name: 'Imported Car', make: 'Toyota', model: 'Corolla' };
		mockCommitImportRows.mockResolvedValue({
			data: {
				...mockCommitResult,
				vehiclesCreated: ['Imported Car'],
				vehiclesMatched: []
			},
			error: null
		});

		const ctx = makeContext();
		// After refreshVehicles, the new vehicle should be in the list
		(ctx as any)._vehicles = [testVehicle, newVehicle];
		const originalRefresh = ctx.refreshVehicles;
		ctx.refreshVehicles = vi.fn(async () => {
			await originalRefresh();
			Object.defineProperty(ctx, 'vehicles', { get: () => [testVehicle, newVehicle] });
		});

		const newAssignments: VehicleAssignment[] = [
			{
				sourceVehicleName: 'Imported Car',
				rowCount: 5,
				assignmentType: 'new',
				newVehicle: { name: 'Imported Car', make: 'Toyota', model: 'Corolla' }
			}
		];

		renderConfirm({ assignments: newAssignments, ctx });
		await fireEvent.click(screen.getByTestId('import-btn'));

		await waitFor(() => {
			expect(screen.getByText('Import complete')).toBeTruthy();
		});

		await fireEvent.click(screen.getByText('View imported history'));
		expect(ctx.switchVehicle).toHaveBeenCalledWith(42);
		expect(mockGoto).toHaveBeenCalledWith('/history');
	});

	it('Import another file calls onImportReset', async () => {
		const onReset = vi.fn();
		renderConfirm({ onImportReset: onReset });

		await fireEvent.click(screen.getByTestId('import-btn'));

		await waitFor(() => {
			expect(screen.getByText('Import complete')).toBeTruthy();
		});

		await fireEvent.click(screen.getByText('Import another file'));
		expect(onReset).toHaveBeenCalled();
	});

	it('failed commit shows error with retry button', async () => {
		mockCommitImportRows.mockResolvedValue({
			data: null as any,
			error: { code: 'IMPORT_FAILED', message: 'Something went wrong' }
		} as any);

		renderConfirm();
		await fireEvent.click(screen.getByTestId('import-btn'));

		await waitFor(() => {
			expect(screen.getByText('Import failed')).toBeTruthy();
			expect(screen.getByText(/something went wrong/i)).toBeTruthy();
			expect(screen.getByText(/your existing data is unchanged/i)).toBeTruthy();
		});

		expect(screen.getByTestId('retry-btn')).toBeTruthy();
	});

	it('retry button re-triggers commit', async () => {
		// First call fails
		mockCommitImportRows
			.mockResolvedValueOnce({
				data: null as any,
				error: { code: 'IMPORT_FAILED', message: 'Failed' }
			} as any)
			// Second call succeeds
			.mockResolvedValueOnce({
				data: mockCommitResult,
				error: null
			} as any);

		renderConfirm();
		await fireEvent.click(screen.getByTestId('import-btn'));

		await waitFor(() => {
			expect(screen.getByTestId('retry-btn')).toBeTruthy();
		});

		await fireEvent.click(screen.getByTestId('retry-btn'));

		await waitFor(() => {
			expect(screen.getByText('Import complete')).toBeTruthy();
		});

		expect(mockCommitImportRows).toHaveBeenCalledTimes(2);
	});

	it('ARIA: progress bar has correct role and values', async () => {
		let resolveCommit: (value: unknown) => void;
		mockCommitImportRows.mockImplementation(
			(_rows: unknown, _assignments: unknown, onProgress?: (c: number, t: number) => void) => {
				return new Promise((resolve) => {
					resolveCommit = resolve;
					onProgress?.(5, 10);
				});
			}
		);

		renderConfirm();
		await fireEvent.click(screen.getByTestId('import-btn'));

		await waitFor(() => {
			const progressBar = document.querySelector('[role="progressbar"]');
			expect(progressBar).toBeTruthy();
			expect(progressBar?.getAttribute('aria-valuemin')).toBe('0');
			expect(progressBar?.getAttribute('aria-valuenow')).toBe('5');
			expect(progressBar?.getAttribute('aria-valuemax')).toBe('10');
		});

		resolveCommit!({ data: mockCommitResult, error: null });
	});

	describe('duplicate detection (Story 8.3 AC1)', () => {
		it('surfaces a keep/skip choice before the final commit trigger when duplicates are found', async () => {
			mockFindDuplicateRows.mockResolvedValue({
				data: { duplicateRowNumbers: new Set([1, 2]) },
				error: null
			});

			renderConfirm();

			await waitFor(() => {
				expect(screen.getByText(/possible duplicates found/i)).toBeTruthy();
				expect(screen.getByText(/2 rows match entries already in your data/i)).toBeTruthy();
			});
		});

		it('"Import anyway" keeps all rows and commits the full set unmodified', async () => {
			mockFindDuplicateRows.mockResolvedValue({
				data: { duplicateRowNumbers: new Set([1]) },
				error: null
			});

			renderConfirm();

			await waitFor(() => screen.getByTestId('duplicate-keep-btn'));
			await fireEvent.click(screen.getByTestId('duplicate-keep-btn'));

			await waitFor(() => {
				expect(screen.getByTestId('import-btn')).toBeTruthy();
			});
			await fireEvent.click(screen.getByTestId('import-btn'));

			await waitFor(() => {
				expect(mockCommitImportRows).toHaveBeenCalled();
			});
			const [committedRows, , , externalSkippedCount] = mockCommitImportRows.mock.calls[0];
			expect(committedRows).toHaveLength(8); // full defaultRows() set, nothing excluded
			expect(externalSkippedCount).toBe(0);
		});

		it('"Skip duplicates" excludes the flagged rows and folds their count into externalSkippedCount', async () => {
			mockFindDuplicateRows.mockResolvedValue({
				data: { duplicateRowNumbers: new Set([1, 2]) },
				error: null
			});

			renderConfirm();

			await waitFor(() => screen.getByTestId('duplicate-skip-btn'));
			await fireEvent.click(screen.getByTestId('duplicate-skip-btn'));

			await waitFor(() => {
				expect(screen.getByTestId('import-btn')).toBeTruthy();
			});
			await fireEvent.click(screen.getByTestId('import-btn'));

			await waitFor(() => {
				expect(mockCommitImportRows).toHaveBeenCalled();
			});
			const [committedRows, , , externalSkippedCount] = mockCommitImportRows.mock.calls[0];
			expect(committedRows.map((r: ImportRow) => r.rowNumber)).not.toContain(1);
			expect(committedRows.map((r: ImportRow) => r.rowNumber)).not.toContain(2);
			expect(committedRows).toHaveLength(6);
			expect(externalSkippedCount).toBe(2);
		});

		it('does not surface the duplicate panel when no duplicates are found', async () => {
			renderConfirm();

			await waitFor(() => {
				expect(screen.getByTestId('import-btn')).toBeTruthy();
			});
			expect(screen.queryByText(/possible duplicates found/i)).toBeNull();
		});
	});
});
