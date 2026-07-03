import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import ServiceReminderForm from './ServiceReminderForm.svelte';
import { getTodayDateInputValue, toLocalDateInputValue } from '$lib/utils/date';
import type { ServiceReminder } from '$lib/db/schema';

const mockSaveServiceReminder = vi.fn();
const mockUpdateServiceReminder = vi.fn();

vi.mock('$lib/db/repositories/serviceReminders', () => ({
	saveServiceReminder: (...args: unknown[]) => mockSaveServiceReminder(...args),
	updateServiceReminder: (...args: unknown[]) => mockUpdateServiceReminder(...args)
}));

const mockOnSave = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

describe('ServiceReminderForm', () => {
	describe('rendering', () => {
		it('renders the core fields', () => {
			render(ServiceReminderForm, { vehicleId: 1, onSave: mockOnSave });
			expect(screen.getByLabelText(/title/i)).toBeTruthy();
			expect(screen.getByLabelText(/last service date/i)).toBeTruthy();
		});
	});

	// Story 8.5 / S26: the date input rejects a future date, past-or-today only.
	describe('past-only date validation (S26)', () => {
		it('rejects a future date on blur', async () => {
			render(ServiceReminderForm, { vehicleId: 1, onSave: mockOnSave });
			const dateInput = screen.getByLabelText(/last service date/i);
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			await fireEvent.input(dateInput, { target: { value: toLocalDateInputValue(tomorrow) } });
			await fireEvent.blur(dateInput);
			expect(screen.getByText('Date cannot be in the future')).toBeTruthy();
		});

		it('accepts today', async () => {
			render(ServiceReminderForm, { vehicleId: 1, onSave: mockOnSave });
			const dateInput = screen.getByLabelText(/last service date/i);
			await fireEvent.input(dateInput, { target: { value: getTodayDateInputValue() } });
			await fireEvent.blur(dateInput);
			expect(screen.queryByText('Date cannot be in the future')).toBeNull();
			expect(screen.queryByText('Enter a valid date')).toBeNull();
		});

		it('accepts a past date', async () => {
			render(ServiceReminderForm, { vehicleId: 1, onSave: mockOnSave });
			const dateInput = screen.getByLabelText(/last service date/i);
			await fireEvent.input(dateInput, { target: { value: '2020-01-01' } });
			await fireEvent.blur(dateInput);
			expect(screen.queryByText('Date cannot be in the future')).toBeNull();
		});

		it('clears the future-date error when corrected to a past date', async () => {
			render(ServiceReminderForm, { vehicleId: 1, onSave: mockOnSave });
			const dateInput = screen.getByLabelText(/last service date/i);
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			await fireEvent.input(dateInput, { target: { value: toLocalDateInputValue(tomorrow) } });
			await fireEvent.blur(dateInput);
			expect(screen.getByText('Date cannot be in the future')).toBeTruthy();

			await fireEvent.input(dateInput, { target: { value: '2020-01-01' } });
			expect(screen.queryByText('Date cannot be in the future')).toBeNull();
		});

		it('blocks submit while the date is in the future', async () => {
			render(ServiceReminderForm, { vehicleId: 1, onSave: mockOnSave });
			await fireEvent.input(screen.getByLabelText(/title/i), { target: { value: 'Oil change' } });
			await fireEvent.input(screen.getByLabelText(/every \(km\)/i), {
				target: { value: '10000' }
			});
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			await fireEvent.input(screen.getByLabelText(/last service date/i), {
				target: { value: toLocalDateInputValue(tomorrow) }
			});

			const form = screen.getByRole('button', { name: /save reminder/i }).closest('form')!;
			await fireEvent.submit(form);

			expect(mockSaveServiceReminder).not.toHaveBeenCalled();
			expect(screen.getByText('Date cannot be in the future')).toBeTruthy();
		});
	});

	describe('edit mode with an existing lastServiceDate', () => {
		it('does not flag a pre-existing past date as an error on mount', () => {
			const reminder: ServiceReminder = {
				id: 1,
				vehicleId: 1,
				title: 'Oil change',
				intervalKm: 10000,
				lastServiceDate: new Date('2025-01-01')
			};
			render(ServiceReminderForm, { vehicleId: 1, onSave: mockOnSave, initialReminder: reminder });
			expect(screen.queryByText('Date cannot be in the future')).toBeNull();
		});
	});
});
