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

function renderHero(settings: AppSettings, fuelLogs: FuelLog[], now?: Date) {
	return render(Harness, { props: { initialSettings: settings, fuelLogs, now } });
}

// Deterministic reference date (mirrors periodDelta.test.ts): 15 Jun 2026 → current month = June,
// previous month = May. Trend fixtures place logs in these two months relative to NOW.
const NOW = new Date(2026, 5, 15);
const JUN = new Date(2026, 5, 10);
const MAY = new Date(2026, 4, 10);

// The trend glyph lives in a leaf <span> (the colour class is on it, not the sized wrapper). Match the
// innermost element so we read the colour class, not the wrapper's layout classes.
function glyphEl(container: HTMLElement, glyph: string): HTMLElement | undefined {
	return Array.from(container.querySelectorAll('span')).find(
		(s) => s.textContent === glyph && s.children.length === 0
	);
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

	it('AC7: the accessible name has no double period in the insufficient-data state', () => {
		// nextAction is a full sentence ending in "."; the toggle hint must not append a second period.
		renderHero(baseSettings(), []);
		const label = screen.getByRole('button').getAttribute('aria-label');
		expect(label).not.toContain('..');
		expect(label).toBe(
			'Cost per km: Log your first fill-up to see cost per km. Tap to switch to Consumption.'
		);
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

	it('AC5/AC6: no glyph (calm-empty slot) when the active metric has no prior month', () => {
		// Only a current-month fill → the engine returns insufficient (missing-period) → no glyph and
		// no "—" placeholder that could read as data. The reserved slot stays calm and empty.
		const { container } = renderHero(baseSettings(), [makeLog({ date: JUN })], NOW);
		expect(container.textContent).not.toMatch(/[▲▼▬—]/);
	});

	it('AC5: shows the muted "add a couple more fill-ups" hint when a value exists but no trend yet', () => {
		// Value present (single current-month fill) but no baseline month → calm trend hint.
		renderHero(baseSettings(), [makeLog({ date: JUN })], NOW);
		expect(screen.getByText('add a couple more fill-ups to see a trend')).toBeTruthy();
	});

	it('AC5: no trend hint when there is no value at all (nextAction already covers it)', () => {
		renderHero(baseSettings(), [], NOW);
		expect(screen.queryByText('add a couple more fill-ups to see a trend')).toBeNull();
	});

	it('AC1/AC2: cost trend UP renders ▲ in brand blue when this month > last month', () => {
		// May cost/dist = 50/500 = €0.10/km; June = 60/500 = €0.12/km → +20% → ▲ up (text-primary).
		const { container } = renderHero(
			baseSettings(),
			[makeLog({ id: 1, date: MAY, totalCost: 50 }), makeLog({ id: 2, date: JUN, totalCost: 60 })],
			NOW
		);
		const up = glyphEl(container, '▲');
		expect(up).toBeTruthy();
		expect(up?.className).toContain('text-primary');
		expect(container.textContent).not.toContain('▼');
		expect(container.textContent).not.toContain('▬');
	});

	it('AC1/AC2: cost trend DOWN renders ▼ in muted colour when this month < last month', () => {
		// May = €0.12/km; June = €0.10/km → −16.7% → ▼ down (muted, NOT red).
		const { container } = renderHero(
			baseSettings(),
			[makeLog({ id: 1, date: MAY, totalCost: 60 }), makeLog({ id: 2, date: JUN, totalCost: 50 })],
			NOW
		);
		const down = glyphEl(container, '▼');
		expect(down).toBeTruthy();
		expect(down?.className).toContain('text-muted-foreground');
		// AC2 fence: never a success/destructive (green-red) class on the trend glyph.
		expect(down?.className).not.toContain('text-destructive');
		expect(down?.className).not.toContain('text-success');
	});

	it('AC3: a sub-1% move renders ▬ flat (the config flat band, not the engine exact-zero)', () => {
		// May = 200/500 = €0.40/km; June = 201/500 = €0.402/km → +0.5% < TREND_FLAT_BAND_PCT (1) → ▬.
		const { container } = renderHero(
			baseSettings(),
			[
				makeLog({ id: 1, date: MAY, totalCost: 200 }),
				makeLog({ id: 2, date: JUN, totalCost: 201 })
			],
			NOW
		);
		const flat = glyphEl(container, '▬');
		expect(flat).toBeTruthy();
		expect(flat?.className).toContain('text-muted-foreground');
		expect(container.textContent).not.toContain('▲');
	});

	it('AC4/AC3: toggling swaps the chip — cost trend ≠ consumption trend in the same fixture', async () => {
		// May: 40 L over 500 km, €60 → cost €0.12/km, consumption 8.0 L/100km.
		// Jun: 50 L over 500 km, €50 → cost €0.10/km, consumption 10.0 L/100km.
		// → cost trends DOWN (▼) while consumption trends UP (▲): proves the chip follows the metric.
		const fixture = [
			makeLog({ id: 1, date: MAY, quantity: 40, calculatedConsumption: 8, totalCost: 60 }),
			makeLog({ id: 2, date: JUN, quantity: 50, calculatedConsumption: 10, totalCost: 50 })
		];
		const { container } = renderHero(baseSettings(), fixture, NOW);
		// Cost view: ▼ down.
		expect(glyphEl(container, '▼')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button'));
		await waitFor(() => {
			expect(screen.getByText('Consumption')).toBeTruthy();
		});
		// Consumption view: ▲ up (text-primary), the cost ▼ is gone.
		const up = glyphEl(container, '▲');
		expect(up).toBeTruthy();
		expect(up?.className).toContain('text-primary');
		expect(container.textContent).not.toContain('▼');
	});

	it('AC6: the accessible name carries the trend direction in the ok state', () => {
		// All-time cost = (50+60)/1000 = €0.11/km; trend up → ", up from last month".
		const { container } = renderHero(
			baseSettings(),
			[makeLog({ id: 1, date: MAY, totalCost: 50 }), makeLog({ id: 2, date: JUN, totalCost: 60 })],
			NOW
		);
		const label = screen.getByRole('button').getAttribute('aria-label');
		expect(label).toBe(
			'Cost per km: €0.11 / km, up from last month. Tap to switch to Consumption.'
		);
		// The glyph itself stays decorative (aria-hidden), not part of any accessible name.
		const up = glyphEl(container, '▲');
		expect(up?.closest('[aria-hidden="true"]')).toBeTruthy();
	});

	it('AC6: no double period in the accessible name across ok / insufficient / no-value states', () => {
		// ok (trend clause present, value has no trailing period):
		const ok = renderHero(
			baseSettings(),
			[makeLog({ id: 1, date: MAY, totalCost: 50 }), makeLog({ id: 2, date: JUN, totalCost: 60 })],
			NOW
		);
		expect(ok.getByRole('button').getAttribute('aria-label')).not.toContain('..');
		cleanup();
		// insufficient (value present, no trend clause):
		const insufficient = renderHero(baseSettings(), [makeLog({ date: JUN })], NOW);
		expect(insufficient.getByRole('button').getAttribute('aria-label')).not.toContain('..');
		cleanup();
		// no value (nextAction ends in a sentence — the original double-period regression):
		const empty = renderHero(baseSettings(), [], NOW);
		expect(empty.getByRole('button').getAttribute('aria-label')).not.toContain('..');
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
