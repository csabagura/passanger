import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { FuelLog, ServiceReminder } from '$lib/db/schema';
import { REMINDER_DISMISSED_STORAGE_KEY } from '$lib/config';
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

// 3 logs in the trailing 90-day window spanning 20 days → cadence reports 35 km/day; max odometer
// 1700 fixes currentOdometer. Lets a distance reminder produce a real predicted date.
function cadenceLogs(): FuelLog[] {
	return [
		{ ...fuelLogAt(1000), id: 1, date: new Date(2026, 4, 26) },
		{ ...fuelLogAt(1300), id: 2, date: new Date(2026, 5, 5) },
		{ ...fuelLogAt(1700), id: 3, date: new Date(2026, 5, 15) }
	];
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

// Seed/read dismissal markers directly (same shape reminderDismissal.ts persists — Story 8.5
// due-instance model: dueAtOdometer/dueAtDate, not the pre-8.5 odometer offset).
function seedDismissal(id: number, status: 'due-soon' | 'overdue', dueAtOdometer?: number) {
	const raw = globalThis.localStorage.getItem(REMINDER_DISMISSED_STORAGE_KEY);
	const map = raw ? JSON.parse(raw) : {};
	map[id] = { status, dueAtOdometer };
	globalThis.localStorage.setItem(REMINDER_DISMISSED_STORAGE_KEY, JSON.stringify(map));
}

function readDismissalMap(): Record<string, unknown> {
	const raw = globalThis.localStorage.getItem(REMINDER_DISMISSED_STORAGE_KEY);
	return raw ? JSON.parse(raw) : {};
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
		// Both due-soon (not overdue — Story 8.5's exact-expiry model has no real "snooze until"
		// point for an already-overdue reminder, since its due instance has already passed; a
		// due-soon dismissal snoozes until the still-in-the-future due instance, which is what this
		// interaction actually exercises).
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 10300, lastServiceOdometer: 50000 }), // due-soon, due 60300
				makeReminder({ id: 1, title: 'Air filter', intervalKm: 10400, lastServiceOdometer: 50000 }) // due-soon, due 60400
			],
			error: null
		});
		renderCard();

		// Most-urgent (input order, both due-soon) shows first.
		await screen.findByText('Oil change');
		const dismiss = screen.getByRole('button', { name: 'Dismiss Oil change reminder' });
		await fireEvent.click(dismiss);

		// Now the next-most-urgent (Air filter) surfaces.
		await screen.findByText('Air filter');
		expect(screen.queryByText('Oil change')).toBeNull();
	});

	it('keeps a dismissed reminder hidden across a reload while not worsened', async () => {
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 10300, lastServiceOdometer: 50000 }) // due-soon, due 60300
			],
			error: null
		});
		renderCard();
		await screen.findByText('Oil change');
		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss Oil change reminder' }));
		await waitFor(() => expect(screen.queryByText('Oil change')).toBeNull());

		cleanup();
		// Re-render (simulates a reload) with the same odometer, still short of the due instance → still suppressed.
		renderCard();
		await flushLoad();
		expect(screen.queryByText('Oil change')).toBeNull();
	});

	it('dismissing an OVERDUE reminder has no suppressive effect (its due instance already passed)', async () => {
		// Story 8.5 / AD-RT-4: exact-expiry means an overdue reminder's due threshold has already
		// been reached BY DEFINITION — there is no future instance left to snooze until, so the
		// dismissal marker never suppresses it. Honest-signals ethos: you cannot dismiss away a fact
		// that is already true (mirrors H11a's "no false 0-default").
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 5000, lastServiceOdometer: 50000 }) // overdue, due 55000
			],
			error: null
		});
		renderCard();
		await screen.findByText('Oil change');
		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss Oil change reminder' }));

		// The card is still showing — dismissing an already-passed due instance is a no-op.
		expect(await screen.findByText('Oil change')).toBeTruthy();
	});

	it('shows a predicted due date for a due-soon distance reminder with sufficient cadence (FR-10/12)', async () => {
		// due at 2000, currentOdometer 1700 → 300 km remaining → due-soon; 35 km/day → ~9 days out.
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 1000, lastServiceOdometer: 1000 })
			],
			error: null
		});
		renderCard(cadenceLogs());
		await screen.findByText('Oil change');
		// The "≈ due …" prefix is a literal in the helper (the relative words are locale-dependent).
		expect(screen.getByText(/≈ due/)).toBeTruthy();
	});

	it('omits the date with an honest note when cadence is insufficient (AC4)', async () => {
		// A single log → cadence too-few-logs. Due-soon distance reminder still renders, with the note.
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 10300, lastServiceOdometer: 50000 })
			],
			error: null
		});
		renderCard([fuelLogAt(60000)]);
		await screen.findByText('Oil change');
		expect(screen.getByText('Not enough recent driving to estimate a date yet.')).toBeTruthy();
		expect(screen.queryByText(/≈ due/)).toBeNull();
	});

	it('shows neither a date nor a cadence note for a time-only reminder', async () => {
		// 14-day interval, serviced ~10 days ago → due-soon on time, no distance interval to predict.
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				makeReminder({
					id: 2,
					title: 'Inspection',
					intervalDays: 14,
					lastServiceDate: new Date(2026, 5, 5)
				})
			],
			error: null
		});
		renderCard(cadenceLogs());
		await screen.findByText('Inspection');
		expect(screen.queryByText(/≈ due/)).toBeNull();
		expect(screen.queryByText(/Not enough recent driving/)).toBeNull();
	});

	it("H10a: leaves another vehicle's dismissal marker alone during the prune", async () => {
		// Vehicle 7 owns ids 1 (not due → its stale marker must be pruned) and 2 (overdue → renders).
		// Marker 99 belongs to a DIFFERENT vehicle's reminder — the global-map prune used to clear it
		// on every render because it can never be in the active vehicle's due set.
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [
				makeReminder({ id: 1, title: 'Air filter', intervalKm: 20000, lastServiceOdometer: 50000 }),
				makeReminder({ id: 2, title: 'Oil change', intervalKm: 5000, lastServiceOdometer: 50000 })
			],
			error: null
		});
		seedDismissal(1, 'due-soon', 55000);
		seedDismissal(99, 'overdue', 12000);
		renderCard();

		await screen.findByText('Oil change');
		// Marker 1 (this vehicle, no longer due) getting pruned proves the cleanup ran…
		await waitFor(() => expect(readDismissalMap()[1]).toBeUndefined());
		// …and the other vehicle's marker survived it.
		expect(readDismissalMap()[99]).toEqual({ status: 'overdue', dueAtOdometer: 12000 });
	});

	it('H10a: never prunes dismissals after a failed reminder read', async () => {
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: null,
			error: { code: 'LOAD_FAILED', message: 'boom' }
		});
		seedDismissal(2, 'overdue', 60000);
		seedDismissal(99, 'due-soon', 12000);
		renderCard();
		await flushLoad();

		// Existing silent-error behavior preserved: no card…
		expect(screen.queryByText('Up next')).toBeNull();
		// …and one transient read failure must not wipe ANY dismissal (it used to wipe all of them).
		const map = readDismissalMap();
		expect(map[2]).toEqual({ status: 'overdue', dueAtOdometer: 60000 });
		expect(map[99]).toEqual({ status: 'due-soon', dueAtOdometer: 12000 });
	});

	it("prunes this vehicle's marker once its reminder is no longer due (existing behavior)", async () => {
		// due at 70000, current 60000 → ok (not due) → the stale marker for id 1 is cleared.
		mockGetServiceRemindersForVehicle.mockResolvedValue({
			data: [makeReminder({ id: 1, intervalKm: 20000, lastServiceOdometer: 50000 })],
			error: null
		});
		seedDismissal(1, 'due-soon', 55000);
		renderCard();
		await flushLoad();

		await waitFor(() => expect(readDismissalMap()[1]).toBeUndefined());
	});

	it('re-surfaces a dismissed due-soon reminder EXACTLY at its due instance (Story 8.5, no more fuzz window)', async () => {
		// due-soon: due at 55000, dismissed while at 54600 (400 remaining).
		const dueSoon = makeReminder({
			id: 2,
			title: 'Oil change',
			intervalKm: 5000,
			lastServiceOdometer: 50000
		});
		mockGetServiceRemindersForVehicle.mockResolvedValue({ data: [dueSoon], error: null });
		renderCard([fuelLogAt(54600)]);
		await screen.findByText('Oil change');
		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss Oil change reminder' }));
		await waitFor(() => expect(screen.queryByText('Oil change')).toBeNull());

		cleanup();
		// One km short of the exact due instance → still suppressed (no more +REMINDER_DUE_SOON_KM fuzz).
		renderCard([fuelLogAt(54999)]);
		await flushLoad();
		expect(screen.queryByText('Oil change')).toBeNull();

		cleanup();
		// Reached the exact due instance (now overdue — status worsened) → re-surfaces.
		renderCard([fuelLogAt(55000)]);
		expect(await screen.findByText('Oil change')).toBeTruthy();
	});
});
