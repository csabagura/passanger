import 'fake-indexeddb/auto'; // MUST be first — patches global IndexedDB so liveQuery has a backing db
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import type { FuelLog, ServiceReminder } from '$lib/db/schema';
import { ok } from '$lib/utils/result';
import MaintainDashboard from './MaintainDashboard.svelte';

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

const mockGetAllFuelLogs = vi.fn();
const mockGetServiceRemindersForVehicle = vi.fn();
const mockDeleteServiceReminder = vi.fn();
const mockSaveServiceReminder = vi.fn();
const mockUpdateServiceReminder = vi.fn();

vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: (...args: unknown[]) => mockGetAllFuelLogs(...args)
}));

vi.mock('$lib/db/repositories/serviceReminders', () => ({
	getServiceRemindersForVehicle: (...args: unknown[]) => mockGetServiceRemindersForVehicle(...args),
	deleteServiceReminder: (...args: unknown[]) => mockDeleteServiceReminder(...args),
	saveServiceReminder: (...args: unknown[]) => mockSaveServiceReminder(...args),
	updateServiceReminder: (...args: unknown[]) => mockUpdateServiceReminder(...args)
}));

const VEHICLE_ID = 7;
// Reference "now" — 15 June 2026 (mirrors the prediction/cadence fixtures).
const NOW = new Date(2026, 5, 15, 9, 0, 0, 0);

function makeReminder(overrides: Partial<ServiceReminder> & { id: number }): ServiceReminder {
	return { vehicleId: VEHICLE_ID, title: 'Reminder', ...overrides };
}

function fuelLogAt(
	id: number,
	odometer: number,
	date: Date,
	distanceUnit: 'km' | 'mi' = 'km'
): FuelLog {
	return {
		id,
		vehicleId: VEHICLE_ID,
		date,
		odometer,
		quantity: 40,
		unit: 'L',
		distanceUnit,
		totalCost: 70,
		calculatedConsumption: 7,
		notes: ''
	};
}

// 3 logs spanning 20 days → cadence 35 km/day; max odometer 1700 = currentOdometer.
function cadenceLogs(): FuelLog[] {
	return [
		fuelLogAt(1, 1000, new Date(2026, 4, 26)),
		fuelLogAt(2, 1300, new Date(2026, 5, 5)),
		fuelLogAt(3, 1700, new Date(2026, 5, 15))
	];
}

function renderDashboard(props: Record<string, unknown> = {}) {
	return render(MaintainDashboard, {
		props: { vehicleId: VEHICLE_ID, vehicleName: 'Old Faithful', now: NOW, ...props }
	});
}

async function settle() {
	await waitFor(async () => {
		await new Promise<void>((r) => setTimeout(r, 0));
		flushSync();
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

describe('MaintainDashboard', () => {
	it('shows the cold-load skeleton before the liveQuery seed resolves', () => {
		mockGetServiceRemindersForVehicle.mockReturnValue(new Promise(() => {})); // never resolves
		mockGetAllFuelLogs.mockReturnValue(new Promise(() => {}));
		renderDashboard();
		expect(screen.getByText(/loading your reminders/i)).toBeTruthy();
	});

	it('lists EVERY reminder (including on-track) with status, ordered most-urgent-first', async () => {
		mockGetAllFuelLogs.mockResolvedValue(ok(cadenceLogs()));
		mockGetServiceRemindersForVehicle.mockResolvedValue(
			ok([
				// Input order deliberately NOT urgency order, to prove the sort.
				makeReminder({ id: 3, title: 'Brake fluid', intervalKm: 5000, lastServiceOdometer: 1000 }), // ok
				makeReminder({ id: 1, title: 'Oil change', intervalKm: 500, lastServiceOdometer: 1000 }), // overdue
				makeReminder({ id: 2, title: 'Air filter', intervalKm: 1000, lastServiceOdometer: 1000 }) // due-soon
			])
		);
		renderDashboard();
		await settle();

		const list = screen.getByRole('list', { name: /service reminders/i });
		const items = within(list).getAllByRole('listitem');
		expect(items).toHaveLength(3);
		// Most-urgent-first: overdue → due-soon → ok.
		expect(items[0].textContent).toContain('Oil change');
		expect(items[1].textContent).toContain('Air filter');
		expect(items[2].textContent).toContain('Brake fluid');

		// On-track reminders ARE shown here (unlike Home's Up-Next).
		expect(screen.getByText('On track')).toBeTruthy();
		expect(screen.getByText('Overdue')).toBeTruthy();
		expect(screen.getByText('Due soon')).toBeTruthy();
	});

	it('shows a predicted date for a distance reminder with sufficient cadence (FR-10/12)', async () => {
		mockGetAllFuelLogs.mockResolvedValue(ok(cadenceLogs()));
		mockGetServiceRemindersForVehicle.mockResolvedValue(
			ok([
				makeReminder({ id: 2, title: 'Air filter', intervalKm: 1000, lastServiceOdometer: 1000 })
			])
		);
		renderDashboard();
		await settle();
		expect(screen.getByText(/≈ due/)).toBeTruthy();
	});

	it('omits the date with an honest note when cadence is insufficient (AC4)', async () => {
		mockGetAllFuelLogs.mockResolvedValue(ok([fuelLogAt(1, 1700, new Date(2026, 5, 15))])); // 1 log
		mockGetServiceRemindersForVehicle.mockResolvedValue(
			ok([
				makeReminder({ id: 2, title: 'Air filter', intervalKm: 1000, lastServiceOdometer: 1000 })
			])
		);
		renderDashboard();
		await settle();
		expect(screen.getByText('Not enough recent driving to estimate a date yet.')).toBeTruthy();
		expect(screen.queryByText(/≈ due/)).toBeNull();
	});

	it('shows the database error state when a read rejects (dbError before loading)', async () => {
		mockGetServiceRemindersForVehicle.mockRejectedValue(new Error('boom'));
		mockGetAllFuelLogs.mockResolvedValue(ok([]));
		renderDashboard();
		await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
		expect(screen.getByText('Could not load your reminders')).toBeTruthy();
	});

	it('shows the calm empty state with an add CTA when there are no reminders', async () => {
		mockGetAllFuelLogs.mockResolvedValue(ok([]));
		mockGetServiceRemindersForVehicle.mockResolvedValue(ok([]));
		renderDashboard();
		await settle();
		expect(screen.getByText('No reminders yet')).toBeTruthy();
		expect(screen.getByRole('button', { name: /add reminder/i })).toBeTruthy();
	});

	it('opens the edit form pre-filled when Edit is clicked', async () => {
		mockGetAllFuelLogs.mockResolvedValue(ok(cadenceLogs()));
		mockGetServiceRemindersForVehicle.mockResolvedValue(
			ok([
				makeReminder({ id: 1, title: 'Oil change', intervalKm: 5000, lastServiceOdometer: 1000 })
			])
		);
		renderDashboard();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: /edit oil change/i }));
		flushSync();
		expect(screen.getByRole('heading', { name: /edit reminder/i })).toBeTruthy();
		expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe('Oil change');
	});

	it('confirms before deleting and calls the repository on confirm', async () => {
		mockGetAllFuelLogs.mockResolvedValue(ok(cadenceLogs()));
		mockGetServiceRemindersForVehicle.mockResolvedValue(
			ok([
				makeReminder({ id: 1, title: 'Oil change', intervalKm: 5000, lastServiceOdometer: 1000 })
			])
		);
		mockDeleteServiceReminder.mockResolvedValue(ok(undefined));
		renderDashboard();
		await settle();

		await fireEvent.click(screen.getByRole('button', { name: /delete oil change/i }));
		flushSync();
		const dialog = screen.getByRole('alertdialog');
		expect(within(dialog).getByText(/delete oil change\?/i)).toBeTruthy();

		await fireEvent.click(within(dialog).getByRole('button', { name: /confirm delete/i }));
		await settle();
		expect(mockDeleteServiceReminder).toHaveBeenCalledWith(1);
	});
});
