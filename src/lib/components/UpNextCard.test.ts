import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { FuelLog, ServiceReminder } from '$lib/db/schema';
import { REMINDER_DUE_SOON_KM } from '$lib/config';
import UpNextCard from './UpNextCard.svelte';

const mockGetServiceRemindersForVehicle = vi.fn();

vi.mock('$lib/db/repositories/serviceReminders', () => ({
	getServiceRemindersForVehicle: (...args: unknown[]) => mockGetServiceRemindersForVehicle(...args)
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

const openSheet = vi.fn();

function renderCard(fuelLogs: FuelLog[] = [fuelLogAt(60000)]) {
	const contextMap = new Map<string, unknown>();
	contextMap.set('tabSync', {
		get dataRevision() {
			return 0;
		}
	});
	contextMap.set('captureSheet', {
		open: false,
		mode: 'fuel',
		prefill: null,
		openSheet,
		setMode: vi.fn(),
		close: vi.fn()
	});
	return render(UpNextCard, {
		props: { vehicleId: 7, fuelLogs, today: TODAY },
		context: contextMap
	});
}

// Let the async load `$effect` settle.
async function flushLoad() {
	await waitFor(() => expect(mockGetServiceRemindersForVehicle).toHaveBeenCalled());
	await Promise.resolve();
	await Promise.resolve();
}

describe('UpNextCard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		globalThis.localStorage.clear();
	});

	afterEach(() => {
		cleanup();
		globalThis.localStorage.clear();
	});

	it('renders nothing when no reminder is due-soon or overdue', async () => {
		// due at 70000, current 60000 → 10000 remaining → ok.
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [makeReminder({ id: 1, intervalKm: 20000, lastServiceOdometer: 50000 })],
			error: null
		});
		renderCard();
		await flushLoad();
		expect(screen.queryByText('Up next')).toBeNull();
	});

	it('renders nothing (silently) when reminders fail to load', async () => {
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: null,
			error: { code: 'LOAD_FAILED', message: 'boom' }
		});
		renderCard();
		await flushLoad();
		expect(screen.queryByText('Up next')).toBeNull();
	});

	it('renders only the single most-urgent reminder (overdue beats due-soon)', async () => {
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				// Input order intentionally due-soon first to prove overdue is hoisted.
				makeReminder({ id: 1, title: 'Air filter', intervalKm: 10300, lastServiceOdometer: 50000 }), // 300 → due-soon
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 5000, lastServiceOdometer: 50000 }) // -5000 → overdue
			],
			error: null
		});
		renderCard();

		await screen.findByText('Up next');
		expect(screen.getByText('Oil change')).toBeTruthy();
		// The overdue status word + human label are present.
		expect(screen.getByText(/Overdue · Overdue by 5,000 km/)).toBeTruthy();
		// The due-soon reminder is NOT shown (single most-urgent only).
		expect(screen.queryByText('Air filter')).toBeNull();
	});

	it('PREP-1: a non-finite odometer row does not poison currentOdometer (km reminder still computes)', async () => {
		// due at 55000, current 60000 → -5000 → overdue. A corrupt NaN-odometer row must be dropped from
		// the max-reduce; if it leaked, currentOdometer would be NaN → status falls back to ok → card hides.
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 5000, lastServiceOdometer: 50000 })
			],
			error: null
		});
		const corrupt = { ...fuelLogAt(Number.NaN), id: 2 };
		renderCard([fuelLogAt(60000), corrupt]);

		await screen.findByText('Up next');
		expect(screen.getByText('Oil change')).toBeTruthy();
		expect(screen.getByText(/Overdue · Overdue by 5,000 km/)).toBeTruthy();
	});

	it('"Log this service" opens Capture(Expense) prefilled with the reminder title', async () => {
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 5000, lastServiceOdometer: 50000 })
			],
			error: null
		});
		renderCard();

		const button = await screen.findByRole('button', { name: 'Log this service' });
		await fireEvent.click(button);
		expect(openSheet).toHaveBeenCalledWith('expense', { expenseType: 'Oil change' });
	});

	it('dismissing hides the card and reveals the next-most-urgent', async () => {
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 5000, lastServiceOdometer: 50000 }), // overdue
				makeReminder({ id: 1, title: 'Air filter', intervalKm: 10300, lastServiceOdometer: 50000 }) // due-soon
			],
			error: null
		});
		renderCard();

		// Most-urgent overdue shows first.
		await screen.findByText('Oil change');
		const dismiss = screen.getByRole('button', { name: 'Dismiss Oil change reminder' });
		await fireEvent.click(dismiss);

		// Now the next-most-urgent (due-soon Air filter) surfaces.
		await screen.findByText('Air filter');
		expect(screen.queryByText('Oil change')).toBeNull();
	});

	it('keeps a dismissed reminder hidden across a reload while not worsened', async () => {
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 5000, lastServiceOdometer: 50000 })
			],
			error: null
		});
		renderCard();
		await screen.findByText('Oil change');
		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss Oil change reminder' }));
		await waitFor(() => expect(screen.queryByText('Oil change')).toBeNull());

		cleanup();
		// Re-render (simulates a reload) with the same odometer → still suppressed.
		renderCard();
		await flushLoad();
		expect(screen.queryByText('Oil change')).toBeNull();
	});

	it('re-surfaces a dismissed reminder after driving a full due-soon window further', async () => {
		const overdue = makeReminder({
			id: 2,
			title: 'Oil change',
			intervalKm: 5000,
			lastServiceOdometer: 50000
		});
		mockGetServiceRemindersForVehicle.mockResolvedValue({ data: [overdue], error: null });
		renderCard([fuelLogAt(60000)]);
		await screen.findByText('Oil change');
		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss Oil change reminder' }));
		await waitFor(() => expect(screen.queryByText('Oil change')).toBeNull());

		cleanup();
		// Driven another full due-soon window past the dismissal odometer → re-surface.
		renderCard([fuelLogAt(60000 + REMINDER_DUE_SOON_KM)]);
		expect(await screen.findByText('Oil change')).toBeTruthy();
	});
});
