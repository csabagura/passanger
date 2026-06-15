import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import type { Expense, FuelLog } from '$lib/db/schema';
import { ok, err } from '$lib/utils/result';
import AnalyticsPage from './+page.svelte';

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

let mockSettingsFuelUnit: 'L/100km' | 'MPG' = 'L/100km';
let mockSettingsCurrency = 'EUR ';
let mockActiveVehicle: {
	id: number;
	name: string;
	make: string;
	model: string;
	year?: number;
} | null = null;

vi.mock('svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('svelte')>();
	return {
		...actual,
		getContext: (key: string) => {
			if (key === 'settings') {
				return {
					settings: {
						fuelUnit: mockSettingsFuelUnit,
						currency: mockSettingsCurrency
					}
				};
			}

			if (key === 'vehicles') {
				return {
					get vehicles() {
						return mockActiveVehicle ? [mockActiveVehicle] : [];
					},
					get activeVehicle() {
						return mockActiveVehicle;
					},
					get activeVehicleId() {
						return mockActiveVehicle?.id ?? null;
					},
					get loaded() {
						return true;
					},
					switchVehicle: vi.fn(),
					refreshVehicles: vi.fn().mockResolvedValue(undefined)
				};
			}

			return undefined;
		}
	};
});

async function settlePage() {
	await waitFor(
		async () => {
			await new Promise<void>((r) => setTimeout(r, 0));
			await new Promise<void>((r) => setTimeout(r, 0));
			flushSync();
		},
		{ timeout: 2000 }
	);
}

function createFuelEntry(overrides: Partial<FuelLog> = {}): FuelLog {
	return {
		id: overrides.id ?? 9,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 2, 10, 12, 0, 0, 0),
		odometer: overrides.odometer ?? 87400,
		quantity: overrides.quantity ?? 42,
		unit: overrides.unit ?? 'L',
		distanceUnit: overrides.distanceUnit ?? 'km',
		totalCost: overrides.totalCost ?? 78,
		currency: overrides.currency,
		calculatedConsumption: overrides.calculatedConsumption ?? 7.2,
		notes: overrides.notes ?? ''
	};
}

function createMaintenanceEntry(overrides: Partial<Expense> = {}): Expense {
	return {
		id: overrides.id ?? 12,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 2, 10, 12, 0, 0, 0),
		type: overrides.type ?? 'Oil Change',
		odometer: overrides.odometer ?? 87400,
		cost: overrides.cost ?? 120,
		currency: overrides.currency,
		notes: overrides.notes ?? ''
	};
}

const testVehicle = { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang', year: 2016 };

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mockActiveVehicle = null;
	mockSettingsFuelUnit = 'L/100km';
	mockSettingsCurrency = 'EUR ';
});

describe('Analytics page', () => {
	it('keeps the document title', () => {
		mockActiveVehicle = null;
		render(AnalyticsPage);
		expect(document.title).toBe('Analytics | passanger');
	});

	it('shows the no-vehicle empty state when no vehicle is active', async () => {
		mockActiveVehicle = null;
		render(AnalyticsPage);
		await settlePage();

		expect(screen.getByText('No vehicle yet')).toBeTruthy();
		expect(screen.getByRole('region', { name: 'No vehicle selected' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Add a vehicle' })).toBeTruthy();
		expect(mockGetAllFuelLogs).not.toHaveBeenCalled();
	});

	it('shows the no-data empty state when the active vehicle has no entries', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue(ok([]));
		mockGetAllExpenses.mockResolvedValue(ok([]));

		render(AnalyticsPage);
		await settlePage();

		expect(screen.getByText('Nothing to chart yet')).toBeTruthy();
		expect(screen.getByRole('region', { name: 'No data yet' })).toBeTruthy();
		expect(mockGetAllFuelLogs).toHaveBeenCalledWith(7);
		expect(mockGetAllExpenses).toHaveBeenCalledWith(7);
	});

	it('shows the vehicle name in the header when a vehicle is active', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue(ok([]));
		mockGetAllExpenses.mockResolvedValue(ok([]));

		render(AnalyticsPage);
		await settlePage();

		expect(screen.getByText(/Old Faithful/)).toBeTruthy();
	});

	it('renders the three chart sections with accessible labels when data exists', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue(
			ok([
				createFuelEntry({
					id: 1,
					date: new Date(2026, 1, 10),
					totalCost: 60,
					calculatedConsumption: 8,
					currency: '€'
				}),
				createFuelEntry({
					id: 2,
					date: new Date(2026, 2, 12),
					totalCost: 78,
					calculatedConsumption: 7,
					currency: '€'
				})
			])
		);
		mockGetAllExpenses.mockResolvedValue(
			ok([createMaintenanceEntry({ id: 3, date: new Date(2026, 2, 15), cost: 120, currency: '€' })])
		);
		mockSettingsCurrency = '€';

		render(AnalyticsPage);
		await settlePage();

		expect(screen.getByRole('heading', { name: 'Monthly spend' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Consumption trend' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Fuel vs maintenance' })).toBeTruthy();

		const charts = screen.getAllByRole('img');
		expect(charts.length).toBeGreaterThanOrEqual(3);
		expect(
			charts.some((chart) => /Monthly spend/.test(chart.getAttribute('aria-label') ?? ''))
		).toBe(true);
		expect(
			charts.some((chart) => /consumption trend/i.test(chart.getAttribute('aria-label') ?? ''))
		).toBe(true);
		expect(
			charts.some((chart) => /Spending split/i.test(chart.getAttribute('aria-label') ?? ''))
		).toBe(true);
	});

	it('notes other-currency totals that cannot be merged into the home-currency charts', async () => {
		mockActiveVehicle = testVehicle;
		mockSettingsCurrency = '€';
		mockGetAllFuelLogs.mockResolvedValue(
			ok([
				createFuelEntry({ id: 1, date: new Date(2026, 2, 10), totalCost: 78, currency: '€' }),
				createFuelEntry({ id: 2, date: new Date(2026, 2, 12), totalCost: 20000, currency: 'Ft' })
			])
		);
		mockGetAllExpenses.mockResolvedValue(ok([]));

		render(AnalyticsPage);
		await settlePage();

		expect(screen.getByText(/Other currencies aren't converted/i)).toBeTruthy();
		expect(screen.getByText(/20000 Ft/)).toBeTruthy();
	});

	it('shows the database error state when a repository fails', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue(err('GET_FAILED', 'boom'));
		mockGetAllExpenses.mockResolvedValue(ok([]));

		render(AnalyticsPage);
		await settlePage();

		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByText('Could not load your analytics')).toBeTruthy();
	});
});
