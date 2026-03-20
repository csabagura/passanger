import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { ImportRow, ImportDryRunSummary } from '$lib/utils/importTypes';
import ImportStepReview from './ImportStepReview.svelte';

function createValidRow(rowNumber: number, overrides?: Partial<ImportRow>): ImportRow {
	return {
		rowNumber,
		status: 'valid',
		data: {
			date: new Date(2024, 0, rowNumber),
			odometer: 10000 + rowNumber * 100,
			quantity: 40 + rowNumber,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 60 + rowNumber,
			notes: '',
			type: 'fuel',
			sourceVehicleName: 'TestCar'
		},
		issues: [],
		...overrides
	};
}

function createErrorRow(rowNumber: number, overrides?: Partial<ImportRow>): ImportRow {
	return {
		rowNumber,
		status: 'error',
		data: {
			date: new Date(2024, 2, 15),
			odometer: undefined,
			quantity: 42.5,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 62.3,
			notes: 'Highway trip',
			type: 'fuel',
			sourceVehicleName: 'TestCar'
		},
		issues: ['Missing odometer reading'],
		...overrides
	};
}

function createWarningRow(rowNumber: number, overrides?: Partial<ImportRow>): ImportRow {
	return {
		rowNumber,
		status: 'warning',
		data: {
			date: new Date(2024, 2, 20),
			odometer: 15000,
			quantity: 35,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 0,
			notes: '',
			type: 'fuel',
			sourceVehicleName: 'TestCar'
		},
		issues: ['Cost is zero \u2014 is this correct?'],
		...overrides
	};
}

function createSummary(rows: ImportRow[]): ImportDryRunSummary {
	let validCount = 0;
	let warningCount = 0;
	let errorCount = 0;
	for (const row of rows) {
		if (row.status === 'valid') validCount++;
		else if (row.status === 'warning') warningCount++;
		else if (row.status === 'error') errorCount++;
	}
	return {
		totalRows: rows.length,
		validCount,
		warningCount,
		errorCount,
		detectedVehicleNames: ['TestCar'],
		dateRange: { start: new Date(2024, 0, 1), end: new Date(2024, 2, 20) }
	};
}

describe('ImportStepReview', () => {
	let onReviewConfirmed: ReturnType<typeof vi.fn<(data: { rows: ImportRow[]; summary: ImportDryRunSummary }) => void>>;

	beforeEach(() => {
		onReviewConfirmed = vi.fn<(data: { rows: ImportRow[]; summary: ImportDryRunSummary }) => void>();
	});

	afterEach(() => {
		cleanup();
	});

	describe('Auto-skip behavior', () => {
		it('calls onReviewConfirmed immediately when all rows are valid', async () => {
			const rows = [createValidRow(1), createValidRow(2), createValidRow(3)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			await waitFor(() => {
				expect(onReviewConfirmed).toHaveBeenCalledOnce();
			});

			const call = onReviewConfirmed.mock.calls[0][0];
			expect(call.rows).toHaveLength(3);
		});
	});

	describe('Collapsed card rendering', () => {
		it('renders only flagged rows (filters out valid)', () => {
			const rows = [
				createValidRow(1),
				createErrorRow(2),
				createWarningRow(3),
				createValidRow(4)
			];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Should show 2 flagged rows, not 4
			const cards = screen.getAllByTestId(/^review-card-/);
			expect(cards).toHaveLength(2);
		});

		it('shows summary strip with correct counts', () => {
			const rows = [createValidRow(1), createErrorRow(2), createWarningRow(3)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			const summaryEl = screen.getByTestId('review-summary');
			expect(summaryEl.textContent).toContain('2 rows need attention');
		});

		it('shows severity badge [!] for error rows', () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			const card = screen.getByTestId('review-card-2');
			expect(card.textContent).toContain('[!]');
			expect(card.textContent).toContain('Row 2');
		});

		it('shows severity badge [\u26A0] for warning rows', () => {
			const rows = [createWarningRow(3)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			const card = screen.getByTestId('review-card-3');
			expect(card.textContent).toContain('[\u26A0]');
			expect(card.textContent).toContain('Row 3');
		});

		it('shows issue label on collapsed card', () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			expect(screen.getByTestId('review-card-2').textContent).toContain(
				'Missing odometer reading'
			);
		});

		it('shows "X issues" when row has multiple issues', () => {
			const row = createErrorRow(2, {
				issues: ['Missing odometer reading', 'Missing fuel quantity'],
				data: {
					date: new Date(2024, 2, 15),
					odometer: undefined,
					quantity: undefined,
					unit: 'L',
					distanceUnit: 'km',
					totalCost: 10,
					notes: '',
					type: 'fuel'
				}
			});
			const rows = [row];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			expect(screen.getByTestId('review-card-2').textContent).toContain('2 issues');
		});

		it('shows date in data summary', () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			expect(screen.getByTestId('review-card-2').textContent).toContain('2024-03-15');
		});
	});

	describe('Expanded card — inline editing', () => {
		it('expands card when Edit is clicked', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			const editBtn = screen.getByRole('button', { name: /edit row 2/i });
			await fireEvent.click(editBtn);

			const expandedContent = document.getElementById('review-row-2');
			expect(expandedContent).toBeTruthy();
		});

		it('shows editable input for invalid fields only', async () => {
			const rows = [createErrorRow(2)]; // odometer is invalid
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));

			// Odometer should be an input (invalid)
			const odometerInput = document.getElementById(
				'field-2-odometer'
			) as HTMLInputElement | null;
			expect(odometerInput).toBeTruthy();
			expect(odometerInput?.tagName).toBe('INPUT');

			// Date should be static text with (valid) — check for the valid label
			const expandedContent = document.getElementById('review-row-2');
			expect(expandedContent?.textContent).toContain('(valid)');
		});

		it('accordion behavior: expanding one card collapses the other', async () => {
			const rows = [createErrorRow(2), createWarningRow(3)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Expand first card
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			expect(document.getElementById('review-row-2')).toBeTruthy();

			// Expand second card
			await fireEvent.click(screen.getByRole('button', { name: /edit row 3/i }));
			expect(document.getElementById('review-row-3')).toBeTruthy();
			expect(document.getElementById('review-row-2')).toBeNull();
		});

		it('correcting a field clears its error on blur', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));

			const odometerInput = document.getElementById(
				'field-2-odometer'
			) as HTMLInputElement;
			expect(odometerInput).toBeTruthy();

			// Type a valid value
			await fireEvent.input(odometerInput, { target: { value: '50000' } });
			await fireEvent.blur(odometerInput);

			// Error should be cleared
			await waitFor(() => {
				expect(odometerInput.getAttribute('aria-invalid')).toBeNull();
			});
		});

		it('Save Corrections collapses card with Corrected badge', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));

			// Fix the odometer
			const odometerInput = document.getElementById(
				'field-2-odometer'
			) as HTMLInputElement;
			await fireEvent.input(odometerInput, { target: { value: '50000' } });
			await fireEvent.blur(odometerInput);

			// Save corrections
			await fireEvent.click(screen.getByRole('button', { name: /save corrections/i }));

			// Card should collapse and show Corrected badge
			await waitFor(() => {
				expect(document.getElementById('review-row-2')).toBeNull();
				expect(screen.getByTestId('review-card-2').textContent).toContain('Corrected');
			});
		});

		it('Skip This Row collapses card with Skipped badge and strikethrough', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			await fireEvent.click(screen.getByRole('button', { name: /skip this row/i }));

			await waitFor(() => {
				const card = screen.getByTestId('review-card-2');
				expect(card.textContent).toContain('Skipped');
				// Check for strikethrough via line-through class
				expect(card.innerHTML).toContain('line-through');
			});
		});

		it('un-skip re-enables the row', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Expand and skip
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			await fireEvent.click(screen.getByRole('button', { name: /skip this row/i }));

			// Re-expand (button should say Undo for skipped rows)
			await waitFor(() => {
				expect(screen.getByTestId('review-card-2').textContent).toContain('Skipped');
			});

			// Click Undo to expand (aria-label adapts to skipped state)
			const undoBtn = screen.getByRole('button', { name: /undo skip for row 2/i });
			await fireEvent.click(undoBtn);

			// Should show Include This Row option
			await waitFor(() => {
				expect(screen.getByRole('button', { name: /include this row/i })).toBeTruthy();
			});

			await fireEvent.click(screen.getByRole('button', { name: /include this row/i }));

			// Should no longer be skipped
			await waitFor(() => {
				expect(screen.getByTestId('review-card-2').textContent).not.toContain('Skipped');
			});
		});
	});

	describe('Skip all remaining', () => {
		it('marks all pending rows as skipped', async () => {
			const rows = [createErrorRow(2), createWarningRow(3)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			await fireEvent.click(screen.getByRole('button', { name: /skip all remaining/i }));

			await waitFor(() => {
				expect(screen.getByTestId('review-card-2').textContent).toContain('Skipped');
				expect(screen.getByTestId('review-card-3').textContent).toContain('Skipped');
			});
		});
	});

	describe('Primary action button', () => {
		it('Assign Vehicles is disabled until all rows reviewed', () => {
			const rows = [createErrorRow(2), createWarningRow(3)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			const btn = screen.getByTestId('assign-vehicles-btn');
			expect(btn.hasAttribute('disabled')).toBe(true);
		});

		it('Assign Vehicles is enabled when all rows reviewed', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Skip the row
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			await fireEvent.click(screen.getByRole('button', { name: /skip this row/i }));

			await waitFor(() => {
				const btn = screen.getByTestId('assign-vehicles-btn');
				expect(btn.hasAttribute('disabled')).toBe(false);
			});
		});

		it('clicking Assign Vehicles calls onReviewConfirmed with updated rows', async () => {
			const rows = [createValidRow(1), createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Skip the error row
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			await fireEvent.click(screen.getByRole('button', { name: /skip this row/i }));

			await waitFor(() => {
				const btn = screen.getByTestId('assign-vehicles-btn');
				expect(btn.hasAttribute('disabled')).toBe(false);
			});

			await fireEvent.click(screen.getByTestId('assign-vehicles-btn'));

			expect(onReviewConfirmed).toHaveBeenCalledOnce();
			const call = onReviewConfirmed.mock.calls[0][0];
			// Skipped row should be filtered out
			expect(call.rows).toHaveLength(1);
			expect(call.rows[0].rowNumber).toBe(1);
		});

		it('corrected rows get updated data in final output', async () => {
			const rows = [createErrorRow(2)]; // missing odometer
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Expand and fix
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			const odometerInput = document.getElementById(
				'field-2-odometer'
			) as HTMLInputElement;
			await fireEvent.input(odometerInput, { target: { value: '50000' } });
			await fireEvent.blur(odometerInput);
			await fireEvent.click(screen.getByRole('button', { name: /save corrections/i }));

			await waitFor(() => {
				const btn = screen.getByTestId('assign-vehicles-btn');
				expect(btn.hasAttribute('disabled')).toBe(false);
			});

			await fireEvent.click(screen.getByTestId('assign-vehicles-btn'));

			expect(onReviewConfirmed).toHaveBeenCalledOnce();
			const call = onReviewConfirmed.mock.calls[0][0];
			expect(call.rows).toHaveLength(1);
			expect(call.rows[0].data.odometer).toBe(50000);
		});
	});

	describe('Focus management', () => {
		it('focuses first invalid input when card expands', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));

			await waitFor(() => {
				const odometerInput = document.getElementById('field-2-odometer');
				expect(document.activeElement).toBe(odometerInput);
			});
		});
	});

	describe('ARIA attributes', () => {
		it('Edit button has aria-expanded and aria-controls', () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			const btn = screen.getByRole('button', { name: /edit row 2/i });
			expect(btn.getAttribute('aria-expanded')).toBe('false');
			expect(btn.getAttribute('aria-controls')).toBe('review-row-2');
		});

		it('aria-expanded toggles when card opens', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			const btn = screen.getByRole('button', { name: /edit row 2/i });
			await fireEvent.click(btn);

			expect(btn.getAttribute('aria-expanded')).toBe('true');
		});

		it('invalid inputs have aria-invalid and aria-describedby', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));

			// Initially the input is blank — blur to trigger validation
			const odometerInput = document.getElementById(
				'field-2-odometer'
			) as HTMLInputElement;
			await fireEvent.blur(odometerInput);

			await waitFor(() => {
				expect(odometerInput.getAttribute('aria-invalid')).toBe('true');
				expect(odometerInput.getAttribute('aria-describedby')).toBe('error-2-odometer');
			});
		});

		it('error messages have role="alert"', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));

			// Blur the empty input to trigger error
			const odometerInput = document.getElementById(
				'field-2-odometer'
			) as HTMLInputElement;
			await fireEvent.blur(odometerInput);

			await waitFor(() => {
				const errorEl = document.getElementById('error-2-odometer');
				expect(errorEl).toBeTruthy();
				expect(errorEl?.getAttribute('role')).toBe('alert');
			});
		});

		it('summary strip has aria-live="polite"', () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			const summaryEl = screen.getByTestId('review-summary');
			expect(summaryEl.getAttribute('aria-live')).toBe('polite');
		});

		it('announcements region has aria-live="polite"', () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			const announcementEl = screen.getByTestId('review-announcements');
			expect(announcementEl.getAttribute('aria-live')).toBe('polite');
		});
	});

	describe('Maintenance rows', () => {
		it('does not show quantity field for maintenance rows', async () => {
			const maintenanceRow: ImportRow = {
				rowNumber: 5,
				status: 'warning',
				data: {
					date: new Date(2024, 3, 1),
					odometer: 20000,
					quantity: 0,
					unit: 'L',
					distanceUnit: 'km',
					totalCost: 0,
					notes: 'Oil change',
					type: 'maintenance',
					maintenanceType: 'Oil Change'
				},
				issues: ['Cost is zero \u2014 is this correct?']
			};
			const rows = [maintenanceRow];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			await fireEvent.click(screen.getByRole('button', { name: /edit row 5/i }));

			// Should not have quantity field
			expect(document.getElementById('field-5-quantity')).toBeNull();
			// But should have cost field
			const expandedContent = document.getElementById('review-row-5');
			expect(expandedContent?.textContent).toContain('Cost');
		});
	});

	describe('Summary updates', () => {
		it('shows reviewed progress count after corrections', async () => {
			const rows = [createErrorRow(2), createWarningRow(3)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Skip first row
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			await fireEvent.click(screen.getByRole('button', { name: /skip this row/i }));

			await waitFor(() => {
				const summaryEl = screen.getByTestId('review-summary');
				expect(summaryEl.textContent).toContain('1 of 2 reviewed');
			});
		});

		it('shows per-status breakdowns after corrections (AC 10)', async () => {
			const rows = [
				createValidRow(1),
				createErrorRow(2),
				createWarningRow(3)
			];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Skip the error row
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			await fireEvent.click(screen.getByRole('button', { name: /skip this row/i }));

			await waitFor(() => {
				const countsEl = screen.getByTestId('review-status-counts');
				expect(countsEl.textContent).toContain('1 valid');
				expect(countsEl.textContent).toContain('1 warning');
				expect(countsEl.textContent).toContain('0 error');
				expect(countsEl.textContent).toContain('1 skipped');
			});
		});

		it('updates per-status breakdowns when row is corrected (AC 10)', async () => {
			const rows = [createValidRow(1), createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Fix the error row
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			const odometerInput = document.getElementById('field-2-odometer') as HTMLInputElement;
			await fireEvent.input(odometerInput, { target: { value: '50000' } });
			await fireEvent.blur(odometerInput);
			await fireEvent.click(screen.getByRole('button', { name: /save corrections/i }));

			await waitFor(() => {
				const countsEl = screen.getByTestId('review-status-counts');
				expect(countsEl.textContent).toContain('2 valid');
				expect(countsEl.textContent).toContain('0 error');
				expect(countsEl.textContent).toContain('0 skipped');
			});
		});
	});

	describe('aria-label adaptation (AC 5)', () => {
		it('aria-label says "Undo skip" for skipped rows', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Expand and skip
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			await fireEvent.click(screen.getByRole('button', { name: /skip this row/i }));

			await waitFor(() => {
				const btn = screen.getByRole('button', { name: /undo skip for row 2/i });
				expect(btn).toBeTruthy();
				expect(btn.getAttribute('aria-label')).toBe('Undo skip for Row 2');
			});
		});

		it('aria-label reverts to "Edit Row" after un-skip', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Skip
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			await fireEvent.click(screen.getByRole('button', { name: /skip this row/i }));

			// Un-skip
			await waitFor(() => {
				expect(screen.getByRole('button', { name: /undo skip for row 2/i })).toBeTruthy();
			});
			await fireEvent.click(screen.getByRole('button', { name: /undo skip for row 2/i }));
			await fireEvent.click(screen.getByRole('button', { name: /include this row/i }));

			await waitFor(() => {
				const btn = screen.getByRole('button', { name: /edit row 2/i });
				expect(btn.getAttribute('aria-label')).toContain('Edit Row 2');
			});
		});
	});

	describe('Focus management after save/skip', () => {
		it('focus moves to next card Edit button after save', async () => {
			const rows = [createErrorRow(2), createWarningRow(3)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Expand and fix row 2
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			const odometerInput = document.getElementById('field-2-odometer') as HTMLInputElement;
			await fireEvent.input(odometerInput, { target: { value: '50000' } });
			await fireEvent.blur(odometerInput);
			await fireEvent.click(screen.getByRole('button', { name: /save corrections/i }));

			// Focus should move to next card's Edit button (row 3)
			await waitFor(() => {
				const nextBtn = screen.getByRole('button', { name: /edit row 3/i });
				expect(document.activeElement).toBe(nextBtn);
			});
		});

		it('focus moves to next card Edit button after skip', async () => {
			const rows = [createErrorRow(2), createWarningRow(3)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Expand and skip row 2
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			await fireEvent.click(screen.getByRole('button', { name: /skip this row/i }));

			// Focus should move to next card's Edit button (row 3)
			await waitFor(() => {
				const nextBtn = screen.getByRole('button', { name: /edit row 3/i });
				expect(document.activeElement).toBe(nextBtn);
			});
		});

		it('focus moves to Assign Vehicles after last card is resolved', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);

			render(ImportStepReview, {
				props: { rows, summary, onReviewConfirmed }
			});

			// Expand and skip the only row
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			await fireEvent.click(screen.getByRole('button', { name: /skip this row/i }));

			// Focus should move to Assign Vehicles button
			await waitFor(() => {
				const primaryBtn = screen.getByTestId('assign-vehicles-btn');
				expect(document.activeElement).toBe(primaryBtn);
			});
		});
	});

	describe('Review state preservation (AC 9)', () => {
		it('restores review state from initialReviewEntries', () => {
			const rows = [createErrorRow(2), createWarningRow(3)];
			const summary = createSummary(rows);

			const initialEntries: [number, { status: 'pending' | 'corrected' | 'skipped'; correctedData: Record<string, unknown>; correctedIssues: string[]; correctedStatus: 'valid' | 'warning' | 'error' }][] = [
				[2, { status: 'skipped', correctedData: {}, correctedIssues: ['Missing odometer reading'], correctedStatus: 'error' }],
				[3, { status: 'corrected', correctedData: { totalCost: 50 }, correctedIssues: [], correctedStatus: 'valid' }]
			];

			render(ImportStepReview, {
				props: {
					rows,
					summary,
					onReviewConfirmed,
					initialReviewEntries: initialEntries as [number, { status: 'pending' | 'corrected' | 'skipped'; correctedData: Record<string, unknown>; correctedIssues: string[]; correctedStatus: 'valid' | 'warning' | 'error' }][]
				}
			});

			// Row 2 should show Skipped badge
			const card2 = screen.getByTestId('review-card-2');
			expect(card2.textContent).toContain('Skipped');

			// Row 3 should show Corrected badge
			const card3 = screen.getByTestId('review-card-3');
			expect(card3.textContent).toContain('Corrected');

			// All rows reviewed → Assign Vehicles enabled
			const btn = screen.getByTestId('assign-vehicles-btn');
			expect(btn.hasAttribute('disabled')).toBe(false);
		});

		it('calls onReviewStateChanged when review state changes', async () => {
			const rows = [createErrorRow(2)];
			const summary = createSummary(rows);
			const onStateChanged = vi.fn();

			render(ImportStepReview, {
				props: {
					rows,
					summary,
					onReviewConfirmed,
					onReviewStateChanged: onStateChanged
				}
			});

			// Skip the row
			await fireEvent.click(screen.getByRole('button', { name: /edit row 2/i }));
			await fireEvent.click(screen.getByRole('button', { name: /skip this row/i }));

			await waitFor(() => {
				expect(onStateChanged).toHaveBeenCalled();
				const entries = onStateChanged.mock.calls[onStateChanged.mock.calls.length - 1][0];
				const entry = entries.find((e: [number, unknown]) => e[0] === 2);
				expect(entry).toBeTruthy();
				expect(entry[1].status).toBe('skipped');
			});
		});
	});
});
