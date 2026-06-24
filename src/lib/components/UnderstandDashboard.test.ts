import 'fake-indexeddb/auto'; // MUST be first — patches global IndexedDB so liveQuery has a backing db
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import type { Expense, FuelLog } from '$lib/db/schema';
import { ok } from '$lib/utils/result';
import UnderstandDashboard from './UnderstandDashboard.svelte';

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

const mockGetAllFuelLogs = vi.fn();
const mockGetAllExpenses = vi.fn();

vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: (...args: unknown[]) => mockGetAllFuelLogs(...args)
}));

vi.mock('$lib/db/repositories/expenses', () => ({
	getAllExpenses: (...args: unknown[]) => mockGetAllExpenses(...args)
}));

const VEHICLE_ID = 7;

function createFuelEntry(overrides: Partial<FuelLog> = {}): FuelLog {
	return {
		id: overrides.id ?? 9,
		vehicleId: overrides.vehicleId ?? VEHICLE_ID,
		date: overrides.date ?? new Date(2026, 2, 10, 12, 0, 0, 0),
		odometer: overrides.odometer ?? 87400,
		quantity: overrides.quantity ?? 40,
		unit: overrides.unit ?? 'L',
		distanceUnit: overrides.distanceUnit ?? 'km',
		totalCost: overrides.totalCost ?? 60,
		currency: overrides.currency,
		calculatedConsumption: overrides.calculatedConsumption ?? 8,
		notes: overrides.notes ?? ''
	};
}

function createMaintenanceEntry(overrides: Partial<Expense> = {}): Expense {
	return {
		id: overrides.id ?? 12,
		vehicleId: overrides.vehicleId ?? VEHICLE_ID,
		date: overrides.date ?? new Date(2026, 2, 10, 12, 0, 0, 0),
		type: overrides.type ?? 'Oil Change',
		odometer: overrides.odometer ?? 87400,
		cost: overrides.cost ?? 120,
		currency: overrides.currency,
		notes: overrides.notes ?? ''
	};
}

function renderDashboard(props: Record<string, unknown> = {}) {
	const context = new Map<string, unknown>();
	context.set('settings', {
		get settings() {
			return { fuelUnit: 'L/100km' as const, currency: '€', theme: 'system' as const };
		}
	});
	return render(UnderstandDashboard, {
		props: { vehicleId: VEHICLE_ID, vehicleName: 'Old Faithful', ...props },
		context
	});
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('UnderstandDashboard', () => {
	it('shows the cold-load skeleton before the liveQuery seed resolves', () => {
		mockGetAllFuelLogs.mockReturnValue(new Promise(() => {})); // never resolves
		mockGetAllExpenses.mockReturnValue(new Promise(() => {}));
		renderDashboard();
		expect(screen.getByText(/loading your analytics/i)).toBeTruthy();
	});

	it('renders the four chart headings once data loads', async () => {
		mockGetAllFuelLogs.mockResolvedValue(
			ok([
				createFuelEntry({
					id: 1,
					date: new Date(2026, 1, 10),
					calculatedConsumption: 8,
					currency: '€'
				}),
				createFuelEntry({
					id: 2,
					date: new Date(2026, 2, 12),
					calculatedConsumption: 7,
					currency: '€'
				})
			])
		);
		mockGetAllExpenses.mockResolvedValue(
			ok([createMaintenanceEntry({ id: 3, date: new Date(2026, 2, 15), cost: 120, currency: '€' })])
		);
		renderDashboard();

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Monthly spend' })).toBeTruthy();
		});
		expect(screen.getByRole('heading', { name: 'Consumption trend' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Maintenance cost trend' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Fuel vs maintenance' })).toBeTruthy();
	});

	it('shows the no-data empty state when both reads are empty', async () => {
		mockGetAllFuelLogs.mockResolvedValue(ok([]));
		mockGetAllExpenses.mockResolvedValue(ok([]));
		renderDashboard();

		await waitFor(() => {
			expect(screen.getByRole('region', { name: 'No data yet' })).toBeTruthy();
		});
		expect(screen.getByText('Nothing to chart yet')).toBeTruthy();
	});

	it('shows the database error state when a read rejects', async () => {
		mockGetAllFuelLogs.mockRejectedValue(new Error('boom'));
		mockGetAllExpenses.mockResolvedValue(ok([]));
		renderDashboard();

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeTruthy();
		});
		expect(screen.getByText('Could not load your analytics')).toBeTruthy();
	});

	it('notes other-currency totals that cannot be merged into the home-currency charts', async () => {
		mockGetAllFuelLogs.mockResolvedValue(
			ok([
				createFuelEntry({ id: 1, date: new Date(2026, 2, 10), totalCost: 78, currency: '€' }),
				createFuelEntry({ id: 2, date: new Date(2026, 2, 12), totalCost: 20000, currency: 'Ft' })
			])
		);
		mockGetAllExpenses.mockResolvedValue(ok([]));
		renderDashboard();

		await waitFor(() => {
			expect(screen.getByText(/Other currencies aren't converted/i)).toBeTruthy();
		});
		expect(screen.getByText(/20000 Ft/)).toBeTruthy();
	});

	it('renders the plain-language insight line when a notable change warrants it', async () => {
		// Consumption 8 → 10 (+25%) between the previous and current calendar month (now pinned).
		const now = new Date(2026, 5, 15);
		mockGetAllFuelLogs.mockResolvedValue(
			ok([
				createFuelEntry({
					id: 1,
					date: new Date(2026, 4, 15),
					quantity: 40,
					totalCost: 60,
					calculatedConsumption: 8,
					currency: '€'
				}),
				createFuelEntry({
					id: 2,
					date: new Date(2026, 5, 15),
					quantity: 40,
					totalCost: 60,
					calculatedConsumption: 10,
					currency: '€'
				})
			])
		);
		mockGetAllExpenses.mockResolvedValue(ok([]));
		renderDashboard({ now });

		await waitFor(() => {
			expect(screen.getByText('Consumption is up about 25% this month.')).toBeTruthy();
		});
	});

	it('renders no insight line for a single-month cold-start', async () => {
		mockGetAllFuelLogs.mockResolvedValue(
			ok([createFuelEntry({ id: 1, date: new Date(2026, 5, 15), currency: '€' })])
		);
		mockGetAllExpenses.mockResolvedValue(ok([]));
		renderDashboard({ now: new Date(2026, 5, 20) });

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Monthly spend' })).toBeTruthy();
		});
		expect(screen.queryByText(/this month\.$/i)).toBeNull();
		expect(screen.queryByText(/running about average/i)).toBeNull();
	});
});
