import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import ServiceReminderManager from './ServiceReminderManager.svelte';
import type { ServiceReminder } from '$lib/db/schema';

const mockGetServiceRemindersForVehicle = vi.fn();
const mockDeleteServiceReminder = vi.fn();
const mockSaveServiceReminder = vi.fn();
const mockUpdateServiceReminder = vi.fn();

vi.mock('$lib/db/repositories/serviceReminders', () => ({
	getServiceRemindersForVehicle: (...args: unknown[]) => mockGetServiceRemindersForVehicle(...args),
	deleteServiceReminder: (...args: unknown[]) => mockDeleteServiceReminder(...args),
	saveServiceReminder: (...args: unknown[]) => mockSaveServiceReminder(...args),
	updateServiceReminder: (...args: unknown[]) => mockUpdateServiceReminder(...args)
}));

// Fixed date so the computed labels are deterministic.
const TODAY = new Date(2026, 5, 15);

function makeReminder(overrides: Partial<ServiceReminder> & { id: number }): ServiceReminder {
	return { vehicleId: 1, title: 'Reminder', ...overrides };
}

// Overdue on distance: due at 60000, current 60120 → -120 km.
const overdueReminder = makeReminder({
	id: 1,
	title: 'Oil change',
	intervalKm: 10000,
	lastServiceOdometer: 50000
});
// On track on distance: due at 90000, current 60120 → 29880 km.
const okReminder = makeReminder({
	id: 2,
	title: 'Brake fluid',
	intervalKm: 40000,
	lastServiceOdometer: 50000
});

function setupReminders(reminders: ServiceReminder[]) {
	mockGetServiceRemindersForVehicle.mockResolvedValue({ data: reminders, error: null });
}

async function renderAndWait(props: Record<string, unknown> = {}) {
	render(ServiceReminderManager, { vehicleId: 1, currentOdometer: 60120, today: TODAY, ...props });
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}

describe('ServiceReminderManager', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	describe('list rendering', () => {
		it('renders each reminder as a semantic list item with title and status', async () => {
			setupReminders([overdueReminder, okReminder]);
			await renderAndWait();

			const list = screen.getByRole('list', { name: /service reminders/i });
			expect(within(list).getAllByRole('listitem')).toHaveLength(2);
			expect(screen.getByText('Oil change')).toBeTruthy();
			expect(screen.getByText('Brake fluid')).toBeTruthy();
		});

		it('shows the computed due label and status badge from the util (overdue)', async () => {
			setupReminders([overdueReminder]);
			await renderAndWait();
			expect(screen.getByText('Overdue by 120 km')).toBeTruthy();
			expect(screen.getByText('Overdue')).toBeTruthy();
		});

		it('shows an on-track status for a reminder far from due', async () => {
			setupReminders([okReminder]);
			await renderAndWait();
			expect(screen.getByText('On track')).toBeTruthy();
			expect(screen.getByText('Due in 29,880 km')).toBeTruthy();
		});

		it('shows the empty state with an add CTA when there are no reminders', async () => {
			setupReminders([]);
			await renderAndWait();
			expect(screen.getByText(/no reminders yet/i)).toBeTruthy();
			expect(screen.getByRole('button', { name: /add reminder/i })).toBeTruthy();
		});

		it('renders an error message when loading fails', async () => {
			mockGetServiceRemindersForVehicle.mockResolvedValue({
				data: null,
				error: { code: 'GET_FAILED', message: 'boom' }
			});
			render(ServiceReminderManager, { vehicleId: 1, today: TODAY });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/could not load reminders/i)).toBeTruthy();
		});
	});

	describe('create flow', () => {
		it('switches to the add-reminder form when Add reminder is clicked', async () => {
			setupReminders([overdueReminder]);
			await renderAndWait();
			await fireEvent.click(screen.getByRole('button', { name: /add reminder/i }));
			flushSync();
			expect(screen.getByRole('heading', { name: /add reminder/i })).toBeTruthy();
		});

		it('switches to the form from the empty-state CTA', async () => {
			setupReminders([]);
			await renderAndWait();
			await fireEvent.click(screen.getByRole('button', { name: /add reminder/i }));
			flushSync();
			expect(screen.getByRole('heading', { name: /add reminder/i })).toBeTruthy();
		});
	});

	describe('edit flow', () => {
		it('opens the edit form pre-filled with the reminder title', async () => {
			setupReminders([overdueReminder]);
			await renderAndWait();
			await fireEvent.click(screen.getByRole('button', { name: /edit oil change/i }));
			flushSync();
			expect(screen.getByRole('heading', { name: /edit reminder/i })).toBeTruthy();
			expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe('Oil change');
		});
	});

	describe('delete flow', () => {
		it('shows a confirmation alertdialog when Delete is clicked', async () => {
			setupReminders([overdueReminder, okReminder]);
			await renderAndWait();
			await fireEvent.click(screen.getByRole('button', { name: /delete oil change/i }));
			flushSync();
			const dialog = screen.getByRole('alertdialog');
			expect(dialog).toBeTruthy();
			expect(within(dialog).getByText(/delete oil change\?/i)).toBeTruthy();
		});

		it('hides the confirmation when Cancel is clicked', async () => {
			setupReminders([overdueReminder, okReminder]);
			await renderAndWait();
			await fireEvent.click(screen.getByRole('button', { name: /delete oil change/i }));
			flushSync();
			await fireEvent.click(
				within(screen.getByRole('alertdialog')).getByRole('button', {
					name: /cancel/i
				})
			);
			flushSync();
			expect(screen.queryByRole('alertdialog')).toBeNull();
		});

		it('calls deleteServiceReminder and removes the reminder on confirm', async () => {
			mockDeleteServiceReminder.mockResolvedValue({ data: undefined, error: null });
			setupReminders([overdueReminder, okReminder]);
			await renderAndWait();

			await fireEvent.click(screen.getByRole('button', { name: /delete oil change/i }));
			flushSync();

			// Next load returns only the remaining reminder.
			mockGetServiceRemindersForVehicle.mockResolvedValueOnce({ data: [okReminder], error: null });

			await fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockDeleteServiceReminder).toHaveBeenCalledWith(1);
			expect(screen.queryByText('Oil change')).toBeNull();
			expect(screen.getByText('Brake fluid')).toBeTruthy();
		});
	});
});
