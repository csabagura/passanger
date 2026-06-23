import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { SETTINGS_STORAGE_KEY } from '$lib/config';
import { getSettings, type AppSettings } from '$lib/utils/settings';
import type { FuelLog } from '$lib/db/schema';
import Harness from './HeroMetricHarness.test.svelte';

// A fuel log with calculatedConsumption > 0 has a derivable distance, so a single such log yields
// both a cost-per-distance value and an aggregate consumption value.
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

function renderHero(settings: AppSettings, fuelLogs: FuelLog[]) {
	return render(Harness, { props: { initialSettings: settings, fuelLogs } });
}

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	cleanup();
});

describe('HeroMetric', () => {
	it('AC1: defaults to the Cost-per-Distance stat (verbatim Story-3.3 strings)', () => {
		// 60 cost / ((40 / 8) * 100 = 500 km) = €0.12 / km.
		renderHero(baseSettings(), [makeLog()]);
		expect(screen.getByText('Cost per km')).toBeTruthy();
		expect(screen.getByText('€0.12')).toBeTruthy();
		expect(screen.getByText('/ km')).toBeTruthy();
	});

	it('AC2: tapping toggles to Consumption — label, value and unit switch together', async () => {
		renderHero(baseSettings(), [makeLog()]);
		await fireEvent.click(screen.getByRole('button'));

		// The single 40 L / 500 km fill aggregates to 8.0 L/100km (its own consumption).
		await waitFor(() => {
			expect(screen.getByText('Consumption')).toBeTruthy();
		});
		expect(screen.getByText('8.0 L/100km')).toBeTruthy();
		// The cost label/value is gone — only one hero metric shows at a time.
		expect(screen.queryByText('Cost per km')).toBeNull();
		expect(screen.queryByText('€0.12')).toBeNull();
	});

	it('AC3: the choice is persisted to localStorage on toggle (survives a reload)', async () => {
		renderHero(baseSettings(), [makeLog()]);
		await fireEvent.click(screen.getByRole('button'));

		await waitFor(() => {
			expect(getSettings().heroMetric).toBe('consumption');
		});
		expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toContain('consumption');
	});

	it('AC3: a remembered consumption choice renders consumption on mount', () => {
		renderHero(baseSettings({ heroMetric: 'consumption' }), [makeLog()]);
		expect(screen.getByText('Consumption')).toBeTruthy();
		expect(screen.getByText('8.0 L/100km')).toBeTruthy();
		expect(screen.queryByText('Cost per km')).toBeNull();
	});

	it('AC2: toggling back from consumption restores cost', async () => {
		renderHero(baseSettings({ heroMetric: 'consumption' }), [makeLog()]);
		await fireEvent.click(screen.getByRole('button'));
		await waitFor(() => {
			expect(screen.getByText('Cost per km')).toBeTruthy();
		});
		expect(getSettings().heroMetric).toBe('cost');
	});

	it('AC5: cost insufficient-data next-action with no fills (never a dead element)', () => {
		renderHero(baseSettings(), []);
		expect(screen.getByText('Log your first fill-up to see cost per km.')).toBeTruthy();
		// No NaN/0/blank big number is rendered.
		expect(screen.queryByText('€NaN')).toBeNull();
	});

	it('AC5: consumption insufficient-data next-action when consumption is remembered but empty', () => {
		renderHero(baseSettings({ heroMetric: 'consumption' }), []);
		expect(screen.getByText('Log your first fill-up to see consumption.')).toBeTruthy();
	});

	it('AC5: a "log another" next-action when a fill exists but no distance is derivable', () => {
		renderHero(baseSettings(), [makeLog({ calculatedConsumption: 0 })]);
		expect(screen.getByText('Log another fill-up to calculate cost per km.')).toBeTruthy();
	});

	it('AC5: the toggle stays operable even when a metric has insufficient data', async () => {
		// No fills: cost is empty; toggling to consumption shows consumption's own next-action.
		renderHero(baseSettings(), []);
		await fireEvent.click(screen.getByRole('button'));
		await waitFor(() => {
			expect(screen.getByText('Log your first fill-up to see consumption.')).toBeTruthy();
		});
	});

	it('AC7: the control is a real ≥44px button with an accessible name announcing metric + value + switch', () => {
		renderHero(baseSettings(), [makeLog()]);
		const button = screen.getByRole('button', {
			name: /Cost per km: €0\.12 \/ km\. Tap to switch to Consumption\./i
		});
		expect(button).toBeTruthy();
		expect(button.className).toContain('min-h-[44px]');
		expect(button.className).toContain('focus-visible:ring-2');
	});

	it('AC7: the metric change is announced via a polite live region (empty on load)', async () => {
		renderHero(baseSettings(), [makeLog()]);
		const status = screen.getByRole('status');
		// Empty on initial render — no announcement of the default, no getByText collision.
		expect(status.textContent?.trim()).toBe('');

		await fireEvent.click(screen.getByRole('button'));
		await waitFor(() => {
			expect(status.textContent).toContain('Consumption');
			expect(status.textContent).toContain('8.0 L/100km');
		});
	});

	it('AC6: reserves the trend-chip area but renders no trend arrow / placeholder', () => {
		const { container } = renderHero(baseSettings(), [makeLog()]);
		// No directional glyphs and no "—" placeholder that could read as data.
		expect(container.textContent).not.toMatch(/[▲▼▬—]/);
	});

	it('AC2: MPG settings render consumption in MPG units after toggle', async () => {
		// 10 gal at 25 MPG => 250 mi => 25.0 MPG aggregate.
		renderHero(baseSettings({ fuelUnit: 'MPG', currency: '$' }), [
			makeLog({
				unit: 'gal',
				distanceUnit: 'mi',
				quantity: 10,
				calculatedConsumption: 25,
				totalCost: 50
			})
		]);
		await fireEvent.click(screen.getByRole('button'));
		await waitFor(() => {
			expect(screen.getByText('25.0 MPG')).toBeTruthy();
		});
	});
});
