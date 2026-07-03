import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { AppSettings } from '$lib/utils/settings';
import type { Expense, FuelLog } from '$lib/db/schema';
import Harness from './InsightLineHarness.test.svelte';

function makeLog(overrides: Partial<FuelLog> = {}): FuelLog {
	return {
		id: 1,
		vehicleId: 1,
		date: new Date(),
		odometer: 50000,
		quantity: 40,
		unit: 'L',
		distanceUnit: 'km',
		totalCost: 60,
		currency: undefined,
		calculatedConsumption: 8,
		notes: '',
		...overrides
	};
}

function baseSettings(overrides: Partial<AppSettings> = {}): AppSettings {
	return { fuelUnit: 'L/100km', currency: '€', theme: 'system', ...overrides };
}

function renderInsight(fuelLogs: FuelLog[], expenses: Expense[] = [], now?: Date) {
	return render(Harness, {
		props: { initialSettings: baseSettings(), fuelLogs, expenses, now }
	});
}

// 15 Jun 2026 → current month June, previous May (mirrors the engine tests).
const NOW = new Date(2026, 5, 15);
const JUNE = new Date(2026, 5, 10);
const MAY = new Date(2026, 4, 10);

afterEach(() => {
	cleanup();
});

describe('InsightLine', () => {
	it('renders the most-significant insight text verbatim for a notable dataset', () => {
		// May consumption 8 → June 9 = +12.5% (rounds to 13); spend + price flat. 2 fill-ups per
		// month (H19b sample-size gate) — split in half preserves the ratio.
		const fuelLogs = [
			makeLog({ id: 1, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			makeLog({ id: 2, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			makeLog({ id: 3, date: JUNE, quantity: 20, calculatedConsumption: 9, totalCost: 30 }),
			makeLog({ id: 4, date: JUNE, quantity: 20, calculatedConsumption: 9, totalCost: 30 })
		];
		renderInsight(fuelLogs, [], NOW);
		expect(screen.getByText('Consumption is up about 13% this month.')).toBeTruthy();
	});

	it('renders the calm baseline when data is sufficient but nothing is notable', () => {
		const fuelLogs = [
			makeLog({ id: 1, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			makeLog({ id: 2, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			makeLog({ id: 3, date: JUNE, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			makeLog({ id: 4, date: JUNE, quantity: 20, calculatedConsumption: 8, totalCost: 30 })
		];
		renderInsight(fuelLogs, [], NOW);
		expect(screen.getByText('Running about average this month.')).toBeTruthy();
	});

	it('renders NOTHING for a cold-start / insufficient dataset (no HeroMetric duplication)', () => {
		const { container } = renderInsight([makeLog({ id: 1, date: JUNE })], [], NOW);
		expect(container.querySelector('p')).toBeNull();
		// And it must not echo HeroMetric's cold-start hint.
		expect(screen.queryByText(/add a couple more fill-ups/i)).toBeNull();
	});

	it('renders nothing for an empty dataset', () => {
		const { container } = renderInsight([], [], NOW);
		expect(container.querySelector('p')).toBeNull();
	});
});
