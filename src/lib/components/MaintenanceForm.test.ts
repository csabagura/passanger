import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import type { Expense } from '$lib/db/schema';
import { QUOTA_EXCEEDED_MESSAGE } from '$lib/db/dbErrors';
import {
	clearMaintenanceDraft,
	maintenanceDraft,
	setLastUsedCurrency
} from '$lib/state/draftStore';
import { getTodayDateInputValue } from '$lib/utils/date';
import type { AppSettings } from '$lib/utils/settings';
import MaintenanceForm from './MaintenanceForm.svelte';

const mockSaveExpense = vi.fn();
const mockUpdateExpense = vi.fn();
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

vi.mock('$lib/db/repositories/expenses', () => ({
	saveExpense: (...args: unknown[]) => mockSaveExpense(...args),
	updateExpense: (...args: unknown[]) => mockUpdateExpense(...args),
	// Story 3.3 (AC-7): the create-mode form seeds its first-create guard from existing expenses.
	// Default to empty so the existing first-create-save tests still fire onFirstCreateSave.
	getAllExpenses: () => Promise.resolve({ data: [], error: null })
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
			if (key === 'toast') {
				return mockToast;
			}
			return undefined;
		}
	};
});

describe('MaintenanceForm', () => {
	const onSaveSpy = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		// Story 2.3: the sync $effect now writes through to localStorage — clear it so a draft
		// (or its stale flag) from a prior test can't bleed into this one.
		localStorage.clear();
		clearMaintenanceDraft();
		mockSettings.value = {
			fuelUnit: 'L/100km',
			currency: '€',
			theme: 'system'
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

	it('seeds the Type field from initialType in create mode (Log this service prefill)', () => {
		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy, initialType: 'Oil change' });
		expect((screen.getByLabelText(/^type$/i) as HTMLInputElement).value).toBe('Oil change');
	});

	it('lets the initialType prefill win over a stale durable draft type', () => {
		maintenanceDraft['type'] = 'Tyres';
		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy, initialType: 'Oil change' });
		expect((screen.getByLabelText(/^type$/i) as HTMLInputElement).value).toBe('Oil change');
	});

	it('keeps the empty/draft Type behavior when no initialType is given', () => {
		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });
		expect((screen.getByLabelText(/^type$/i) as HTMLInputElement).value).toBe('');
	});

	it('uses the saved currency in success feedback', async () => {
		mockSettings.value = {
			fuelUnit: 'L/100km',
			currency: 'EUR ',
			theme: 'system'
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

		expect(screen.getByLabelText(/cost/i)).toBeTruthy();

		await fireEvent.input(screen.getByLabelText(/^type$/i), {
			target: { value: 'Insurance' }
		});
		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '100' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
		await Promise.resolve();
		flushSync();

		expect(screen.getByRole('status').textContent).toContain('EUR 100.00');
	});

	it('re-announces a byte-identical repeated save via an invisible nonce delta (A11Y-1)', async () => {
		const savedExpense: Expense = {
			id: 21,
			vehicleId: 7,
			date: new Date(2026, 2, 10, 12, 0, 0, 0),
			type: 'Insurance',
			cost: 100
		};
		mockSaveExpense.mockResolvedValue({ data: savedExpense, error: null });

		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });

		await fireEvent.input(screen.getByLabelText(/^type$/i), { target: { value: 'Insurance' } });
		await fireEvent.input(screen.getByLabelText(/cost/i), { target: { value: '100' } });
		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
		await Promise.resolve();
		flushSync();
		const first = screen.getByRole('status').textContent ?? '';

		// A byte-identical second save (same type + cost → same success message). Re-input first so the
		// second save is valid regardless of any field reset.
		await fireEvent.input(screen.getByLabelText(/^type$/i), { target: { value: 'Insurance' } });
		await fireEvent.input(screen.getByLabelText(/cost/i), { target: { value: '100' } });
		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
		await Promise.resolve();
		flushSync();
		const second = screen.getByRole('status').textContent ?? '';

		// The VISIBLE message is identical (the nonce is a zero-width space, stripped here)...
		const strip = (value: string) => value.replace(/\u200B/g, '');
		expect(strip(first)).toBe(strip(second));
		expect(strip(first)).toContain('Insurance');
		// ...but the RAW text differs, so the polite region presents a change and re-announces (A11Y-1).
		expect(first).not.toBe(second);
	});

	it('does not derive the maintenance odometer label from the fuel-unit preference', () => {
		mockSettings.value = {
			fuelUnit: 'MPG',
			currency: '€',
			theme: 'system'
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

	describe('Dual-mount focus scoping (Story 3.2 code-review regression)', () => {
		it('focuses the submitted instance own field when a duplicate-id form is co-mounted', async () => {
			// /history can keep an inline edit MaintenanceForm mounted while the global Capture sheet
			// mounts a SECOND MaintenanceForm with the SAME hardcoded ids (id="maintenance-type", ...).
			// First-invalid-field focus must target the SUBMITTED form's own input — not the first
			// match in document order, which a document-wide getElementById would wrongly return.
			render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });
			render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });
			await Promise.resolve();
			flushSync();

			// Both instances coexist in document.body with the SAME ids — the collision is the point.
			const types = document.querySelectorAll<HTMLInputElement>('[id="maintenance-type"]');
			const forms = document.querySelectorAll('form');
			expect(types.length).toBe(2);
			expect(forms.length).toBe(2);
			const firstType = types[0];
			const secondType = types[1];

			// Park focus on the FIRST instance, then submit the SECOND empty (Type is the first invalid
			// field — Date is pre-filled). The fix must MOVE focus into the second form; the pre-fix
			// global lookup would leave focus on the first instance's Type input (first in tree order).
			firstType.focus();
			expect(document.activeElement).toBe(firstType);

			await fireEvent.submit(forms[1] as HTMLFormElement);
			await Promise.resolve();
			flushSync();

			expect(document.activeElement).toBe(secondType);
		});
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

		// Story 2.4 (AC-7): failures surface on the toast channel, not an inline alert.
		expect(mockToast.error).toHaveBeenCalledWith(
			'Could not save maintenance entry. Please try again.'
		);
		expect(screen.queryByRole('alert')).toBeNull();
		expect((screen.getByLabelText(/^type$/i) as HTMLInputElement).value).toBe('Insurance');
		expect((screen.getByLabelText(/cost/i) as HTMLInputElement).value).toBe('100');
		expect(maintenanceDraft['type']).toBe('Insurance');
		expect(maintenanceDraft['cost']).toBe('100');
		expect(onSaveSpy).not.toHaveBeenCalled();
	});

	it('surfaces the specific storage-full message (not the generic one) when a create save hits quota', async () => {
		mockSaveExpense.mockResolvedValue({
			data: null,
			error: { code: 'QUOTA_EXCEEDED', message: QUOTA_EXCEEDED_MESSAGE }
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

		// Story 2.4 (AC-7): the specific quota message routes through the toast channel.
		expect(mockToast.error).toHaveBeenCalledWith(QUOTA_EXCEEDED_MESSAGE);
		expect(mockToast.error).not.toHaveBeenCalledWith(expect.stringContaining('Please try again'));
		expect(screen.queryByRole('alert')).toBeNull();
		// Input is preserved so the user can free space and retry without re-typing.
		expect((screen.getByLabelText(/cost/i) as HTMLInputElement).value).toBe('100');
		expect(onSaveSpy).not.toHaveBeenCalled();
	});

	it('surfaces the specific storage-full message when an edit update hits quota', async () => {
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
			error: { code: 'QUOTA_EXCEEDED', message: QUOTA_EXCEEDED_MESSAGE }
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

		// Story 2.4 (AC-7): the specific quota message routes through the toast channel.
		expect(mockToast.error).toHaveBeenCalledWith(QUOTA_EXCEEDED_MESSAGE);
		expect(mockToast.error).not.toHaveBeenCalledWith(expect.stringContaining('Please try again'));
		expect(screen.queryByRole('alert')).toBeNull();
		expect((screen.getByLabelText(/cost/i) as HTMLInputElement).value).toBe('150');
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
			currency: '€',
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

		// Story 2.4 (AC-7): failures surface on the toast channel, not an inline alert.
		expect(mockToast.error).toHaveBeenCalledWith(
			'Could not update maintenance entry. Please try again.'
		);
		expect(screen.queryByRole('alert')).toBeNull();
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

	it('calls onFirstCreateSave on the first successful create save', async () => {
		const savedExpense: Expense = {
			id: 30,
			vehicleId: 7,
			date: new Date(2026, 2, 10, 12, 0, 0, 0),
			type: 'Oil Change',
			cost: 78,
			notes: ''
		};
		mockSaveExpense.mockResolvedValue({ data: savedExpense, error: null });
		const onFirstCreateSaveSpy = vi.fn();

		render(MaintenanceForm, {
			vehicleId: 7,
			onSave: onSaveSpy,
			onFirstCreateSave: onFirstCreateSaveSpy
		});

		await fireEvent.input(screen.getByLabelText(/^type$/i), {
			target: { value: 'Oil Change' }
		});
		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '78' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
		await Promise.resolve();
		flushSync();

		expect(onFirstCreateSaveSpy).toHaveBeenCalledOnce();
		expect(onFirstCreateSaveSpy).toHaveBeenCalledWith(savedExpense);
	});

	it('does not call onFirstCreateSave on subsequent create saves', async () => {
		const savedExpense1: Expense = {
			id: 31,
			vehicleId: 7,
			date: new Date(2026, 2, 10, 12, 0, 0, 0),
			type: 'Oil Change',
			cost: 78,
			notes: ''
		};
		const savedExpense2: Expense = {
			id: 32,
			vehicleId: 7,
			date: new Date(2026, 2, 11, 12, 0, 0, 0),
			type: 'Tyres',
			cost: 320,
			notes: ''
		};
		mockSaveExpense
			.mockResolvedValueOnce({ data: savedExpense1, error: null })
			.mockResolvedValueOnce({ data: savedExpense2, error: null });
		const onFirstCreateSaveSpy = vi.fn();

		render(MaintenanceForm, {
			vehicleId: 7,
			onSave: onSaveSpy,
			onFirstCreateSave: onFirstCreateSaveSpy
		});

		// First save
		await fireEvent.input(screen.getByLabelText(/^type$/i), {
			target: { value: 'Oil Change' }
		});
		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '78' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
		await Promise.resolve();
		flushSync();

		// Second save
		await fireEvent.input(screen.getByLabelText(/^type$/i), {
			target: { value: 'Tyres' }
		});
		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '320' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
		await Promise.resolve();
		flushSync();

		expect(onFirstCreateSaveSpy).toHaveBeenCalledOnce();
	});

	it('does not call onFirstCreateSave in edit mode', async () => {
		const existingExpense: Expense = {
			id: 33,
			vehicleId: 7,
			date: new Date(2026, 2, 8, 12, 0, 0, 0),
			type: 'Service',
			cost: 120,
			notes: ''
		};
		const updatedExpense: Expense = { ...existingExpense, cost: 130 };
		mockUpdateExpense.mockResolvedValue({ data: updatedExpense, error: null });
		const onFirstCreateSaveSpy = vi.fn();

		render(MaintenanceForm, {
			vehicleId: 7,
			mode: 'edit',
			initialExpense: existingExpense,
			onSave: onSaveSpy,
			onFirstCreateSave: onFirstCreateSaveSpy
		});

		await fireEvent.input(screen.getByLabelText(/cost/i), {
			target: { value: '130' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
		await Promise.resolve();
		flushSync();

		expect(onFirstCreateSaveSpy).not.toHaveBeenCalled();
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

	// Story 2.2 (AC-2/AC-6): recent-currency chips work identically in the Expense form.
	it('renders a recent-currency chip and applies it on tap', async () => {
		setLastUsedCurrency('$');
		setLastUsedCurrency('€');

		render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy });
		flushSync();

		const currencySelect = screen.getByLabelText(/currency/i) as HTMLSelectElement;
		expect(currencySelect.value).toBe('€');

		const dollarChip = screen.getByRole('button', { name: '$' });
		await fireEvent.click(dollarChip);
		flushSync();

		expect(currencySelect.value).toBe('$');
	});

	// Story 2.4 (AC-7): the Expense confirmation persists until dismissed — no 3s auto-dismiss, a
	// keyboard-operable Done control, calm "Saved." voice, no consumption/sparkline.
	describe('Story 2.4: persist-until-dismissed', () => {
		const savedExpense: Expense = {
			id: 9,
			vehicleId: 7,
			date: new Date(2026, 2, 8, 12, 0, 0, 0),
			type: 'Oil Change',
			cost: 100,
			currency: '€',
			notes: ''
		};

		async function fillAndSave(onDone: () => void) {
			render(MaintenanceForm, {
				vehicleId: 7,
				onSave: onSaveSpy,
				onSuccessFeedbackComplete: onDone
			});
			flushSync();
			await fireEvent.input(screen.getByLabelText(/^type$/i), { target: { value: 'Oil Change' } });
			await fireEvent.input(screen.getByLabelText(/cost/i), { target: { value: '100' } });
			await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
			await Promise.resolve();
			flushSync();
		}

		it('does NOT auto-dismiss after 3 seconds', async () => {
			mockSaveExpense.mockResolvedValue({ data: savedExpense, error: null });
			const onDone = vi.fn();
			vi.useFakeTimers();
			try {
				await fillAndSave(onDone);
				expect(screen.getByRole('status').textContent).toContain('Saved Oil Change');

				await vi.advanceTimersByTimeAsync(5000);
				flushSync();

				expect(screen.getByRole('status').textContent).toContain('Saved Oil Change');
				expect(onDone).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it('Done fires onSuccessFeedbackComplete and clears the confirmation', async () => {
			mockSaveExpense.mockResolvedValue({ data: savedExpense, error: null });
			const onDone = vi.fn();
			await fillAndSave(onDone);

			await fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
			flushSync();

			expect(onDone).toHaveBeenCalledTimes(1);
			expect(screen.getByRole('status').textContent).toBe('');
		});

		it('shows no consumption sparkline (expenses have none)', async () => {
			mockSaveExpense.mockResolvedValue({ data: savedExpense, error: null });
			await fillAndSave(vi.fn());

			expect(document.querySelector('svg[aria-hidden="true"]')).toBeNull();
		});
	});

	// Story 4.6 (FR-12 loop-close, AC3/AC7): the create-only onCreateSave callback fires the reminder
	// reset offer. It MUST fire on a create save (with the saved Expense) and MUST NOT fire on an edit.
	describe('onCreateSave (Story 4.6 — create-only loop-close hook)', () => {
		const savedExpense: Expense = {
			id: 99,
			vehicleId: 7,
			date: new Date(2026, 5, 24, 12, 0, 0, 0),
			type: 'Oil Change',
			odometer: 87400,
			cost: 78,
			currency: '€',
			notes: ''
		};

		it('fires on a successful create save with the saved expense', async () => {
			mockSaveExpense.mockResolvedValue({ data: savedExpense, error: null });
			const onCreateSave = vi.fn();
			render(MaintenanceForm, { vehicleId: 7, onSave: onSaveSpy, onCreateSave });

			await fireEvent.input(screen.getByLabelText(/^type$/i), { target: { value: 'Oil Change' } });
			await fireEvent.input(screen.getByLabelText(/cost/i), { target: { value: '78.00' } });
			await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
			await Promise.resolve();
			flushSync();

			expect(onCreateSave).toHaveBeenCalledTimes(1);
			expect(onCreateSave).toHaveBeenCalledWith(savedExpense);
		});

		it('does NOT fire on an edit save (the offer must never ride an edit)', async () => {
			const existingExpense: Expense = {
				id: 21,
				vehicleId: 7,
				date: new Date(2026, 2, 8, 12, 0, 0, 0),
				type: 'Tyres',
				odometer: 87200,
				cost: 320,
				currency: '€',
				notes: 'Winter set'
			};
			mockUpdateExpense.mockResolvedValue({
				data: { ...existingExpense, cost: 340 },
				error: null
			});
			const onCreateSave = vi.fn();
			render(MaintenanceForm, {
				vehicleId: 7,
				mode: 'edit',
				initialExpense: existingExpense,
				onSave: onSaveSpy,
				onCreateSave
			});

			await fireEvent.input(screen.getByLabelText(/cost/i), { target: { value: '340' } });
			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
			await Promise.resolve();
			flushSync();

			expect(mockUpdateExpense).toHaveBeenCalledTimes(1);
			expect(onCreateSave).not.toHaveBeenCalled();
		});
	});
});
