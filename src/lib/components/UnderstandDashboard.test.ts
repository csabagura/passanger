import 'fake-indexeddb/auto'; // MUST be first — patches global IndexedDB so liveQuery has a backing db
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Expense, FuelLog } from '$lib/db/schema';
import { ok, err } from '$lib/utils/result';
import { m } from '$lib/paraglide/messages';
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

function renderDashboard(
	props: Record<string, unknown> = {},
	settingsOverrides: Record<string, unknown> = {}
) {
	const context = new Map<string, unknown>();
	context.set('settings', {
		get settings() {
			return {
				fuelUnit: 'L/100km' as const,
				currency: '€',
				theme: 'system' as const,
				...settingsOverrides
			};
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
		expect(screen.getByText(m.understand_loading())).toBeTruthy();
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
			expect(screen.getByRole('heading', { name: m.chart_monthly_spend_title() })).toBeTruthy();
		});
		expect(screen.getByRole('heading', { name: m.chart_consumption_title() })).toBeTruthy();
		expect(screen.getByRole('heading', { name: m.chart_maintenance_title() })).toBeTruthy();
		expect(screen.getByRole('heading', { name: m.understand_split_title() })).toBeTruthy();
	});

	it('shows the no-data empty state when both reads are empty', async () => {
		mockGetAllFuelLogs.mockResolvedValue(ok([]));
		mockGetAllExpenses.mockResolvedValue(ok([]));
		renderDashboard();

		await waitFor(() => {
			expect(screen.getByRole('region', { name: m.understand_no_data_region() })).toBeTruthy();
		});
		expect(screen.getByText(m.understand_no_data_title())).toBeTruthy();
	});

	it('shows the database error state when a read rejects', async () => {
		mockGetAllFuelLogs.mockRejectedValue(new Error('boom'));
		mockGetAllExpenses.mockResolvedValue(ok([]));
		renderDashboard();

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeTruthy();
		});
		expect(screen.getByText(m.understand_db_error_title())).toBeTruthy();
	});

	it('H2: shows the database error state when a repository resolves to err(...) (the real-world gap — no raw throw)', async () => {
		mockGetAllFuelLogs.mockResolvedValue(err('DB_READ_FAILED', 'boom'));
		mockGetAllExpenses.mockResolvedValue(ok([]));
		renderDashboard();

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeTruthy();
		});
		expect(screen.getByText(m.understand_db_error_title())).toBeTruthy();
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

	it('shows the blended Display-Rate total and drops the not-converted note when every foreign currency is rated', async () => {
		mockGetAllFuelLogs.mockResolvedValue(
			ok([
				createFuelEntry({ id: 1, date: new Date(2026, 2, 10), totalCost: 78, currency: '€' }),
				createFuelEntry({ id: 2, date: new Date(2026, 2, 12), totalCost: 20000, currency: 'Ft' })
			])
		);
		mockGetAllExpenses.mockResolvedValue(ok([]));
		// 1 Ft ≈ €0.0025 → forward rounds to €0.00, so the label flips to the legible inverse "1 € = 400 Ft".
		renderDashboard({}, { exchangeRates: { Ft: 0.0025 } });

		await waitFor(() => {
			// €78 + 20000 Ft × 0.0025 = €128.00.
			expect(
				screen.getByText(
					m.understand_blend_total({ amount: '€128.00', label: 'using your rate (1 € = 400 Ft)' })
				)
			).toBeTruthy();
		});
		// Every foreign currency is now rated → no leftover "not converted" note.
		expect(screen.queryByText(/Other currencies aren't converted/i)).toBeNull();
	});

	it('shows the blended total and keeps an honest note for foreign currencies that still lack a rate', async () => {
		mockGetAllFuelLogs.mockResolvedValue(
			ok([
				createFuelEntry({ id: 1, date: new Date(2026, 2, 10), totalCost: 78, currency: '€' }),
				createFuelEntry({ id: 2, date: new Date(2026, 2, 12), totalCost: 20000, currency: 'Ft' }),
				createFuelEntry({ id: 3, date: new Date(2026, 2, 14), totalCost: 50, currency: '$' })
			])
		);
		mockGetAllExpenses.mockResolvedValue(ok([]));
		renderDashboard({}, { exchangeRates: { Ft: 0.0025 } });

		await waitFor(() => {
			expect(
				screen.getByText(
					m.understand_blend_total({ amount: '€128.00', label: 'using your rate (1 € = 400 Ft)' })
				)
			).toBeTruthy();
		});
		// $ has no rate → still listed in the honest note; Ft is converted so it is no longer listed.
		expect(screen.getByText(/Other currencies aren't converted/i)).toBeTruthy();
		expect(screen.getByText(/\$50\.00/)).toBeTruthy();
		expect(screen.queryByText(/20000 Ft/)).toBeNull();
	});

	it('renders no blended total when no Display Rate is set (no rate → no number)', async () => {
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
		expect(screen.queryByText(/using your rate/i)).toBeNull();
		expect(screen.queryByText(/^≈/)).toBeNull();
	});

	it('renders the plain-language insight line when a notable change warrants it', async () => {
		// Consumption 8 → 10 (+25%) between the previous and current calendar month (now pinned).
		// 2 fill-ups per month (H19b sample-size gate) — split in half preserves the ratio.
		const now = new Date(2026, 5, 15);
		mockGetAllFuelLogs.mockResolvedValue(
			ok([
				createFuelEntry({
					id: 1,
					date: new Date(2026, 4, 15),
					quantity: 20,
					totalCost: 30,
					calculatedConsumption: 8,
					currency: '€'
				}),
				createFuelEntry({
					id: 2,
					date: new Date(2026, 4, 15),
					quantity: 20,
					totalCost: 30,
					calculatedConsumption: 8,
					currency: '€'
				}),
				createFuelEntry({
					id: 3,
					date: new Date(2026, 5, 15),
					quantity: 20,
					totalCost: 30,
					calculatedConsumption: 10,
					currency: '€'
				}),
				createFuelEntry({
					id: 4,
					date: new Date(2026, 5, 15),
					quantity: 20,
					totalCost: 30,
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

	it('S27: a zero-spend interior month is not silently dropped from the monthly-spend chart', async () => {
		// Entries in January and March only — February is data-free. The old `.filter((point) =>
		// point.value > 0)` combined with the engine only bucketing months with actual entries meant
		// February never appeared at all. Now the engine zero-fills it and the UI no longer filters it
		// out — the table view (the mandated screen-reader-navigable representation, FR-17) must show
		// a "0" row for February between January and March.
		mockGetAllFuelLogs.mockResolvedValue(
			ok([
				createFuelEntry({ id: 1, date: new Date(2026, 0, 10), totalCost: 50, currency: '€' }),
				createFuelEntry({ id: 2, date: new Date(2026, 2, 10), totalCost: 30, currency: '€' })
			])
		);
		mockGetAllExpenses.mockResolvedValue(ok([]));
		renderDashboard();

		const heading = await screen.findByRole('heading', { name: m.chart_monthly_spend_title() });
		const section = heading.closest('section');
		expect(section).toBeTruthy();
		if (!section) return;

		const toggle = within(section).getByRole('button', { name: m.chart_view_as_table() });
		await fireEvent.click(toggle);

		const rows = within(section).getAllByRole('row');
		// Row 0 is the header; data rows follow in chronological order: Jan, Feb (zero), Mar.
		expect(rows).toHaveLength(4);
		expect(within(rows[2]).getByText('€0.00')).toBeTruthy();
	});

	it('renders no insight line for a single-month cold-start', async () => {
		mockGetAllFuelLogs.mockResolvedValue(
			ok([createFuelEntry({ id: 1, date: new Date(2026, 5, 15), currency: '€' })])
		);
		mockGetAllExpenses.mockResolvedValue(ok([]));
		renderDashboard({ now: new Date(2026, 5, 20) });

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: m.chart_monthly_spend_title() })).toBeTruthy();
		});
		expect(screen.queryByText(/this month\.$/i)).toBeNull();
		expect(screen.queryByText(/running about average/i)).toBeNull();
	});
});
