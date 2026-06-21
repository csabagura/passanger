import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { FuelLog, ServiceReminder } from '$lib/db/schema';
import RemindersDueCard from './RemindersDueCard.svelte';

const mockGetServiceRemindersForVehicle = vi.fn();
const mockGetAllFuelLogs = vi.fn();
const mockGoto = vi.fn();

vi.mock('$lib/db/repositories/serviceReminders', () => ({
	getServiceRemindersForVehicle: (...args: unknown[]) => mockGetServiceRemindersForVehicle(...args)
}));

vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: (...args: unknown[]) => mockGetAllFuelLogs(...args)
}));

vi.mock('$app/navigation', () => ({
	goto: (...args: unknown[]) => mockGoto(...args)
}));

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

const TODAY = new Date(2026, 5, 15);

function makeReminder(overrides: Partial<ServiceReminder> = {}): ServiceReminder {
	return { id: 1, vehicleId: 7, title: 'Oil change', ...overrides };
}

function fuelLogAt(odometer: number): FuelLog {
	return {
		id: 1,
		vehicleId: 7,
		date: new Date('2026-03-10T12:00:00Z'),
		odometer,
		quantity: 40,
		unit: 'L',
		distanceUnit: 'km',
		totalCost: 70,
		calculatedConsumption: 7,
		notes: ''
	};
}

function renderCard() {
	const contextMap = new Map<string, unknown>();
	contextMap.set('tabSync', {
		get dataRevision() {
			return 0;
		}
	});
	return render(RemindersDueCard, {
		props: { vehicleId: 7, today: TODAY, refreshSignal: 0 },
		context: contextMap
	});
}

// Let the async load `$effect` (two awaited repo reads) settle.
async function flushLoad() {
	await waitFor(() => expect(mockGetServiceRemindersForVehicle).toHaveBeenCalled());
	await Promise.resolve();
	await Promise.resolve();
}

describe('RemindersDueCard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAllFuelLogs.mockResolvedValue({ data: [fuelLogAt(60000)], error: null });
	});

	afterEach(() => {
		cleanup();
	});

	it('renders nothing when no reminder is due-soon or overdue', async () => {
		// due at 70000, current 60000 → 10000 remaining → ok.
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [makeReminder({ id: 1, intervalKm: 20000, lastServiceOdometer: 50000 })],
			error: null
		});
		renderCard();
		await flushLoad();
		expect(screen.queryByText('Maintenance due')).toBeNull();
		expect(screen.queryByRole('list', { name: 'Due reminders' })).toBeNull();
	});

	it('renders nothing (silently) when reminders fail to load', async () => {
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: null,
			error: { code: 'LOAD_FAILED', message: 'boom' }
		});
		renderCard();
		await flushLoad();
		expect(screen.queryByText('Maintenance due')).toBeNull();
		// Short-circuits before reading fuel logs.
		expect(mockGetAllFuelLogs).not.toHaveBeenCalled();
	});

	it('lists overdue then due-soon reminders with badge + human label', async () => {
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				// Input order intentionally due-soon first to prove overdue is hoisted.
				makeReminder({ id: 1, title: 'Air filter', intervalKm: 10300, lastServiceOdometer: 50000 }), // 300 → due-soon
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 5000, lastServiceOdometer: 50000 }) // -5000 → overdue
			],
			error: null
		});
		renderCard();

		const list = await screen.findByRole('list', { name: 'Due reminders' });
		const items = within(list).getAllByRole('listitem');
		expect(items).toHaveLength(2);

		// Overdue first.
		expect(items[0].textContent).toContain('Oil change');
		expect(items[0].textContent).toContain('Overdue'); // badge
		expect(items[0].textContent).toContain('Overdue by 5,000 km'); // human label

		// Then due-soon.
		expect(items[1].textContent).toContain('Air filter');
		expect(items[1].textContent).toContain('Due soon');
		expect(items[1].textContent).toContain('Due in 300 km');
	});

	it('navigates to the Settings reminders section when a row is tapped', async () => {
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 5000, lastServiceOdometer: 50000 })
			],
			error: null
		});
		renderCard();

		const list = await screen.findByRole('list', { name: 'Due reminders' });
		const row = within(list).getAllByRole('button')[0];
		await fireEvent.click(row);
		expect(mockGoto).toHaveBeenCalledWith('/settings#settings-reminders-heading');
	});
});
