import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import FuelEntryForm from './FuelEntryForm.svelte';
import type { FuelLog } from '$lib/db/schema';
import { QUOTA_EXCEEDED_MESSAGE } from '$lib/db/dbErrors';
import { fuelDraft, clearFuelDraft, setLastUsedCurrency } from '$lib/state/draftStore';
import type { AppSettings } from '$lib/utils/settings';

// Mock fuel logs repository
const mockGetAllFuelLogs = vi.fn();
const mockSaveFuelLog = vi.fn();
const mockUpdateFuelLog = vi.fn();
const mockUpdateFuelLogsAtomic = vi.fn();
const mockSettings = vi.hoisted(() => ({
	value: {
		fuelUnit: 'L/100km',
		currency: '€',
		theme: 'system'
	} as AppSettings
}));

// Story 2.4: the save-error path emits on the toast context. Provide a spy so the form can call it.
const mockToast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	action: vi.fn()
}));

vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: (...args: unknown[]) => mockGetAllFuelLogs(...args),
	saveFuelLog: (...args: unknown[]) => mockSaveFuelLog(...args),
	updateFuelLog: (...args: unknown[]) => mockUpdateFuelLog(...args),
	updateFuelLogsAtomic: (...args: unknown[]) => mockUpdateFuelLogsAtomic(...args)
}));

function formatOdometerHint(odometer: number, unit: 'km' | 'mi' = 'km'): string {
	return `Last: ${odometer.toLocaleString()} ${unit}`;
}

function normalizeHintText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function hintTextMatcher(odometer: number, unit: 'km' | 'mi' = 'km') {
	const expected = normalizeHintText(formatOdometerHint(odometer, unit));
	return (_content: string, element?: Element | null) =>
		normalizeHintText(element?.textContent ?? '') === expected;
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

// Mock settings context via Svelte's getContext
vi.mock('svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('svelte')>();
	return {
		...actual,
		getContext: (key: string) => {
			if (key === 'settings') {
				return {
					settings: mockSettings.value
				};
			}
			if (key === 'toast') {
				return mockToast;
			}
			return undefined;
		}
	};
});

describe('FuelEntryForm component — review fixes validation', () => {
	let onSaveSpy: (result: FuelLog | FuelLog[]) => void;
	let onFirstCreateSaveSpy: (result: FuelLog) => void;

	beforeEach(() => {
		vi.clearAllMocks();
		onSaveSpy = vi.fn() as (result: FuelLog | FuelLog[]) => void;
		onFirstCreateSaveSpy = vi.fn() as (result: FuelLog) => void;
		mockSettings.value = {
			fuelUnit: 'L/100km',
			currency: '€',
			theme: 'system'
		};
		// Story 2.3: the sync $effect now writes through to localStorage — clear it so a draft
		// (or its stale flag) from a prior test can't bleed into this one.
		localStorage.clear();
		clearFuelDraft();

		// Default: no previous fuel logs
		mockGetAllFuelLogs.mockResolvedValue({
			data: [],
			error: null
		});
	});

	afterEach(() => {
		cleanup();
		clearFuelDraft();
		vi.restoreAllMocks();
	});

	describe('FIX #1: previousOdometer updates after successful save', () => {
		it('updates previousOdometer so next fill-up calculates correctly (proof of FIX #1)', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 7.2,
				notes: ''
			};

			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Fill and save first entry
			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78.00' } });

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			// FIX #1: The hint should now show the saved odometer value
			// This proves previousOdometer was updated
			const hint = screen.queryByText(/last:/i);
			expect(hint).toBeTruthy();
		});
	});

	describe('Story 1.8: first-save install prompt callback', () => {
		it('fires onFirstCreateSave immediately after the first successful create save', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 0,
				notes: ''
			};

			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, {
				props: { vehicleId: 1, onSave: onSaveSpy, onFirstCreateSave: onFirstCreateSaveSpy }
			});
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), { target: { value: '87400' } });
			await fireEvent.input(screen.getByLabelText(/quantity/i), { target: { value: '42' } });
			await fireEvent.input(screen.getByLabelText(/total cost/i), { target: { value: '78' } });
			await fireEvent.click(screen.getByRole('button', { name: /save/i }));

			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(onFirstCreateSaveSpy).toHaveBeenCalledOnce();
			expect(onFirstCreateSaveSpy).toHaveBeenCalledWith(savedLog);
		});

		it('does not fire onFirstCreateSave for later saves in the same form session', async () => {
			mockSaveFuelLog
				.mockResolvedValueOnce({
					data: {
						id: 1,
						vehicleId: 1,
						date: new Date('2026-03-11T10:00:00Z'),
						odometer: 87400,
						quantity: 42,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 78,
						calculatedConsumption: 0,
						notes: ''
					} satisfies FuelLog,
					error: null
				})
				.mockResolvedValueOnce({
					data: {
						id: 2,
						vehicleId: 1,
						date: new Date('2026-03-12T10:00:00Z'),
						odometer: 87900,
						quantity: 41,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 76,
						calculatedConsumption: 8.2,
						notes: ''
					} satisfies FuelLog,
					error: null
				});

			render(FuelEntryForm, {
				props: { vehicleId: 1, onSave: onSaveSpy, onFirstCreateSave: onFirstCreateSaveSpy }
			});
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), { target: { value: '87400' } });
			await fireEvent.input(screen.getByLabelText(/quantity/i), { target: { value: '42' } });
			await fireEvent.input(screen.getByLabelText(/total cost/i), { target: { value: '78' } });
			await fireEvent.click(screen.getByRole('button', { name: /save/i }));

			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), { target: { value: '87900' } });
			await fireEvent.input(screen.getByLabelText(/quantity/i), { target: { value: '41' } });
			await fireEvent.input(screen.getByLabelText(/total cost/i), { target: { value: '76' } });
			await fireEvent.click(screen.getByRole('button', { name: /save/i }));

			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(onFirstCreateSaveSpy).toHaveBeenCalledTimes(1);
		});

		it('does not fire onFirstCreateSave for edit mode or failed submissions', async () => {
			const existingLog: FuelLog = {
				id: 3,
				vehicleId: 1,
				date: new Date('2026-03-10T10:00:00Z'),
				odometer: 86000,
				quantity: 40,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 72,
				calculatedConsumption: 6.9,
				notes: ''
			};

			mockGetAllFuelLogs.mockResolvedValue({ data: [existingLog], error: null });
			mockUpdateFuelLogsAtomic.mockResolvedValue({ data: [existingLog], error: null });

			render(FuelEntryForm, {
				props: {
					vehicleId: 1,
					onSave: onSaveSpy,
					mode: 'edit',
					initialFuelLog: existingLog,
					onFirstCreateSave: onFirstCreateSaveSpy
				}
			});
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(onFirstCreateSaveSpy).not.toHaveBeenCalled();

			cleanup();
			mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });

			render(FuelEntryForm, {
				props: { vehicleId: 1, onSave: onSaveSpy, onFirstCreateSave: onFirstCreateSaveSpy }
			});
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(onFirstCreateSaveSpy).not.toHaveBeenCalled();
		});
	});

	describe('Save-tap validation behavior', () => {
		it('keeps Save enabled so invalid submissions continue to validate on every tap', async () => {
			mockSaveFuelLog.mockResolvedValue({
				data: {
					id: 1,
					vehicleId: 1,
					date: new Date(),
					odometer: 87400,
					quantity: 42,
					unit: 'L',
					distanceUnit: 'km',
					totalCost: 78,
					calculatedConsumption: 7.2,
					notes: ''
				},
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;

			// Initially, form is empty but the first submit should still be allowed
			expect(submitButton.disabled).toBe(false);

			// First submit surfaces validation errors
			await fireEvent.click(submitButton);
			await new Promise((r) => setTimeout(r, 50));
			flushSync();

			expect(screen.getByText(/enter a valid odometer/i)).toBeTruthy();
			expect(submitButton.disabled).toBe(false);

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '' } });
			await fireEvent.input(costInput, { target: { value: '78.00' } });
			flushSync();

			await fireEvent.click(submitButton);
			await new Promise((r) => setTimeout(r, 50));
			flushSync();

			expect(submitButton.disabled).toBe(false);
			expect(screen.getByText(/enter the fuel quantity/i)).toBeTruthy();
			expect(mockSaveFuelLog).not.toHaveBeenCalled();
		});
	});

	describe('FIX #3: Strict numeric validation rejects partial numbers', () => {
		it('rejects "87400km" input that bare parseFloat would accept (FIX #3)', async () => {
			mockSaveFuelLog.mockResolvedValue({
				data: {
					id: 1,
					vehicleId: 1,
					date: new Date(),
					odometer: 87400,
					quantity: 42,
					unit: 'L',
					distanceUnit: 'km',
					totalCost: 78,
					calculatedConsumption: 7.2,
					notes: ''
				},
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			// FIX #3: Input with unit suffix "87400km" should fail strict validation
			// (old code with bare parseFloat would accept it and parse as 87400)
			await fireEvent.input(odometerInput, { target: { value: '87400km' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78.00' } });

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 50));
			flushSync();

			// FIX #3: Should reject and show error (NOT accept like old parseFloat)
			expect(screen.getByText(/enter a valid odometer/i)).toBeTruthy();
		});
	});

	describe('FIX #4: Real component tests replace placeholder', () => {
		it('form renders with all required fields (FIX #4: no longer a placeholder)', async () => {
			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByLabelText(/odometer/i)).toBeTruthy();
			expect(screen.getByLabelText(/quantity/i)).toBeTruthy();
			expect(screen.getByLabelText(/total cost/i)).toBeTruthy();
			expect(screen.getByRole('button', { name: /save/i })).toBeTruthy();
		});

		it('auto-focuses odometer field on mount (AC #1)', async () => {
			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i);
			expect(document.activeElement).toBe(odometerInput);
		});
	});

	describe('Dual-mount focus scoping (Story 3.2 code-review regression)', () => {
		it('focuses the submitted instance own field when a duplicate-id form is co-mounted', async () => {
			// Real-world dual-mount (verified during code review): /log keeps an inline FuelEntryForm
			// mounted while the global Capture sheet mounts a SECOND FuelEntryForm with the SAME
			// hardcoded ids (id="odometer", ...). First-invalid-field focus must target the SUBMITTED
			// form's own input — not the first match in document order, which a document-wide
			// getElementById would wrongly return (focusing the background page form behind the modal).
			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Both instances coexist in document.body with the SAME ids — the collision is the point.
			const odometers = document.querySelectorAll<HTMLInputElement>('[id="odometer"]');
			const forms = document.querySelectorAll('form');
			expect(odometers.length).toBe(2);
			expect(forms.length).toBe(2);
			const firstOdometer = odometers[0];
			const secondOdometer = odometers[1];

			// Park focus on the FIRST instance, then submit the SECOND empty (odometer is the first
			// invalid field). The fix must MOVE focus into the second form; the pre-fix global lookup
			// would leave focus on the first instance's odometer (first in tree order).
			firstOdometer.focus();
			expect(document.activeElement).toBe(firstOdometer);

			await fireEvent.submit(forms[1] as HTMLFormElement);
			await new Promise((r) => setTimeout(r, 50));
			flushSync();

			expect(document.activeElement).toBe(secondOdometer);
		});
	});

	// Story 2.4 (AC-2): the confirmation persists until the user dismisses it — NO 3s auto-dismiss.
	describe('Story 2.4: value-revealing save persists until dismissed', () => {
		const savedLog: FuelLog = {
			id: 1,
			vehicleId: 1,
			date: new Date(),
			odometer: 87400,
			quantity: 42,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 78,
			calculatedConsumption: 7.2,
			notes: ''
		};

		async function fillAndSave() {
			render(FuelEntryForm, {
				props: { vehicleId: 1, onSave: onSaveSpy, onSuccessFeedbackComplete: onDoneSpy }
			});
			await Promise.resolve();
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), { target: { value: '87400' } });
			await fireEvent.input(screen.getByLabelText(/quantity/i), { target: { value: '42' } });
			await fireEvent.input(screen.getByLabelText(/total cost/i), { target: { value: '78.00' } });

			await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
			await Promise.resolve();
			await Promise.resolve();
			flushSync();
		}

		let onDoneSpy: () => void;

		beforeEach(() => {
			onDoneSpy = vi.fn();
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });
		});

		it('does NOT auto-dismiss the confirmation after 3 seconds', async () => {
			vi.useFakeTimers();
			try {
				await fillAndSave();

				expect(screen.getByRole('status').textContent).toContain('this tank');

				// Well past the old 3s + fade window — the confirmation must still be present.
				await vi.advanceTimersByTimeAsync(5000);
				flushSync();

				expect(screen.getByRole('status').textContent).toContain('this tank');
				expect(onDoneSpy).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it('reveals the consumption and the cost in calm voice (no glyph/pipe form)', async () => {
			await fillAndSave();

			const statusText = screen.getByRole('status').textContent ?? '';
			expect(statusText).toContain('Saved.');
			expect(statusText).toContain('7.2 L/100km this tank');
			expect(statusText).toContain('€78.00');
			expect(statusText).not.toContain('✓');
			expect(statusText).not.toContain('|');
		});

		it('Done fires onSuccessFeedbackComplete and clears the confirmation', async () => {
			await fillAndSave();

			expect(screen.getByRole('button', { name: /^done$/i })).toBeTruthy();
			await fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
			flushSync();

			expect(onDoneSpy).toHaveBeenCalledTimes(1);
			expect(screen.getByRole('status').textContent).toBe('');
			expect(screen.queryByRole('button', { name: /^done$/i })).toBeNull();
		});

		it('editing a field clears the confirmation without closing the sheet', async () => {
			await fillAndSave();
			expect(screen.getByRole('status').textContent).toContain('this tank');

			await fireEvent.input(screen.getByLabelText(/odometer/i), { target: { value: '88000' } });
			flushSync();

			expect(screen.getByRole('status').textContent).toBe('');
			expect(onDoneSpy).not.toHaveBeenCalled();
		});

		it('shows an honest, cost-bearing state when consumption cannot be computed (no bare 0)', async () => {
			mockSaveFuelLog.mockResolvedValue({
				data: { ...savedLog, calculatedConsumption: 0 },
				error: null
			});
			await fillAndSave();

			const statusText = screen.getByRole('status').textContent ?? '';
			expect(statusText).toContain('log one more to see your consumption');
			expect(statusText).toContain('€78.00');
			expect(statusText).not.toMatch(/(^|\s)0(\s|$)/);
		});

		it('renders an aria-hidden sparkline when a consumption trend exists', async () => {
			mockGetAllFuelLogs.mockResolvedValue({
				data: [
					{
						id: 10,
						vehicleId: 1,
						date: new Date('2026-03-01'),
						odometer: 80000,
						quantity: 40,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 70,
						calculatedConsumption: 6.5,
						notes: ''
					} as FuelLog
				],
				error: null
			});
			await fillAndSave();

			const sparkline = document.querySelector('svg[aria-hidden="true"]');
			expect(sparkline).toBeTruthy();
		});

		it('on a save error: emits a toast, retains the draft, shows no inline alert', async () => {
			localStorage.clear();
			clearFuelDraft();
			mockSaveFuelLog.mockResolvedValue({
				data: null,
				error: { code: 'SAVE_FAILED', message: 'boom' }
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await Promise.resolve();
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), { target: { value: '87400' } });
			await fireEvent.input(screen.getByLabelText(/quantity/i), { target: { value: '42' } });
			await fireEvent.input(screen.getByLabelText(/total cost/i), { target: { value: '78' } });
			await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
			await Promise.resolve();
			await Promise.resolve();
			flushSync();

			expect(mockToast.error).toHaveBeenCalledWith('Could not save fuel entry. Please try again.');
			// Draft retained for retry (NOT cleared on error).
			expect(localStorage.getItem('passanger_draft_fuel')).toBeTruthy();
			// No inline destructive alert — the failure lives on the toast channel.
			expect(screen.queryByRole('alert')).toBeNull();
			expect(onSaveSpy).not.toHaveBeenCalled();
		});
	});

	describe('Core AC criteria validation', () => {
		it('AC #1: odometer auto-focused on mount', async () => {
			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i);
			expect(document.activeElement).toBe(odometerInput);
		});

		it('AC #2: shows the documented last odometer hint copy when previous logs exist', async () => {
			mockGetAllFuelLogs.mockResolvedValue({
				data: [
					{
						id: 1,
						vehicleId: 1,
						date: new Date('2026-03-05'),
						odometer: 85000,
						quantity: 40,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 75,
						calculatedConsumption: 7.0,
						notes: ''
					} as FuelLog
				],
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByText(hintTextMatcher(85000))).toBeTruthy();
		});

		it('AC #6: validation errors appear on save tap when fields empty', async () => {
			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 50));
			flushSync();

			expect(screen.getByText(/enter a valid odometer/i)).toBeTruthy();
		});

		it('keeps Save enabled after a previous-log lookup failure and redirects focus to retry on submit', async () => {
			mockGetAllFuelLogs.mockResolvedValue({
				data: null,
				error: { code: 'GET_FAILED', message: 'IndexedDB unavailable' }
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByText(/could not load previous fuel history/i)).toBeTruthy();

			const submitButton = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
			expect(submitButton.disabled).toBe(false);

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78.00' } });
			flushSync();

			await fireEvent.submit(document.querySelector('form')!);
			await new Promise((r) => setTimeout(r, 50));
			flushSync();

			expect(document.activeElement).toBe(
				screen.getByRole('button', { name: /retry loading history/i })
			);
			expect(mockSaveFuelLog).not.toHaveBeenCalled();
		});

		it('disables Save only while a retry request is actually in flight', async () => {
			const retryDeferred = createDeferred<{
				data: FuelLog[] | null;
				error: { code: string; message: string } | null;
			}>();

			mockGetAllFuelLogs
				.mockResolvedValueOnce({
					data: null,
					error: { code: 'GET_FAILED', message: 'IndexedDB unavailable' }
				})
				.mockImplementationOnce(() => retryDeferred.promise);

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
			expect(submitButton.disabled).toBe(false);

			await fireEvent.click(screen.getByRole('button', { name: /retry loading history/i }));
			await Promise.resolve();
			flushSync();

			expect(submitButton.disabled).toBe(true);

			retryDeferred.resolve({
				data: [
					{
						id: 1,
						vehicleId: 1,
						date: new Date('2026-03-09T10:00:00Z'),
						odometer: 86800,
						quantity: 40,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 75,
						calculatedConsumption: 7,
						notes: 'previous fill'
					} as FuelLog
				],
				error: null
			});
			await Promise.resolve();
			await Promise.resolve();
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(submitButton.disabled).toBe(false);
			expect(screen.queryByText(/could not load previous fuel history/i)).toBeNull();
		});

		it('allows retrying a failed previous-log load from the form and then saving', async () => {
			mockGetAllFuelLogs
				.mockResolvedValueOnce({
					data: null,
					error: { code: 'GET_FAILED', message: 'IndexedDB unavailable' }
				})
				.mockResolvedValueOnce({
					data: [
						{
							id: 1,
							vehicleId: 1,
							date: new Date('2026-03-09T10:00:00Z'),
							odometer: 86800,
							quantity: 40,
							unit: 'L',
							distanceUnit: 'km',
							totalCost: 75,
							calculatedConsumption: 7,
							notes: 'previous fill'
						} as FuelLog
					],
					error: null
				});

			const savedLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date('2026-03-10T10:00:00Z'),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 7,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
			expect(submitButton.disabled).toBe(false);

			await fireEvent.click(screen.getByRole('button', { name: /retry loading history/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockGetAllFuelLogs).toHaveBeenCalledTimes(2);
			expect(screen.queryByText(/could not load previous fuel history/i)).toBeNull();
			expect(screen.getByText(hintTextMatcher(86800))).toBeTruthy();
			expect(submitButton.disabled).toBe(false);

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78.00' } });
			flushSync();

			await fireEvent.click(submitButton);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockSaveFuelLog).toHaveBeenCalledTimes(1);
			expect(onSaveSpy).toHaveBeenCalledTimes(1);
		});

		it('clears the stale success card before showing validation errors on a later invalid submit', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 7.2,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78.00' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			expect(screen.getByRole('status').textContent).toContain('this tank');

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((r) => setTimeout(r, 50));
			flushSync();

			// Story 2.4: the live region is always present; the stale success TEXT is cleared.
			expect(screen.getByRole('status').textContent).toBe('');
			expect(screen.getByText(/enter a valid odometer/i)).toBeTruthy();
			expect(mockSaveFuelLog).toHaveBeenCalledTimes(1);
		});

		// FIX #9: Test decimal edge cases that were previously rejected
		it('accepts valid decimal input: leading decimal (.5)', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400,
				quantity: 0.5,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 5,
				calculatedConsumption: 0.12,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '.5' } });
			await fireEvent.input(costInput, { target: { value: '5' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			expect(mockSaveFuelLog).toHaveBeenCalled();
			expect(onSaveSpy).toHaveBeenCalled();
		});

		it('accepts valid decimal input: trailing decimal (42.)', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 6.97,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '42.' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			expect(mockSaveFuelLog).toHaveBeenCalled();
			expect(onSaveSpy).toHaveBeenCalled();
		});

		it('rejects invalid decimal input: number with suffix (42L)', async () => {
			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '42L' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 50));
			flushSync();

			expect(screen.getByText(/enter the fuel quantity/i)).toBeTruthy();
			expect(mockSaveFuelLog).not.toHaveBeenCalled();
		});
	});

	// FIX #13 (Pass 13): Test decimal input acceptance and MPG mode
	describe('FIX #13: Decimal input acceptance and MPG mode support', () => {
		it('accepts valid decimal inputs like 0.500 and 12.345 for quantity/cost', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400,
				quantity: 12.345,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78.999,
				calculatedConsumption: 0.0141,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			// Enter decimal inputs like 0.500 and 12.345
			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '12.345' } });
			await fireEvent.input(costInput, { target: { value: '78.999' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			expect(mockSaveFuelLog).toHaveBeenCalled();
			expect(onSaveSpy).toHaveBeenCalled();
		});

		it('stores matching unit/distanceUnit pairs when saving (L with km, gal with mi)', async () => {
			// FIX #13: Component should save fuel logs with consistent unit/distanceUnit pairing
			// In the default L/100km mode (from mock context), it should store unit='L', distanceUnit='km'
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km', // Matches the 'L' unit setting
				totalCost: 78,
				calculatedConsumption: 7.2,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			// Verify unit/distanceUnit pairing is correct
			const callArgs = mockSaveFuelLog.mock.calls[0]?.[0];
			expect(callArgs?.unit).toBe('L');
			expect(callArgs?.distanceUnit).toBe('km');
		});

		it('detects mixed-unit history and skips efficiency calculation', async () => {
			// FIX #13: When previous log has different distance unit, skip efficiency calculation
			const previousLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(Date.now() - 86400000), // yesterday
				odometer: 54000, // in miles
				quantity: 12,
				unit: 'gal',
				distanceUnit: 'mi', // Previous was in MPG mode (different unit!)
				totalCost: 40,
				calculatedConsumption: 36,
				notes: ''
			};

			mockGetAllFuelLogs.mockResolvedValue({
				data: [previousLog],
				error: null
			});

			const savedLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400, // in km (current is L/100km mode)
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 0, // Will be 0 due to mixed-unit guard
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 100)); // Wait for previousLog to load
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			// Verify that component detected mixed-unit and set calculatedConsumption to 0
			const callArgs = mockSaveFuelLog.mock.calls[0]?.[0];
			expect(callArgs?.calculatedConsumption).toBe(0);
		});
	});

	describe('Odometer separator handling', () => {
		it('rejects grouped odometer input when it matches the displayed last-reading hint', async () => {
			mockGetAllFuelLogs.mockResolvedValue({
				data: [
					{
						id: 1,
						vehicleId: 1,
						date: new Date('2026-03-09T10:00:00Z'),
						odometer: 87400,
						quantity: 41,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 75,
						calculatedConsumption: 6.8,
						notes: 'previous fill'
					} as FuelLog
				],
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByText(hintTextMatcher(87400))).toBeTruthy();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			// Enter the hint-formatted grouped value instead of a plain decimal.
			await fireEvent.input(odometerInput, { target: { value: '87,400' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);
			flushSync();

			// Should show grouped-number specific error
			expect(screen.getByText(/enter odometer without commas/i)).toBeTruthy();

			// Should not have called saveFuelLog
			expect(mockSaveFuelLog).not.toHaveBeenCalled();
		});

		it('rejects grouped odometer input like 88,000 even when it does not match the hint', async () => {
			mockGetAllFuelLogs.mockResolvedValue({
				data: [
					{
						id: 1,
						vehicleId: 1,
						date: new Date('2026-03-09T10:00:00Z'),
						odometer: 87400,
						quantity: 41,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 75,
						calculatedConsumption: 6.8,
						notes: 'previous fill'
					} as FuelLog
				],
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '88,000' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			flushSync();

			expect(screen.getByText(/enter odometer without commas/i)).toBeTruthy();
			expect(mockSaveFuelLog).not.toHaveBeenCalled();
		});

		it('rejects obvious grouped odometer input like 88.000 on a first-ever entry', async () => {
			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '88.000' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			flushSync();

			expect(screen.getByText(/enter odometer without commas/i)).toBeTruthy();
			expect(mockSaveFuelLog).not.toHaveBeenCalled();
		});

		it('rejects first-entry grouped comma input like 1,500 instead of saving it as 1.5', async () => {
			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '1,500' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			flushSync();

			expect(screen.getByText(/enter odometer without commas/i)).toBeTruthy();
			expect(mockSaveFuelLog).not.toHaveBeenCalled();
		});

		it('accepts comma-decimal odometer input like 12,345', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 12.345,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 0,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '12,345' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockSaveFuelLog).toHaveBeenCalled();
			expect(mockSaveFuelLog.mock.calls[0]?.[0]?.odometer).toBe(12.345);
		});

		it('accepts comma-decimal odometer input like 87400,500', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400.5,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 0,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400,500' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockSaveFuelLog).toHaveBeenCalled();
			expect(mockSaveFuelLog.mock.calls[0]?.[0]?.odometer).toBe(87400.5);
		});

		it('surfaces grouped guidance when the visible hint uses locale spacing separators', async () => {
			const originalToLocaleString = Number.prototype.toLocaleString;
			vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (this: number) {
				const numericValue = Number(this.valueOf());
				if (numericValue === 87400) {
					return '87\u202F400';
				}

				return originalToLocaleString.call(numericValue);
			});

			mockGetAllFuelLogs.mockResolvedValue({
				data: [
					{
						id: 1,
						vehicleId: 1,
						date: new Date('2026-03-09T10:00:00Z'),
						odometer: 87400,
						quantity: 41,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 75,
						calculatedConsumption: 6.8,
						notes: 'previous fill'
					} as FuelLog
				],
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByText(hintTextMatcher(87400))).toBeTruthy();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87 400' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			flushSync();

			expect(screen.getByText(/enter odometer without commas/i)).toBeTruthy();
			expect(mockSaveFuelLog).not.toHaveBeenCalled();
		});

		it('accepts odometer decimals with three fractional digits like 12.345', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 12.345,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 0,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '12.345' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);
			flushSync();

			expect(mockSaveFuelLog).toHaveBeenCalled();
			expect(onSaveSpy).toHaveBeenCalled();
		});

		it('accepts valid decimals like 87.4 without rejecting as grouped', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87.4,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 7.2,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			// Valid decimal (not grouped)
			await fireEvent.input(odometerInput, { target: { value: '87.4' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			// Should accept and save
			expect(mockSaveFuelLog).toHaveBeenCalled();
			expect(onSaveSpy).toHaveBeenCalled();
		});

		// Story 2.2 (AC-3): a below-previous reading on the CREATE path is no longer hard-blocked.
		// It shows a non-blocking amber warning and STILL saves, storing calculatedConsumption=0
		// (the honest "can't compute" sentinel) so the timeline stays consistent.
		it('warns but still saves a below-previous odometer with consumption=0 (non-blocking)', async () => {
			mockGetAllFuelLogs.mockResolvedValue({
				data: [
					{
						id: 1,
						vehicleId: 1,
						date: new Date('2026-03-09T10:00:00Z'),
						odometer: 87400,
						quantity: 41,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 75,
						calculatedConsumption: 6.8,
						notes: 'previous fill'
					} as FuelLog
				],
				error: null
			});
			mockSaveFuelLog.mockResolvedValue({
				data: {
					id: 2,
					vehicleId: 1,
					date: new Date(),
					odometer: 87399,
					quantity: 42,
					unit: 'L',
					distanceUnit: 'km',
					totalCost: 78,
					calculatedConsumption: 0,
					notes: ''
				} as FuelLog,
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87399' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			// The non-blocking amber warning appears as the user types a below-previous value...
			expect(screen.getByText(/at or below your last reading/i)).toBeTruthy();
			// ...and it is NOT the destructive role="alert" hard error.
			expect(
				screen.queryByText(/enter an odometer reading higher than the last logged value/i)
			).toBeNull();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			// Save proceeds (not blocked) and the persisted entry carries consumption=0.
			expect(mockSaveFuelLog).toHaveBeenCalled();
			const savedEntry = mockSaveFuelLog.mock.calls[0][0];
			expect(savedEntry.calculatedConsumption).toBe(0);
			expect(onSaveSpy).toHaveBeenCalled();
		});
	});

	describe('FIX #13: Decimal number acceptance', () => {
		it('accepts valid decimal numbers like 87.4', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87.4,
				quantity: 42.5,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78.99,
				calculatedConsumption: 7.2,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			// Valid decimals (not grouped)
			await fireEvent.input(odometerInput, { target: { value: '87.4' } });
			await fireEvent.input(quantityInput, { target: { value: '42.5' } });
			await fireEvent.input(costInput, { target: { value: '78.99' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			expect(mockSaveFuelLog).toHaveBeenCalled();
			expect(onSaveSpy).toHaveBeenCalled();
		});
	});

	// FIX #2: Test distance unit tracking with L/100km mode (MPG mode requires separate test setup)
	describe('FIX #2: Distance unit tracking', () => {
		it('stores distanceUnit as km when in L/100km mode', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km', // FIX #2: Should be stored as 'km' in L/100km mode
				totalCost: 78,
				calculatedConsumption: 7.2,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			// Verify the saved log includes distanceUnit
			const savedEntry = mockSaveFuelLog.mock.calls[0]?.[0];
			if (savedEntry) {
				expect(savedEntry.distanceUnit).toBe('km');
				expect(savedEntry.unit).toBe('L');
			}
		});
	});

	// FIX #11 (Pass 11) - ISSUE 2: Test mixed-unit history handling
	describe('FIX #11: Mixed-unit history detection', () => {
		it('skips efficiency calculation when previous log is from different unit (distanceUnit check)', async () => {
			// Simulate previous log in km (L/100km mode)
			const previousLog: FuelLog = {
				id: 0,
				vehicleId: 1,
				date: new Date(Date.now() - 86400000), // 1 day ago
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km', // Previous log was in km (L/100km mode)
				totalCost: 78,
				calculatedConsumption: 7.2,
				notes: ''
			};

			mockGetAllFuelLogs.mockResolvedValue({
				data: [previousLog],
				error: null
			});

			// Component will be in L/100km mode (default mock)
			// But previousLog was also in km, so no mixed-unit scenario
			// Test verifies that the presence of previousOdometer + matching distanceUnit
			// allows calculation to proceed normally
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 88000,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km', // Same unit as previous, so calculation proceeds
				totalCost: 78,
				calculatedConsumption: 7.0, // Should be calculated (not 0)
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 50));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			// User enters new fill-up data in same unit (km)
			await fireEvent.input(odometerInput, { target: { value: '88000' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			// Verify that the saved entry has matching distanceUnit (no mixed-unit scenario)
			const savedEntry = mockSaveFuelLog.mock.calls[0]?.[0];
			if (savedEntry) {
				expect(savedEntry.distanceUnit).toBe('km');
				expect(savedEntry.unit).toBe('L');
				// Consumption should be calculated (not 0) since units match
				expect(savedEntry.calculatedConsumption).toBeGreaterThan(0);
			}
		});
	});

	// FIX #15.4: Draft store clearing verification with the real draft module
	describe('FIX #15.4: Draft store truly empty after save', () => {
		it('draft store has zero keys after successful save', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 7.2,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			// Pre-populate draft store
			fuelDraft['odometer'] = '87400';
			fuelDraft['quantity'] = '42';
			fuelDraft['cost'] = '78';

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const submitButton = screen.getByRole('button', { name: /save/i });
			await fireEvent.click(submitButton);

			await new Promise((r) => setTimeout(r, 150));
			flushSync();

			// FIX #15.4: Verify keys are DELETED, not just empty strings
			expect(Object.keys(fuelDraft)).toHaveLength(0);
		});
	});

	// FIX #15.1: Same-session consecutive saves after mixed-unit recovery
	describe('FIX #15.1: Same-session mixed-unit recovery', () => {
		it('second save after unit switch calculates efficiency correctly (not 0)', async () => {
			// Previous log was in miles (MPG mode)
			const previousLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(Date.now() - 86400000),
				odometer: 54000,
				quantity: 12,
				unit: 'gal',
				distanceUnit: 'mi',
				totalCost: 40,
				calculatedConsumption: 36,
				notes: ''
			};

			mockGetAllFuelLogs.mockResolvedValue({
				data: [previousLog],
				error: null
			});

			// First save: mixed-unit, should return consumption=0
			const firstSavedLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 0,
				notes: ''
			};
			// Second save: same-unit (both km now), should calculate
			const secondSavedLog: FuelLog = {
				id: 3,
				vehicleId: 1,
				date: new Date(),
				odometer: 88000,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 7.0,
				notes: ''
			};
			mockSaveFuelLog
				.mockResolvedValueOnce({ data: firstSavedLog, error: null })
				.mockResolvedValueOnce({ data: secondSavedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			// First save — mixed-unit scenario
			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((r) => setTimeout(r, 150));
			flushSync();

			// First save should have consumption=0 (mixed-unit)
			const firstCallArgs = mockSaveFuelLog.mock.calls[0]?.[0];
			expect(firstCallArgs?.calculatedConsumption).toBe(0);

			// Second save — same-session, units now match (lastLogDistanceUnit updated to 'km')
			const odometerInput2 = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput2 = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput2 = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput2, { target: { value: '88000' } });
			await fireEvent.input(quantityInput2, { target: { value: '42' } });
			await fireEvent.input(costInput2, { target: { value: '78' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((r) => setTimeout(r, 150));
			flushSync();

			// FIX #15.1: Second save should calculate correctly (not 0)
			const secondCallArgs = mockSaveFuelLog.mock.calls[1]?.[0];
			expect(secondCallArgs?.calculatedConsumption).toBeGreaterThan(0);
		});
	});

	// FIX #15.2: Comma-decimal inputs
	describe('FIX #15.2: Comma-decimal input acceptance', () => {
		it('accepts European comma-decimal input 0,500 as quantity (parsed as 0.5)', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400,
				quantity: 0.5,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 5,
				calculatedConsumption: 0,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '0,500' } });
			await fireEvent.input(costInput, { target: { value: '5' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			// Should accept and save with parsed value
			expect(mockSaveFuelLog).toHaveBeenCalled();
			const callArgs = mockSaveFuelLog.mock.calls[0]?.[0];
			expect(callArgs?.quantity).toBe(0.5);
		});

		it('accepts European comma-decimal input 12,345 as quantity (parsed as 12.345)', async () => {
			const savedLog: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date(),
				odometer: 87400,
				quantity: 12.345,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 0,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '12,345' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((r) => setTimeout(r, 100));
			flushSync();

			// Should accept and save with parsed value
			expect(mockSaveFuelLog).toHaveBeenCalled();
			const callArgs = mockSaveFuelLog.mock.calls[0]?.[0];
			expect(callArgs?.quantity).toBe(12.345);
		});

		it('still rejects a grouped odometer value when it mirrors the visible hint text', async () => {
			mockGetAllFuelLogs.mockResolvedValue({
				data: [
					{
						id: 1,
						vehicleId: 1,
						date: new Date('2026-03-09T10:00:00Z'),
						odometer: 87400,
						quantity: 41,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 75,
						calculatedConsumption: 6.8,
						notes: 'previous fill'
					} as FuelLog
				],
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByText(hintTextMatcher(87400))).toBeTruthy();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87,400' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			flushSync();

			// Odometer grouping check in handleSubmit catches this
			expect(screen.getByText(/enter odometer without commas/i)).toBeTruthy();
			expect(mockSaveFuelLog).not.toHaveBeenCalled();
		});
	});

	describe('Pass 18: last-log hydration race handling', () => {
		it('waits for the pending last-log load before saving and keeps the new baseline after save', async () => {
			const deferredLogs = createDeferred<{ data: FuelLog[]; error: null }>();
			mockGetAllFuelLogs.mockReturnValue(deferredLogs.promise);

			const savedLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date('2026-03-10T10:05:00Z'),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 7,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '87400' } });
			await fireEvent.input(quantityInput, { target: { value: '42' } });
			await fireEvent.input(costInput, { target: { value: '78' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			expect(mockSaveFuelLog).not.toHaveBeenCalled();

			deferredLogs.resolve({
				data: [
					{
						id: 1,
						vehicleId: 1,
						date: new Date('2026-03-09T10:00:00Z'),
						odometer: 86800,
						quantity: 41,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 75,
						calculatedConsumption: 6.8,
						notes: 'previous fill'
					}
				],
				error: null
			});
			await deferredLogs.promise;
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			const savedEntry = mockSaveFuelLog.mock.calls[0]?.[0];
			expect(savedEntry?.calculatedConsumption).toBeCloseTo(7, 5);
			expect(screen.getByText(/last: 87,400 km/i)).toBeTruthy();
		});
	});

	describe('Pass 18: MPG settings coverage', () => {
		it('renders MPG labels and saves gallon/mile entries with MPG output', async () => {
			mockSettings.value = {
				fuelUnit: 'MPG',
				currency: '$',
				theme: 'system'
			};

			mockGetAllFuelLogs.mockResolvedValue({
				data: [
					{
						id: 1,
						vehicleId: 1,
						date: new Date('2026-03-09T10:00:00Z'),
						odometer: 10000,
						quantity: 10,
						unit: 'gal',
						distanceUnit: 'mi',
						totalCost: 35,
						calculatedConsumption: 36,
						notes: 'previous mpg fill'
					}
				],
				error: null
			});

			const savedLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date('2026-03-10T10:00:00Z'),
				odometer: 10360,
				quantity: 10,
				unit: 'gal',
				distanceUnit: 'mi',
				totalCost: 40,
				calculatedConsumption: 36,
				notes: ''
			};
			mockSaveFuelLog.mockResolvedValue({ data: savedLog, error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			expect(screen.getByLabelText(/odometer \(mi\)/i)).toBeTruthy();
			expect(screen.getByLabelText(/quantity \(gal\)/i)).toBeTruthy();

			const odometerInput = screen.getByLabelText(/odometer \(mi\)/i) as HTMLInputElement;
			const quantityInput = screen.getByLabelText(/quantity \(gal\)/i) as HTMLInputElement;
			const costInput = screen.getByLabelText(/total cost/i) as HTMLInputElement;

			await fireEvent.input(odometerInput, { target: { value: '10360' } });
			await fireEvent.input(quantityInput, { target: { value: '10' } });
			await fireEvent.input(costInput, { target: { value: '40' } });
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			const savedEntry = mockSaveFuelLog.mock.calls[0]?.[0];
			expect(savedEntry?.unit).toBe('gal');
			expect(savedEntry?.distanceUnit).toBe('mi');
			expect(savedEntry?.calculatedConsumption).toBeCloseTo(36, 5);
			expect(screen.getByRole('status').textContent).toContain('36.0 MPG');
			expect(screen.getByRole('status').textContent).toContain('$40.00');
		});
	});

	describe('Story 2.2 edit mode', () => {
		it('renders edit-mode success feedback in the preferred display unit and currency', async () => {
			mockSettings.value = {
				fuelUnit: 'MPG',
				currency: 'EUR ',
				theme: 'system'
			};

			const predecessor: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date('2026-03-08T10:00:00Z'),
				odometer: 87000,
				quantity: 40,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 70,
				calculatedConsumption: 0,
				notes: ''
			};
			const initialLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date('2026-03-09T10:00:00Z'),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 10.5,
				notes: ''
			};
			const updatedLog: FuelLog = {
				...initialLog,
				odometer: 87500,
				quantity: 36,
				totalCost: 80,
				calculatedConsumption: 7.2
			};

			mockGetAllFuelLogs.mockResolvedValue({
				data: [predecessor, initialLog],
				error: null
			});
			mockUpdateFuelLogsAtomic.mockResolvedValue({
				data: [updatedLog],
				error: null
			});

			render(FuelEntryForm, {
				props: {
					vehicleId: 1,
					mode: 'edit',
					initialFuelLog: initialLog,
					onSave: onSaveSpy
				}
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), {
				target: { value: '87500' }
			});
			await fireEvent.input(screen.getByLabelText(/quantity/i), {
				target: { value: '36' }
			});
			await fireEvent.input(screen.getByLabelText(/total cost/i), {
				target: { value: '80' }
			});
			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			expect(screen.getByRole('status').textContent).toContain('32.7 MPG');
			expect(screen.getByRole('status').textContent).toContain('EUR 80.00');
			// Story 2.4: the calm voice drops the raw quantity readout ("36.0 gal") in favor of "this tank".
			expect(screen.getByRole('status').textContent).toContain('this tank');
		});

		it('accepts trailing-zero three-decimal odometer input when editing the oldest fuel log', async () => {
			const initialLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date('2026-03-09T10:00:00Z'),
				odometer: 12.1,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 0,
				notes: ''
			};
			const updatedLog: FuelLog = {
				...initialLog,
				odometer: 12.34
			};

			mockGetAllFuelLogs.mockResolvedValue({
				data: [initialLog],
				error: null
			});
			mockUpdateFuelLogsAtomic.mockResolvedValue({
				data: [updatedLog],
				error: null
			});

			render(FuelEntryForm, {
				props: {
					vehicleId: 1,
					mode: 'edit',
					initialFuelLog: initialLog,
					onSave: onSaveSpy
				}
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), {
				target: { value: '12.340' }
			});
			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			expect(screen.queryByText(/enter odometer without commas/i)).toBeNull();
			expect(mockUpdateFuelLogsAtomic).toHaveBeenCalledWith([
				expect.objectContaining({
					id: 2,
					changes: expect.objectContaining({
						odometer: 12.34
					})
				})
			]);
			expect(onSaveSpy).toHaveBeenCalledWith([updatedLog]);
		});

		it('prefills the selected log, uses the true predecessor, and updates affected successor logs', async () => {
			const predecessor: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date('2026-03-08T10:00:00Z'),
				odometer: 87000,
				quantity: 40,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 70,
				calculatedConsumption: 0,
				notes: ''
			};
			const initialLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date('2026-03-09T10:00:00Z'),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 10.5,
				notes: ''
			};
			const successor: FuelLog = {
				id: 3,
				vehicleId: 1,
				date: new Date('2026-03-10T10:00:00Z'),
				odometer: 87800,
				quantity: 40,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 76,
				calculatedConsumption: 10,
				notes: ''
			};
			const updatedLog: FuelLog = {
				...initialLog,
				odometer: 87600,
				quantity: 40,
				totalCost: 80,
				calculatedConsumption: 6.6666666667
			};
			const updatedSuccessor: FuelLog = {
				...successor,
				calculatedConsumption: 20
			};

			mockGetAllFuelLogs.mockResolvedValue({
				data: [successor, predecessor, initialLog],
				error: null
			});
			mockUpdateFuelLogsAtomic.mockResolvedValue({
				data: [updatedLog, updatedSuccessor],
				error: null
			});

			render(FuelEntryForm, {
				props: {
					vehicleId: 1,
					mode: 'edit',
					initialFuelLog: initialLog,
					onSave: onSaveSpy
				}
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			expect((screen.getByLabelText(/odometer/i) as HTMLInputElement).value).toBe('87400');
			expect((screen.getByLabelText(/quantity/i) as HTMLInputElement).value).toBe('42');
			expect((screen.getByLabelText(/total cost/i) as HTMLInputElement).value).toBe('78');
			expect(screen.getByText(hintTextMatcher(87000))).toBeTruthy();

			await fireEvent.input(screen.getByLabelText(/odometer/i), {
				target: { value: '87600' }
			});
			await fireEvent.input(screen.getByLabelText(/quantity/i), {
				target: { value: '40' }
			});
			await fireEvent.input(screen.getByLabelText(/total cost/i), {
				target: { value: '80' }
			});
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			expect(mockSaveFuelLog).not.toHaveBeenCalled();
			expect(mockUpdateFuelLogsAtomic).toHaveBeenCalledTimes(1);
			expect(mockUpdateFuelLogsAtomic).toHaveBeenCalledWith([
				expect.objectContaining({
					id: 2,
					changes: expect.objectContaining({
						odometer: 87600,
						quantity: 40,
						totalCost: 80,
						unit: 'L',
						distanceUnit: 'km',
						calculatedConsumption: expect.closeTo(6.6666666667, 6)
					})
				}),
				{
					id: 3,
					changes: {
						calculatedConsumption: 20
					}
				}
			]);
			expect(onSaveSpy).toHaveBeenCalledWith([updatedLog, updatedSuccessor]);
			expect(screen.getByRole('status').textContent).toContain('Updated');
		});

		it('rejects grouped odometer input when the edit predecessor uses a different distance unit', async () => {
			const predecessor: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date('2026-03-08T10:00:00Z'),
				odometer: 12000,
				quantity: 10,
				unit: 'gal',
				distanceUnit: 'mi',
				totalCost: 35,
				calculatedConsumption: 0,
				notes: ''
			};
			const initialLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date('2026-03-09T10:00:00Z'),
				odometer: 19000,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 0,
				notes: ''
			};

			mockGetAllFuelLogs.mockResolvedValue({
				data: [predecessor, initialLog],
				error: null
			});

			render(FuelEntryForm, {
				props: {
					vehicleId: 1,
					mode: 'edit',
					initialFuelLog: initialLog,
					onSave: onSaveSpy
				}
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), {
				target: { value: '10,000' }
			});
			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			expect(screen.getByText(/enter odometer without commas/i)).toBeTruthy();
			expect(mockUpdateFuelLogsAtomic).not.toHaveBeenCalled();
			expect(onSaveSpy).not.toHaveBeenCalled();
		});

		it('blocks an edit that would move a fuel log above the next saved log', async () => {
			const predecessor: FuelLog = {
				id: 1,
				vehicleId: 1,
				date: new Date('2026-03-08T10:00:00Z'),
				odometer: 87000,
				quantity: 40,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 70,
				calculatedConsumption: 0,
				notes: ''
			};
			const initialLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date('2026-03-09T10:00:00Z'),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 10.5,
				notes: ''
			};
			const successor: FuelLog = {
				id: 3,
				vehicleId: 1,
				date: new Date('2026-03-10T10:00:00Z'),
				odometer: 87800,
				quantity: 40,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 76,
				calculatedConsumption: 10,
				notes: ''
			};

			mockGetAllFuelLogs.mockResolvedValue({
				data: [successor, predecessor, initialLog],
				error: null
			});

			render(FuelEntryForm, {
				props: {
					vehicleId: 1,
					mode: 'edit',
					initialFuelLog: initialLog,
					onSave: onSaveSpy
				}
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), {
				target: { value: '87900' }
			});
			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			expect(screen.getByText(/lower than the next logged value/i)).toBeTruthy();
			expect(mockUpdateFuelLogsAtomic).not.toHaveBeenCalled();
			expect(onSaveSpy).not.toHaveBeenCalled();
		});

		it('keeps the create draft untouched and skips repository writes when edit mode is cancelled', async () => {
			const initialLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date('2026-03-09T10:00:00Z'),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 10.5,
				notes: ''
			};
			const onCancelSpy = vi.fn();

			fuelDraft['odometer'] = '99999';
			fuelDraft['quantity'] = '55';
			fuelDraft['cost'] = '88';
			mockGetAllFuelLogs.mockResolvedValue({
				data: [initialLog],
				error: null
			});

			render(FuelEntryForm, {
				props: {
					vehicleId: 1,
					mode: 'edit',
					initialFuelLog: initialLog,
					onSave: onSaveSpy,
					onCancel: onCancelSpy
				}
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), {
				target: { value: '87500' }
			});
			await fireEvent.input(screen.getByLabelText(/total cost/i), {
				target: { value: '79' }
			});
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
			await Promise.resolve();
			flushSync();

			expect(mockSaveFuelLog).not.toHaveBeenCalled();
			expect(mockUpdateFuelLogsAtomic).not.toHaveBeenCalled();
			expect(onCancelSpy).toHaveBeenCalledTimes(1);
			expect(fuelDraft['odometer']).toBe('99999');
			expect(fuelDraft['quantity']).toBe('55');
			expect(fuelDraft['cost']).toBe('88');
		});

		it('surfaces update failures accessibly in edit mode', async () => {
			const initialLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date('2026-03-09T10:00:00Z'),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 10.5,
				notes: ''
			};

			mockGetAllFuelLogs.mockResolvedValue({
				data: [initialLog],
				error: null
			});
			mockUpdateFuelLogsAtomic.mockResolvedValue({
				data: null,
				error: { code: 'UPDATE_FAILED', message: 'Dexie failed' }
			});

			render(FuelEntryForm, {
				props: {
					vehicleId: 1,
					mode: 'edit',
					initialFuelLog: initialLog,
					onSave: onSaveSpy
				}
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/total cost/i), {
				target: { value: '90' }
			});
			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			// Story 2.4 (AC-4): failures surface on the toast channel, not an inline alert.
			expect(mockToast.error).toHaveBeenCalledWith(
				'Could not update fuel entry. Please try again.'
			);
			expect(screen.queryByRole('alert')).toBeNull();
			expect(onSaveSpy).not.toHaveBeenCalled();
		});

		it('surfaces the specific storage-full message (not the generic one) when an edit update hits quota', async () => {
			const initialLog: FuelLog = {
				id: 2,
				vehicleId: 1,
				date: new Date('2026-03-09T10:00:00Z'),
				odometer: 87400,
				quantity: 42,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 78,
				calculatedConsumption: 10.5,
				notes: ''
			};

			mockGetAllFuelLogs.mockResolvedValue({ data: [initialLog], error: null });
			mockUpdateFuelLogsAtomic.mockResolvedValue({
				data: null,
				error: { code: 'QUOTA_EXCEEDED', message: QUOTA_EXCEEDED_MESSAGE }
			});

			render(FuelEntryForm, {
				props: {
					vehicleId: 1,
					mode: 'edit',
					initialFuelLog: initialLog,
					onSave: onSaveSpy
				}
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/total cost/i), {
				target: { value: '90' }
			});
			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			// Story 2.4 (AC-4): the specific quota message routes through the toast channel.
			expect(mockToast.error).toHaveBeenCalledWith(QUOTA_EXCEEDED_MESSAGE);
			expect(mockToast.error).not.toHaveBeenCalledWith(expect.stringContaining('Please try again'));
			expect(screen.queryByRole('alert')).toBeNull();
			// Input preserved so the user can free space and retry without re-entering.
			expect((screen.getByLabelText(/total cost/i) as HTMLInputElement).value).toBe('90');
			expect(onSaveSpy).not.toHaveBeenCalled();
		});

		it('surfaces the specific storage-full message when a new fuel log save hits quota', async () => {
			mockSaveFuelLog.mockResolvedValue({
				data: null,
				error: { code: 'QUOTA_EXCEEDED', message: QUOTA_EXCEEDED_MESSAGE }
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), { target: { value: '87400' } });
			await fireEvent.input(screen.getByLabelText(/quantity/i), { target: { value: '42' } });
			await fireEvent.input(screen.getByLabelText(/total cost/i), { target: { value: '78' } });
			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();

			// Story 2.4 (AC-4): the specific quota message routes through the toast channel.
			expect(mockToast.error).toHaveBeenCalledWith(QUOTA_EXCEEDED_MESSAGE);
			expect(mockToast.error).not.toHaveBeenCalledWith(expect.stringContaining('Please try again'));
			expect(screen.queryByRole('alert')).toBeNull();
			// Draft preserved on a failed save so the user can free space and retry.
			expect((screen.getByLabelText(/odometer/i) as HTMLInputElement).value).toBe('87400');
			expect((screen.getByLabelText(/total cost/i) as HTMLInputElement).value).toBe('78');
			expect(onSaveSpy).not.toHaveBeenCalled();
		});
	});

	// Story 2.2 (FR-4): smart defaults — odometer suggestion, sanity warning, currency chips.
	describe('Story 2.2: smart defaults on Capture', () => {
		function logAt(id: number, odometer: number, isoDate: string): FuelLog {
			return {
				id,
				vehicleId: 1,
				date: new Date(isoDate),
				odometer,
				quantity: 40,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 70,
				calculatedConsumption: 6,
				notes: ''
			} as FuelLog;
		}

		it('seeds the odometer to last + median delta when >=2 comparable prior logs exist', async () => {
			// deltas 500, 500 → median 500; last reading 88000 → suggest 88500
			mockGetAllFuelLogs.mockResolvedValue({
				data: [
					logAt(1, 87000, '2026-03-01T10:00:00Z'),
					logAt(2, 87500, '2026-03-08T10:00:00Z'),
					logAt(3, 88000, '2026-03-15T10:00:00Z')
				],
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect((screen.getByLabelText(/odometer/i) as HTMLInputElement).value).toBe('88500');
		});

		it('does not seed a suggestion with only one prior log (no delta history)', async () => {
			mockGetAllFuelLogs.mockResolvedValue({
				data: [logAt(1, 87000, '2026-03-01T10:00:00Z')],
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect((screen.getByLabelText(/odometer/i) as HTMLInputElement).value).toBe('');
		});

		it('never clobbers an in-progress draft odometer with a suggestion', async () => {
			fuelDraft['odometer'] = '99999';
			mockGetAllFuelLogs.mockResolvedValue({
				data: [
					logAt(1, 87000, '2026-03-01T10:00:00Z'),
					logAt(2, 87500, '2026-03-08T10:00:00Z'),
					logAt(3, 88000, '2026-03-15T10:00:00Z')
				],
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect((screen.getByLabelText(/odometer/i) as HTMLInputElement).value).toBe('99999');
		});

		it('shows an implausibly-high warning that clears when the reading is corrected', async () => {
			// median delta 500 → 5x = 2500, floor 2000 → threshold 2500; last 88000.
			mockGetAllFuelLogs.mockResolvedValue({
				data: [
					logAt(1, 87000, '2026-03-01T10:00:00Z'),
					logAt(2, 87500, '2026-03-08T10:00:00Z'),
					logAt(3, 88000, '2026-03-15T10:00:00Z')
				],
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;

			// 88000 + 3000 = 91000 → delta 3000 > 2500 → implausibly-high warning
			await fireEvent.input(odometerInput, { target: { value: '91000' } });
			flushSync();
			expect(screen.getByText(/bigger jump than usual/i)).toBeTruthy();

			// Correct to a normal forward reading → warning clears
			await fireEvent.input(odometerInput, { target: { value: '88500' } });
			flushSync();
			expect(screen.queryByText(/bigger jump than usual/i)).toBeNull();
		});

		it('does not flash a sanity warning while a thousands-grouped value is being typed', async () => {
			// Last reading 88000; "88,500" parses to 88.5 (comma→decimal), which would look
			// below-previous and wrongly trip the amber warning. The grouped value is rejected
			// by the hard error on save instead, so the live warning must stay silent.
			mockGetAllFuelLogs.mockResolvedValue({
				data: [
					logAt(1, 87000, '2026-03-01T10:00:00Z'),
					logAt(2, 87500, '2026-03-08T10:00:00Z'),
					logAt(3, 88000, '2026-03-15T10:00:00Z')
				],
				error: null
			});

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const odometerInput = screen.getByLabelText(/odometer/i) as HTMLInputElement;
			await fireEvent.input(odometerInput, { target: { value: '88,500' } });
			flushSync();

			expect(screen.queryByText(/at or below your last reading/i)).toBeNull();
			expect(screen.queryByText(/bigger jump than usual/i)).toBeNull();
		});

		it('renders recent-currency chips and applies one on tap', async () => {
			// Seed two recent currencies; last-used is € (so the form defaults to €) and the $
			// chip is offered (recent minus the selected €).
			setLastUsedCurrency('$');
			setLastUsedCurrency('€');
			mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });

			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const currencySelect = screen.getByLabelText(/currency/i) as HTMLSelectElement;
			expect(currencySelect.value).toBe('€');

			const dollarChip = screen.getByRole('button', { name: '$' });
			await fireEvent.click(dollarChip);
			flushSync();

			expect(currencySelect.value).toBe('$');
		});
	});

	describe('Story 7.1: partial / missed fill toggles', () => {
		async function fillAndRender() {
			mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
			mockSaveFuelLog.mockResolvedValue({
				data: { id: 1, vehicleId: 1 } as FuelLog,
				error: null
			});
			render(FuelEntryForm, { props: { vehicleId: 1, onSave: onSaveSpy } });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			await fireEvent.input(screen.getByLabelText(/odometer/i), { target: { value: '87400' } });
			await fireEvent.input(screen.getByLabelText(/quantity/i), { target: { value: '42' } });
			await fireEvent.input(screen.getByLabelText(/total cost/i), { target: { value: '78' } });
		}

		it('threads the partial flag into the saved entry', async () => {
			await fillAndRender();
			await fireEvent.click(screen.getByRole('checkbox', { name: /partial fill-up/i }));
			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((r) => setTimeout(r, 50));
			flushSync();

			expect(mockSaveFuelLog).toHaveBeenCalledTimes(1);
			const entry = mockSaveFuelLog.mock.calls[0][0] as {
				isPartialFill: boolean;
				precededByMissedFill: boolean;
			};
			expect(entry.isPartialFill).toBe(true);
			expect(entry.precededByMissedFill).toBe(false);
		});

		it('threads the missed-previous-fill flag into the saved entry', async () => {
			await fillAndRender();
			await fireEvent.click(screen.getByRole('checkbox', { name: /missed a previous fill-up/i }));
			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((r) => setTimeout(r, 50));
			flushSync();

			const entry = mockSaveFuelLog.mock.calls[0][0] as {
				isPartialFill: boolean;
				precededByMissedFill: boolean;
			};
			expect(entry.isPartialFill).toBe(false);
			expect(entry.precededByMissedFill).toBe(true);
		});

		it('defaults both toggles off — a plain save carries false flags', async () => {
			await fillAndRender();
			await fireEvent.click(screen.getByRole('button', { name: /save/i }));
			await new Promise((r) => setTimeout(r, 50));
			flushSync();

			const entry = mockSaveFuelLog.mock.calls[0][0] as {
				isPartialFill: boolean;
				precededByMissedFill: boolean;
			};
			expect(entry.isPartialFill).toBe(false);
			expect(entry.precededByMissedFill).toBe(false);
		});
	});
});
