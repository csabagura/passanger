import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import type { Expense } from '$lib/db/schema';
import { clearMaintenanceDraft, maintenanceDraft } from '$lib/stores/draft';
import { getTodayDateInputValue } from '$lib/utils/date';
import type { AppSettings } from '$lib/utils/settings';
import MaintenanceForm from './MaintenanceForm.svelte';

const mockSaveExpense = vi.fn();
const mockUpdateExpense = vi.fn();
const mockSettings = vi.hoisted(() => ({
	value: {
		fuelUnit: 'L/100km',
		currency: '€'
	} as AppSettings
}));

vi.mock('$lib/db/repositories/expenses', () => ({
	saveExpense: (...args: unknown[]) => mockSaveExpense(...args),
	updateExpense: (...args: unknown[]) => mockUpdateExpense(...args)
}));

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
			return undefined;
		}
	};
});

describe('MaintenanceForm', () => {
	const onSaveSpy = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		clearMaintenanceDraft();
		mockSettings.value = {
			fuelUnit: 'L/100km',
			currency: '€'
		};
	});

	afterEach(() => {
		cleanup();
		clearMaintenanceDraft();
	});

	it('renders the maintenance fields with today pre-filled in create mode', () => {
		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });

		expect((screen.getByLabelText(/^date$/i) as HTMLInputElement).value).toBe(
			getTodayDateInputValue()
		);
		expect(screen.getByLabelText(/^type$/i)).toBeTruthy();
		expect(screen.getByLabelText(/odometer/i)).toBeTruthy();
		expect(screen.getByLabelText(/cost/i)).toBeTruthy();
		expect(screen.getByLabelText(/notes/i)).toBeTruthy();
	});

	it('uses the saved currency prefix in the cost label and success feedback', async () => {
		mockSettings.value = {
			fuelUnit: 'L/100km',
			currency: 'EUR '
		};

		const savedExpense: Expense = {
			id: 19,
			vehicleId: 7,
			date: new Date(2026, 2, 10, 12, 0, 0, 0),
			type: 'Insurance',
			cost: 100
		};
		mockSaveExpense.mockResolvedValue({ data: savedExpense, error: null });

		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });

		expect(screen.getByLabelText(/cost \(EUR \)/i)).toBeTruthy();

		await fireEvent.input(screen.getByLabelText(/^type$/i), {
			target: { value: 'Insurance' }
		});
		await fireEvent.input(screen.getByLabelText(/cost \(EUR \)/i), {
			target: { value: '100' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
		await Promise.resolve();
		flushSync();

		expect(screen.getByRole('status').textContent).toContain('EUR 100.00');
	});

	it('does not derive the maintenance odometer label from the fuel-unit preference', () => {
		mockSettings.value = {
			fuelUnit: 'MPG',
			currency: '€'
		};

		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });

		expect(screen.getByLabelText(/odometer/i)).toBeTruthy();
		expect(
			screen.getByText(/maintenance entries keep the odometer value exactly as entered/i)
		).toBeTruthy();
		expect(screen.queryByText(/\(optional, mi\)/i)).toBeNull();
		expect(screen.queryByText(/\(optional, km\)/i)).toBeNull();
	});

	it('keeps Save enabled and validates on tap instead of disabling invalid submission', async () => {
		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });
		const saveButton = screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement;

		expect(saveButton.disabled).toBe(false);

		await fireEvent.click(saveButton);
		await Promise.resolve();
		flushSync();

		const typeInput = screen.getByLabelText(/^type$/i) as HTMLInputElement;
		const costInput = screen.getByLabelText(/cost/i) as HTMLInputElement;

		expect(screen.getByText('Enter a maintenance type')).toBeTruthy();
		expect(screen.getByText('Enter the cost (e.g. 78.00)')).toBeTruthy();
		expect(typeInput.getAttribute('aria-invalid')).toBe('true');
		expect(typeInput.getAttribute('aria-describedby')).toBe('maintenance-type-error');
		expect(costInput.getAttribute('aria-invalid')).toBe('true');
		expect(costInput.getAttribute('aria-describedby')).toBe('maintenance-cost-error');
		expect(document.activeElement).toBe(typeInput);
		expect(saveButton.disabled).toBe(false);
		expect(mockSaveExpense).not.toHaveBeenCalled();
	});

	it('saves valid create-mode data, clears the draft, and resets to a fresh state', async () => {
		const savedExpense: Expense = {
			id: 11,
			vehicleId: 7,
			date: new Date(2026, 2, 10, 12, 0, 0, 0),
			type: 'Oil Change',
			odometer: 87400.5,
			cost: 78,
			notes: 'Changed oil\nChecked filters'
		};
		mockSaveExpense.mockResolvedValue({ data: savedExpense, error: null });

		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });

		await fireEvent.input(screen.getByLabelText(/^type$/i), {
			target: { value: 'Oil Change' }
		});
		await fireEvent.input(screen.getByLabelText(/odometer/i), {
			target: { value: '87400,500' }
		});
		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '78.00' }
		});
		await fireEvent.input(screen.getByLabelText(/notes/i), {
			target: { value: 'Changed oil\nChecked filters' }
		});

		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
		await Promise.resolve();
		flushSync();

		expect(mockSaveExpense).toHaveBeenCalledTimes(1);
		expect(mockSaveExpense.mock.calls[0][0]).toMatchObject({
			vehicleId: 7,
			type: 'Oil Change',
			odometer: 87400.5,
			cost: 78,
			notes: 'Changed oil\nChecked filters'
		});
		expect(mockSaveExpense.mock.calls[0][0].date).toBeInstanceOf(Date);
		expect(onSaveSpy).toHaveBeenCalledWith(savedExpense);
		expect(screen.getByRole('status').textContent).toContain('Saved Oil Change');
		expect((screen.getByLabelText(/^date$/i) as HTMLInputElement).value).toBe(
			getTodayDateInputValue()
		);
		expect((screen.getByLabelText(/^type$/i) as HTMLInputElement).value).toBe('');
		expect((screen.getByLabelText(/odometer/i) as HTMLInputElement).value).toBe('');
		expect((screen.getByLabelText(/cost/i) as HTMLInputElement).value).toBe('');
		expect((screen.getByLabelText(/notes/i) as HTMLTextAreaElement).value).toBe('');
		expect(Object.keys(maintenanceDraft)).toHaveLength(0);
	});

	it('preserves the create draft and announces save failures accessibly', async () => {
		mockSaveExpense.mockResolvedValue({
			data: null,
			error: { code: 'SAVE_FAILED', message: 'Dexie failed' }
		});

		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });

		await fireEvent.input(screen.getByLabelText(/^type$/i), {
			target: { value: 'Insurance' }
		});
		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '100' }
		});

		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
		await Promise.resolve();
		flushSync();

		expect(screen.getByRole('alert').textContent).toContain(
			'Could not save maintenance entry. Please try again.'
		);
		expect((screen.getByLabelText(/^type$/i) as HTMLInputElement).value).toBe('Insurance');
		expect((screen.getByLabelText(/cost/i) as HTMLInputElement).value).toBe('100');
		expect(maintenanceDraft['type']).toBe('Insurance');
		expect(maintenanceDraft['cost']).toBe('100');
		expect(onSaveSpy).not.toHaveBeenCalled();
	});

	it('prefills an existing expense and updates it via updateExpense in edit mode', async () => {
		const existingExpense: Expense = {
			id: 21,
			vehicleId: 7,
			date: new Date(2026, 2, 8, 12, 0, 0, 0),
			type: 'Tyres',
			odometer: 87200,
			cost: 320,
			notes: 'Winter set'
		};
		const updatedExpense: Expense = {
			...existingExpense,
			cost: 340,
			notes: 'Winter set and balancing'
		};
		mockUpdateExpense.mockResolvedValue({ data: updatedExpense, error: null });
		maintenanceDraft['type'] = 'Draft create';
		maintenanceDraft['cost'] = '11';

		render(MaintenanceForm, {
			vehicleId: 7,
			mode: 'edit',
			initialExpense: existingExpense,
			onSave: onSaveSpy
		});

		expect((screen.getByLabelText(/^date$/i) as HTMLInputElement).value).toBe('2026-03-08');
		expect((screen.getByLabelText(/^type$/i) as HTMLInputElement).value).toBe('Tyres');
		expect((screen.getByLabelText(/cost/i) as HTMLInputElement).value).toBe('320');
		expect(screen.getByRole('button', { name: /save changes/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();

		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '340' }
		});
		await fireEvent.input(screen.getByLabelText(/notes/i), {
			target: { value: 'Winter set and balancing' }
		});

		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
		await Promise.resolve();
		flushSync();

		expect(mockSaveExpense).not.toHaveBeenCalled();
		expect(mockUpdateExpense).toHaveBeenCalledWith(21, {
			vehicleId: 7,
			date: expect.any(Date),
			type: 'Tyres',
			odometer: 87200,
			cost: 340,
			notes: 'Winter set and balancing'
		});
		expect(screen.getByRole('status').textContent).toContain('Updated Tyres');
		expect(onSaveSpy).toHaveBeenCalledWith(updatedExpense);
		expect(maintenanceDraft['type']).toBe('Draft create');
		expect(maintenanceDraft['cost']).toBe('11');
	});

	it('keeps Save enabled and preserves create drafts when edit mode is cancelled', async () => {
		const existingExpense: Expense = {
			id: 22,
			vehicleId: 7,
			date: new Date(2026, 2, 8, 12, 0, 0, 0),
			type: 'Service',
			cost: 120,
			notes: ''
		};
		const onCancelSpy = vi.fn();
		maintenanceDraft['type'] = 'Draft create';
		maintenanceDraft['cost'] = '11';

		render(MaintenanceForm, {
			vehicleId: 7,
			mode: 'edit',
			initialExpense: existingExpense,
			onSave: onSaveSpy,
			onCancel: onCancelSpy
		});

		await fireEvent.input(screen.getByLabelText(/^type$/i), {
			target: { value: 'Changed service' }
		});
		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '140' }
		});

		await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
		await Promise.resolve();
		flushSync();

		expect(mockSaveExpense).not.toHaveBeenCalled();
		expect(mockUpdateExpense).not.toHaveBeenCalled();
		expect(onCancelSpy).toHaveBeenCalledTimes(1);
		expect(maintenanceDraft['type']).toBe('Draft create');
		expect(maintenanceDraft['cost']).toBe('11');
	});

	it('announces edit failures accessibly without clearing edit-mode values', async () => {
		const existingExpense: Expense = {
			id: 23,
			vehicleId: 7,
			date: new Date(2026, 2, 8, 12, 0, 0, 0),
			type: 'Insurance',
			cost: 120,
			notes: ''
		};
		mockUpdateExpense.mockResolvedValue({
			data: null,
			error: { code: 'UPDATE_FAILED', message: 'Dexie failed' }
		});

		render(MaintenanceForm, {
			vehicleId: 7,
			mode: 'edit',
			initialExpense: existingExpense,
			onSave: onSaveSpy
		});

		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '150' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
		await Promise.resolve();
		flushSync();

		expect(screen.getByRole('alert').textContent).toContain(
			'Could not update maintenance entry. Please try again.'
		);
		expect((screen.getByLabelText(/^type$/i) as HTMLInputElement).value).toBe('Insurance');
		expect((screen.getByLabelText(/cost/i) as HTMLInputElement).value).toBe('150');
		expect(onSaveSpy).not.toHaveBeenCalled();
	});

	it('rejects grouped odometer input without corrupting the parsed value', async () => {
		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });

		await fireEvent.input(screen.getByLabelText(/^type$/i), {
			target: { value: 'Tyres' }
		});
		await fireEvent.input(screen.getByLabelText(/odometer/i), {
			target: { value: '87,400' }
		});
		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '250' }
		});

		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
		await Promise.resolve();
		flushSync();

		expect(screen.getByText(/grouping separators/i)).toBeTruthy();
		expect(mockSaveExpense).not.toHaveBeenCalled();
	});

	it('accepts decimal odometer values with trailing zeros', async () => {
		const savedExpense: Expense = {
			id: 12,
			vehicleId: 7,
			date: new Date(2026, 2, 10, 12, 0, 0, 0),
			type: 'Service',
			odometer: 12.34,
			cost: 45,
			notes: ''
		};
		mockSaveExpense.mockResolvedValue({ data: savedExpense, error: null });

		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });

		await fireEvent.input(screen.getByLabelText(/^type$/i), {
			target: { value: 'Service' }
		});
		await fireEvent.input(screen.getByLabelText(/odometer/i), {
			target: { value: '12.340' }
		});
		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '45' }
		});

		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
		await Promise.resolve();
		flushSync();

		expect(mockSaveExpense).toHaveBeenCalledTimes(1);
		expect(mockSaveExpense.mock.calls[0][0].odometer).toBe(12.34);
		expect(screen.queryByText(/grouping separators/i)).toBeNull();
	});
});
