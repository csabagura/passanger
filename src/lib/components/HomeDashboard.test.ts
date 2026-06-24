import 'fake-indexeddb/auto'; // MUST be first — patches global IndexedDB before db.ts opens
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { db } from '$lib/db/db';
import { saveFuelLog } from '$lib/db/repositories/fuelLogs';
import { saveExpense } from '$lib/db/repositories/expenses';
import type { NewFuelLog } from '$lib/db/schema';
import HomeDashboard from './HomeDashboard.svelte';

const VEHICLE_ID = 1;

// A fuel log with calculatedConsumption > 0 yields a derivable distance, so even one such log makes
// costPerDistance report a value (getFuelEntryDistance). Pass consumption 0 for the "first fill /
// can't compute" case.
function makeLog(overrides: Partial<NewFuelLog> = {}): NewFuelLog {
	return {
		vehicleId: VEHICLE_ID,
		date: new Date(),
		odometer: 50000,
		quantity: 40,
		unit: 'L',
		distanceUnit: 'km',
		totalCost: 60,
		calculatedConsumption: 8,
		...overrides
	};
}

function settingsContext() {
	return {
		get settings() {
			return { fuelUnit: 'L/100km' as const, currency: '€', theme: 'system' as const };
		},
		updateSettings: vi.fn()
	};
}

function renderDashboard() {
	const context = new Map<string, unknown>();
	context.set('settings', settingsContext());
	return render(HomeDashboard, {
		props: { vehicleId: VEHICLE_ID, vehicleName: 'Daily Driver' },
		context
	});
}

beforeEach(async () => {
	await db.delete();
	await db.open();
});

afterEach(() => {
	cleanup();
});

describe('HomeDashboard', () => {
	it('AC4: shows the content-shaped skeleton before the liveQuery seed resolves', () => {
		renderDashboard();
		// Synchronously after render, liveQuery has not emitted yet (current === undefined) → skeleton.
		expect(screen.getByText(/loading your dashboard/i)).toBeTruthy();
	});

	it('AC6: renders the base cost stat once data loads (one fill with derivable distance)', async () => {
		await saveFuelLog(makeLog({ totalCost: 60, quantity: 40, calculatedConsumption: 8 }));
		renderDashboard();

		// 60 cost / ((40 / 8) * 100 = 500 km) = €0.12 per km.
		await waitFor(() => {
			expect(screen.getByText(/per km/i)).toBeTruthy();
		});
		expect(screen.getByText('€0.12')).toBeTruthy();
		expect(screen.getByText('/ km')).toBeTruthy();
	});

	it('AC6: shows an explicit next-action state (never a dead element) when there is no fuel data', async () => {
		renderDashboard();
		await waitFor(() => {
			expect(screen.getByText(/log your first fill-up to see cost per km/i)).toBeTruthy();
		});
	});

	it('AC6: shows a "log another" next-action when fills exist but none yield a distance', async () => {
		// First fill: consumption 0 → no derivable distance → costPerDistance has no entry.
		await saveFuelLog(makeLog({ calculatedConsumption: 0 }));
		renderDashboard();
		await waitFor(() => {
			expect(screen.getByText(/log another fill-up to calculate cost per km/i)).toBeTruthy();
		});
	});

	it('AC6: renders last-fill recency for a today-dated fill', async () => {
		await saveFuelLog(makeLog({ date: new Date() }));
		renderDashboard();
		// Locale-independent: the component uses the runtime locale (like the app's toLocaleString
		// usages), so derive the expected "today" relative-time string from the same Intl API.
		const todayWord = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(0, 'day');
		await waitFor(() => {
			expect(screen.getByText(new RegExp(`last fill-up: ${todayWord}`, 'i'))).toBeTruthy();
		});
	});

	it('AC6: renders last-fill recency for a yesterday-dated fill (locks the day-delta sign)', async () => {
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		await saveFuelLog(makeLog({ date: yesterday }));
		renderDashboard();
		// diffDays must be -1 → "yesterday", not +1/"tomorrow". Derive the expected word from the same
		// Intl API so the assertion stays locale-independent.
		const yesterdayWord = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
			-1,
			'day'
		);
		await waitFor(() => {
			expect(screen.getByText(new RegExp(`last fill-up: ${yesterdayWord}`, 'i'))).toBeTruthy();
		});
	});

	it('AC4: a new fuel Capture appears without a reload (liveQuery re-emits)', async () => {
		await saveFuelLog(makeLog({ odometer: 50000 }));
		renderDashboard();

		await waitFor(() => {
			expect(screen.getByText(/tracking 1 fill-up for daily driver/i)).toBeTruthy();
		});

		// Write while mounted — no remount, no manual re-read.
		await saveFuelLog(makeLog({ odometer: 50500 }));
		await waitFor(() => {
			expect(screen.getByText(/tracking 2 fill-ups for daily driver/i)).toBeTruthy();
		});
	});

	it('Story 4.3: renders the plain-language Insight line above the Hero Metric when data warrants it', async () => {
		// Anchor two fills to the current vs the previous CALENDAR month relative to the real clock
		// (HomeDashboard passes no `now`, so the engine reads it). Day 15 exists in every month, and the
		// month-key filter ignores the day, so this is deterministic regardless of today's date.
		const now = new Date();
		const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
		const currentMonth = new Date(now.getFullYear(), now.getMonth(), 15);
		// Volume + cost held constant → spend and fuel-price stay flat; only consumption moves 8 → 10
		// (+25%), so the single most-significant insight is deterministic.
		await saveFuelLog(
			makeLog({ date: previousMonth, quantity: 40, totalCost: 60, calculatedConsumption: 8 })
		);
		await saveFuelLog(
			makeLog({ date: currentMonth, quantity: 40, totalCost: 60, calculatedConsumption: 10 })
		);
		renderDashboard();

		await waitFor(() => {
			expect(screen.getByText('Consumption is up about 25% this month.')).toBeTruthy();
		});
	});

	it('Story 4.3: renders no Insight line for a single-month cold-start (no HeroMetric duplication)', async () => {
		await saveFuelLog(makeLog({ date: new Date() }));
		renderDashboard();
		await waitFor(() => {
			expect(screen.getByText(/tracking 1 fill-up for daily driver/i)).toBeTruthy();
		});
		// Cold start → getInsights returns [] → no insight paragraph; HeroMetric owns the cold-start copy.
		expect(screen.queryByText(/this month\.$/i)).toBeNull();
		expect(screen.queryByText(/running about average/i)).toBeNull();
	});

	it('AC4: an expense Capture is reflected live in the summary line', async () => {
		await saveFuelLog(makeLog());
		renderDashboard();
		await waitFor(() => {
			expect(screen.getByText(/tracking 1 fill-up for daily driver/i)).toBeTruthy();
		});

		await saveExpense({
			vehicleId: VEHICLE_ID,
			date: new Date(),
			type: 'Service',
			cost: 120,
			currency: '€',
			notes: ''
		});
		await waitFor(() => {
			expect(screen.getByText(/tracking 1 fill-up · 1 expense for daily driver/i)).toBeTruthy();
		});
	});
});
