import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import VehicleForm from './VehicleForm.svelte';
import type { Vehicle } from '$lib/db/schema';

const mockSaveVehicle = vi.fn();
const mockUpdateVehicle = vi.fn();

vi.mock('$lib/db/repositories/vehicles', () => ({
	saveVehicle: (...args: unknown[]) => mockSaveVehicle(...args),
	updateVehicle: (...args: unknown[]) => mockUpdateVehicle(...args)
}));

describe('VehicleForm', () => {
	const mockOnSave = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	describe('rendering', () => {
		it('renders Display Name, Make, Model, and Year fields', () => {
			render(VehicleForm, { onSave: mockOnSave });
			expect(screen.getByLabelText(/display name/i)).toBeTruthy();
			expect(screen.getByLabelText(/^make$/i)).toBeTruthy();
			expect(screen.getByLabelText(/^model$/i)).toBeTruthy();
			expect(screen.getByLabelText(/year/i)).toBeTruthy();
		});

		it('renders the form title as an h1 heading', () => {
			render(VehicleForm, { onSave: mockOnSave });
			expect(screen.getByRole('heading', { level: 1, name: /add vehicle/i })).toBeTruthy();
		});

		it('renders a submit button', () => {
			render(VehicleForm, { onSave: mockOnSave });
			const btn = document.querySelector('button[type="submit"]');
			expect(btn).toBeTruthy();
		});

		it('year input has type="text" with inputmode="numeric"', () => {
			render(VehicleForm, { onSave: mockOnSave });
			const yearInput = screen.getByLabelText(/year/i) as HTMLInputElement;
			expect(yearInput.type).toBe('text');
			expect(yearInput.inputMode).toBe('numeric');
		});
	});

	describe('inline validation on blur (AC: #4)', () => {
		it('shows "Enter a display name" when Display Name blurred empty', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.blur(screen.getByLabelText(/display name/i));
			expect(screen.getByText('Enter a display name')).toBeTruthy();
		});

		it('shows make error when Make blurred empty', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.blur(screen.getByLabelText(/^make$/i));
			expect(screen.getByText(/enter the vehicle make/i)).toBeTruthy();
		});

		it('shows model error when Model blurred empty', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.blur(screen.getByLabelText(/^model$/i));
			expect(screen.getByText(/enter the vehicle model/i)).toBeTruthy();
		});

		it('clears Display Name error when user types a value', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const input = screen.getByLabelText(/display name/i);
			await fireEvent.blur(input);
			expect(screen.getByText('Enter a display name')).toBeTruthy();
			await fireEvent.input(input, { target: { value: 'My Car' } });
			expect(screen.queryByText('Enter a display name')).toBeNull();
		});
	});

	describe('year field validation (optional)', () => {
		it('does not show error when year is left blank', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.blur(screen.getByLabelText(/year/i));
			expect(screen.queryByText(/enter a valid year/i)).toBeNull();
		});

		it('shows error for year before 1900', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const yearInput = screen.getByLabelText(/year/i) as HTMLInputElement;
			await fireEvent.input(yearInput, { target: { value: '1800' } });
			await fireEvent.blur(yearInput);
			expect(screen.getByText(/enter a valid year/i)).toBeTruthy();
		});

		it('shows error for year beyond current year', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const futureYear = new Date().getFullYear() + 5;
			const yearInput = screen.getByLabelText(/year/i) as HTMLInputElement;
			await fireEvent.input(yearInput, { target: { value: String(futureYear) } });
			await fireEvent.blur(yearInput);
			expect(screen.getByText(/enter a valid year/i)).toBeTruthy();
		});

		it('accepts a valid year without error', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const yearInput = screen.getByLabelText(/year/i) as HTMLInputElement;
			await fireEvent.input(yearInput, { target: { value: '2020' } });
			await fireEvent.blur(yearInput);
			expect(screen.queryByText(/enter a valid year/i)).toBeNull();
		});

		it('rejects decimal year input like 2020.5', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const yearInput = screen.getByLabelText(/year/i) as HTMLInputElement;
			await fireEvent.input(yearInput, { target: { value: '2020.5' } });
			await fireEvent.blur(yearInput);
			expect(screen.getByText(/enter a valid year/i)).toBeTruthy();
		});

		it('rejects year with non-numeric characters', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const yearInput = screen.getByLabelText(/year/i) as HTMLInputElement;
			await fireEvent.input(yearInput, { target: { value: '20e3' } });
			await fireEvent.blur(yearInput);
			expect(screen.getByText(/enter a valid year/i)).toBeTruthy();
		});

		it('does not submit with decimal year value', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Yaris' } });
			await fireEvent.input(screen.getByLabelText(/year/i), { target: { value: '2020.5' } });
			await fireEvent.submit(document.querySelector('form')!);
			expect(mockSaveVehicle).not.toHaveBeenCalled();
		});
	});

	describe('accessible error wiring', () => {
		it('sets aria-invalid and aria-describedby on Display Name when error shown', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const input = screen.getByLabelText(/display name/i) as HTMLInputElement;
			await fireEvent.blur(input);
			expect(input.getAttribute('aria-invalid')).toBe('true');
			expect(input.getAttribute('aria-describedby')).toBe('displayName-error');
			const errorEl = document.getElementById('displayName-error');
			expect(errorEl).toBeTruthy();
			expect(errorEl?.textContent).toBe('Enter a display name');
		});

		it('sets aria-invalid and aria-describedby on Make when error shown', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const input = screen.getByLabelText(/^make$/i) as HTMLInputElement;
			await fireEvent.blur(input);
			expect(input.getAttribute('aria-invalid')).toBe('true');
			expect(input.getAttribute('aria-describedby')).toBe('make-error');
			const errorEl = document.getElementById('make-error');
			expect(errorEl).toBeTruthy();
		});

		it('sets aria-invalid and aria-describedby on Model when error shown', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const input = screen.getByLabelText(/^model$/i) as HTMLInputElement;
			await fireEvent.blur(input);
			expect(input.getAttribute('aria-invalid')).toBe('true');
			expect(input.getAttribute('aria-describedby')).toBe('model-error');
			const errorEl = document.getElementById('model-error');
			expect(errorEl).toBeTruthy();
		});

		it('sets aria-invalid and aria-describedby on Year when error shown', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const yearInput = screen.getByLabelText(/year/i) as HTMLInputElement;
			await fireEvent.input(yearInput, { target: { value: '1800' } });
			await fireEvent.blur(yearInput);
			expect(yearInput.getAttribute('aria-invalid')).toBe('true');
			expect(yearInput.getAttribute('aria-describedby')).toBe('year-error');
			const errorEl = document.getElementById('year-error');
			expect(errorEl).toBeTruthy();
		});

		it('does not set aria-invalid when fields are valid', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const input = screen.getByLabelText(/display name/i) as HTMLInputElement;
			await fireEvent.input(input, { target: { value: 'My Car' } });
			await fireEvent.blur(input);
			expect(input.getAttribute('aria-invalid')).toBeNull();
			expect(input.getAttribute('aria-describedby')).toBeNull();
		});
	});

	describe('$derived form validity — submit button disabled when invalid', () => {
		it('submit button is disabled when all required fields are empty', () => {
			render(VehicleForm, { onSave: mockOnSave });
			const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
			expect(btn.disabled).toBe(true);
		});

		it('submit button is disabled when only some required fields are filled', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
			expect(btn.disabled).toBe(true);
		});

		it('submit button becomes enabled when all required fields are filled', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Yaris' } });
			const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
			expect(btn.disabled).toBe(false);
		});

		it('submit button is disabled when year has a validation error', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Yaris' } });
			const yearInput = screen.getByLabelText(/year/i);
			await fireEvent.input(yearInput, { target: { value: '2020.5' } });
			await fireEvent.blur(yearInput);
			const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
			expect(btn.disabled).toBe(true);
		});

		it('submit button is disabled immediately when invalid year is typed (before blur)', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Yaris' } });
			const yearInput = screen.getByLabelText(/year/i);
			// Type decimal year — do NOT blur
			await fireEvent.input(yearInput, { target: { value: '2020.5' } });
			const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
			expect(btn.disabled).toBe(true);
		});

		it('submit button is disabled immediately when out-of-range year is typed (before blur)', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Yaris' } });
			const yearInput = screen.getByLabelText(/year/i);
			// Type out-of-range year — do NOT blur
			await fireEvent.input(yearInput, { target: { value: '1800' } });
			const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
			expect(btn.disabled).toBe(true);
		});
	});

	describe('submit validation (AC: #4) — errors shown before any Dexie call', () => {
		it('shows errors for all empty required fields on submit', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.submit(document.querySelector('form')!);
			expect(screen.getByText('Enter a display name')).toBeTruthy();
			expect(screen.getByText(/enter the vehicle make/i)).toBeTruthy();
			expect(screen.getByText(/enter the vehicle model/i)).toBeTruthy();
		});

		it('does not call saveVehicle when required fields are empty', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.submit(document.querySelector('form')!);
			expect(mockSaveVehicle).not.toHaveBeenCalled();
		});
	});

	describe('successful save (AC: #3)', () => {
		async function fillAndSubmit(year?: string) {
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Yaris' } });
			if (year !== undefined) {
				await fireEvent.input(screen.getByLabelText(/year/i), { target: { value: year } });
			}
			await fireEvent.submit(document.querySelector('form')!);
		}

		it('calls saveVehicle with trimmed field values', async () => {
			mockSaveVehicle.mockResolvedValue({
				data: { id: 1, name: 'My Car', make: 'Toyota', model: 'Yaris' },
				error: null
			});
			render(VehicleForm, { onSave: mockOnSave });
			await fillAndSubmit();
			expect(mockSaveVehicle).toHaveBeenCalledWith({
				name: 'My Car',
				make: 'Toyota',
				model: 'Yaris',
				year: undefined
			});
		});

		it('calls saveVehicle with year when provided', async () => {
			mockSaveVehicle.mockResolvedValue({
				data: { id: 1, name: 'My Car', make: 'Toyota', model: 'Yaris', year: 2020 },
				error: null
			});
			render(VehicleForm, { onSave: mockOnSave });
			await fillAndSubmit('2020');
			expect(mockSaveVehicle).toHaveBeenCalledWith({
				name: 'My Car',
				make: 'Toyota',
				model: 'Yaris',
				year: 2020
			});
		});

		it('calls onSave with the saved vehicle on success', async () => {
			const savedVehicle: Vehicle = { id: 1, name: 'My Car', make: 'Toyota', model: 'Yaris' };
			mockSaveVehicle.mockResolvedValue({ data: savedVehicle, error: null });
			render(VehicleForm, { onSave: mockOnSave });
			await fillAndSubmit();
			await new Promise((r) => setTimeout(r, 0));
			expect(mockOnSave).toHaveBeenCalledWith(savedVehicle);
		});
	});

	describe('loading state', () => {
		it('submit button shows "Saving…" while request is in-flight', async () => {
			let resolveSave!: (v: unknown) => void;
			mockSaveVehicle.mockReturnValue(new Promise((r) => (resolveSave = r)));
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Yaris' } });

			fireEvent.submit(document.querySelector('form')!);
			// Flush microtasks so Svelte renders the loading state
			await Promise.resolve();
			flushSync();

			const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
			expect(btn.disabled).toBe(true);
			expect(btn.textContent?.trim()).toBe('Saving…');

			resolveSave({
				data: { id: 1, name: 'My Car', make: 'Toyota', model: 'Yaris' },
				error: null
			});
		});

		it('rapid double submit only calls saveVehicle() once', async () => {
			let resolveSave!: (v: unknown) => void;
			mockSaveVehicle.mockReturnValue(new Promise((r) => (resolveSave = r)));
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Yaris' } });

			// First submit — starts the in-flight save
			fireEvent.submit(document.querySelector('form')!);
			await Promise.resolve();
			flushSync();

			// Second submit while save is already in-flight
			await fireEvent.submit(document.querySelector('form')!);

			// saveVehicle should only have been called once
			expect(mockSaveVehicle).toHaveBeenCalledTimes(1);

			resolveSave({ data: { id: 1, name: 'My Car', make: 'Toyota', model: 'Yaris' }, error: null });
		});
	});

	describe('toast timer cleanup on unmount', () => {
		it('clears toast timeout when component is destroyed', async () => {
			const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
			mockSaveVehicle.mockResolvedValue({
				data: null,
				error: { code: 'SAVE_FAILED', message: 'DB error' }
			});
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Yaris' } });
			await fireEvent.submit(document.querySelector('form')!);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			// Toast should be showing now with a pending timer
			expect(screen.getByRole('alert')).toBeTruthy();
			// Unmount the component
			cleanup();
			// clearTimeout should have been called during destroy
			expect(clearTimeoutSpy).toHaveBeenCalled();
			clearTimeoutSpy.mockRestore();
		});
	});

	describe('Dexie error handling', () => {
		it('shows a role="alert" toast when save fails', async () => {
			mockSaveVehicle.mockResolvedValue({
				data: null,
				error: { code: 'SAVE_FAILED', message: 'DB error' }
			});
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Yaris' } });
			await fireEvent.submit(document.querySelector('form')!);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			// Only the toast should have role="alert" at this point (no field errors with valid inputs)
			const alerts = document.querySelectorAll('[role="alert"]');
			expect(alerts.length).toBe(1);
			expect(alerts[0].textContent).toContain('Failed to save vehicle');
		});

		it('does not call onSave when save fails', async () => {
			mockSaveVehicle.mockResolvedValue({
				data: null,
				error: { code: 'SAVE_FAILED', message: 'DB error' }
			});
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Yaris' } });
			await fireEvent.submit(document.querySelector('form')!);
			await new Promise((r) => setTimeout(r, 0));
			expect(mockOnSave).not.toHaveBeenCalled();
		});
	});

	describe('focus management on submit validation failure', () => {
		it('focuses displayName input when submit blocked with all empty fields', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const displayNameInput = screen.getByLabelText(/display name/i) as HTMLInputElement;
			await fireEvent.submit(document.querySelector('form')!);
			expect(document.activeElement).toBe(displayNameInput);
		});

		it('focuses make input when displayName is filled but make is empty', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			const makeInput = screen.getByLabelText(/^make$/i) as HTMLInputElement;
			await fireEvent.submit(document.querySelector('form')!);
			expect(document.activeElement).toBe(makeInput);
		});

		it('focuses year input when year is invalid and other required fields are valid', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Car' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Yaris' } });
			const yearInput = screen.getByLabelText(/year/i) as HTMLInputElement;
			await fireEvent.input(yearInput, { target: { value: '1800' } });
			await fireEvent.submit(document.querySelector('form')!);
			expect(document.activeElement).toBe(yearInput);
		});
	});

	describe('live announcement semantics — inline error elements have role="alert"', () => {
		it('displayName error element has role="alert"', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.blur(screen.getByLabelText(/display name/i));
			const errorEl = document.getElementById('displayName-error');
			expect(errorEl?.getAttribute('role')).toBe('alert');
		});

		it('make error element has role="alert"', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.blur(screen.getByLabelText(/^make$/i));
			const errorEl = document.getElementById('make-error');
			expect(errorEl?.getAttribute('role')).toBe('alert');
		});

		it('model error element has role="alert"', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			await fireEvent.blur(screen.getByLabelText(/^model$/i));
			const errorEl = document.getElementById('model-error');
			expect(errorEl?.getAttribute('role')).toBe('alert');
		});

		it('year error element has role="alert"', async () => {
			render(VehicleForm, { onSave: mockOnSave });
			const yearInput = screen.getByLabelText(/year/i) as HTMLInputElement;
			await fireEvent.input(yearInput, { target: { value: '1800' } });
			await fireEvent.blur(yearInput);
			const errorEl = document.getElementById('year-error');
			expect(errorEl?.getAttribute('role')).toBe('alert');
		});
	});

	describe('edit mode', () => {
		const existingVehicle: Vehicle = {
			id: 42,
			name: 'My Honda',
			make: 'Honda',
			model: 'Civic',
			year: 2019
		};
		const mockOnUpdate = vi.fn();
		const mockOnCancel = vi.fn();

		it('pre-fills all fields with initialVehicle data', () => {
			render(VehicleForm, {
				onSave: mockOnSave,
				initialVehicle: existingVehicle,
				onUpdate: mockOnUpdate,
				onCancel: mockOnCancel
			});
			expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe(
				'My Honda'
			);
			expect((screen.getByLabelText(/^make$/i) as HTMLInputElement).value).toBe('Honda');
			expect((screen.getByLabelText(/^model$/i) as HTMLInputElement).value).toBe('Civic');
			expect((screen.getByLabelText(/year/i) as HTMLInputElement).value).toBe('2019');
		});

		it('shows "Edit Vehicle" heading instead of "Add Vehicle"', () => {
			render(VehicleForm, {
				onSave: mockOnSave,
				initialVehicle: existingVehicle,
				onUpdate: mockOnUpdate
			});
			expect(screen.getByRole('heading', { level: 1, name: /edit vehicle/i })).toBeTruthy();
			expect(screen.queryByRole('heading', { name: /add vehicle/i })).toBeNull();
		});

		it('shows "Save changes" button text instead of "Save vehicle"', () => {
			render(VehicleForm, {
				onSave: mockOnSave,
				initialVehicle: existingVehicle,
				onUpdate: mockOnUpdate
			});
			const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
			expect(btn.textContent?.trim()).toBe('Save changes');
		});

		it('calls updateVehicle instead of saveVehicle on submit', async () => {
			const updatedVehicle: Vehicle = { ...existingVehicle, name: 'Updated Honda' };
			mockUpdateVehicle.mockResolvedValue({ data: updatedVehicle, error: null });
			render(VehicleForm, {
				onSave: mockOnSave,
				initialVehicle: existingVehicle,
				onUpdate: mockOnUpdate,
				onCancel: mockOnCancel
			});
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'Updated Honda' }
			});
			await fireEvent.submit(document.querySelector('form')!);
			await new Promise((r) => setTimeout(r, 0));
			expect(mockUpdateVehicle).toHaveBeenCalledWith(42, {
				name: 'Updated Honda',
				make: 'Honda',
				model: 'Civic',
				year: 2019
			});
			expect(mockSaveVehicle).not.toHaveBeenCalled();
		});

		it('calls onUpdate callback on successful edit', async () => {
			const updatedVehicle: Vehicle = { ...existingVehicle, name: 'Updated Honda' };
			mockUpdateVehicle.mockResolvedValue({ data: updatedVehicle, error: null });
			render(VehicleForm, {
				onSave: mockOnSave,
				initialVehicle: existingVehicle,
				onUpdate: mockOnUpdate,
				onCancel: mockOnCancel
			});
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'Updated Honda' }
			});
			await fireEvent.submit(document.querySelector('form')!);
			await new Promise((r) => setTimeout(r, 0));
			expect(mockOnUpdate).toHaveBeenCalledWith(updatedVehicle);
			expect(mockOnSave).not.toHaveBeenCalled();
		});

		it('renders Cancel button that calls onCancel', async () => {
			render(VehicleForm, {
				onSave: mockOnSave,
				initialVehicle: existingVehicle,
				onUpdate: mockOnUpdate,
				onCancel: mockOnCancel
			});
			const cancelBtn = screen.getByRole('button', { name: /cancel/i });
			expect(cancelBtn).toBeTruthy();
			await fireEvent.click(cancelBtn);
			expect(mockOnCancel).toHaveBeenCalled();
		});

		it('does not render Cancel button when onCancel is not provided', () => {
			render(VehicleForm, {
				onSave: mockOnSave,
				initialVehicle: existingVehicle,
				onUpdate: mockOnUpdate
			});
			expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
		});

		it('pre-fills without year when initialVehicle has no year', () => {
			const noYearVehicle: Vehicle = { id: 10, name: 'Van', make: 'Ford', model: 'Transit' };
			render(VehicleForm, {
				onSave: mockOnSave,
				initialVehicle: noYearVehicle,
				onUpdate: mockOnUpdate
			});
			expect((screen.getByLabelText(/year/i) as HTMLInputElement).value).toBe('');
		});
	});
});
