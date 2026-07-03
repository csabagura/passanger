import { describe, expect, it } from 'vitest';
import type { Expense, FuelLog } from '$lib/db/schema';
import { fuelPriceChange, getInsights, selectTopInsights } from './insight';

function createFuelEntry(overrides: Partial<FuelLog> = {}): FuelLog {
	return {
		id: overrides.id ?? 9,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 5, 10, 12, 0, 0, 0),
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
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 5, 10, 12, 0, 0, 0),
		type: overrides.type ?? 'Oil Change',
		odometer: overrides.odometer ?? 87400,
		cost: overrides.cost ?? 50,
		currency: overrides.currency,
		notes: overrides.notes ?? ''
	};
}

// Reference "now" — 15 June 2026. Current calendar month = June; previous = May. The fuel-price
// baseline window is the 90 days BEFORE June (≈ early March → 31 May), so April/May logs anchor it.
const NOW = new Date(2026, 5, 15, 9, 0, 0, 0);
const JUNE = new Date(2026, 5, 10);
const MAY = new Date(2026, 4, 10);
const APRIL = new Date(2026, 3, 10);

const OPTS = { homeCurrency: '€', fuelUnit: 'L/100km' as const, now: NOW };

// Causal words the copy must never contain (UJ-4 "report the what, never invent a cause").
const CAUSAL_WORDS = /because|due to|caused by|thanks to|owing to|as a result/i;

// H19b: every scenario below needs ≥2 fuel-log observations per calendar month. Splitting a
// single month's fill into two HALF-size logs with the SAME `calculatedConsumption` (rather than
// duplicating a full one) preserves every aggregate exactly — the volume-weighted average
// (`averageConsumption`), the price-per-litre ratio, AND the additive spend sum all come out
// identical to the pre-split single-log fixture, so none of the arithmetic below needed to change.
describe('getInsights — consumption detection', () => {
	it('fires a notable consumption-up insight (>= 10%) with calm numeric copy', () => {
		// May avg consumption 8, June 9 → +12.5% (rounds to 13). Spend + price held flat so only
		// consumption is notable.
		const fuelLogs = [
			createFuelEntry({ id: 1, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({ id: 2, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({ id: 3, date: JUNE, quantity: 20, calculatedConsumption: 9, totalCost: 30 }),
			createFuelEntry({ id: 4, date: JUNE, quantity: 20, calculatedConsumption: 9, totalCost: 30 })
		];
		const insights = getInsights(fuelLogs, [], OPTS);
		expect(insights).toEqual([
			{
				id: 'consumption-up',
				metric: 'consumption',
				severity: 'notable',
				direction: 'up',
				percentChange: 12.5,
				text: 'Consumption is up about 13% this month.'
			}
		]);
		expect(insights[0].text).not.toMatch(CAUSAL_WORDS);
	});

	it('fires consumption-down when this month is thriftier', () => {
		const fuelLogs = [
			createFuelEntry({ id: 1, date: MAY, quantity: 20, calculatedConsumption: 10, totalCost: 30 }),
			createFuelEntry({ id: 2, date: MAY, quantity: 20, calculatedConsumption: 10, totalCost: 30 }),
			createFuelEntry({ id: 3, date: JUNE, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({ id: 4, date: JUNE, quantity: 20, calculatedConsumption: 8, totalCost: 30 })
		];
		const insights = getInsights(fuelLogs, [], OPTS);
		expect(insights[0].metric).toBe('consumption');
		expect(insights[0].direction).toBe('down');
		expect(insights[0].text).toBe('Consumption is down about 20% this month.');
	});

	it('does NOT fire when the consumption change is just below the 10% threshold', () => {
		// May 8 → June 8.7 = +8.75%, below 10%. Price + spend flat → a calm baseline, not a notable.
		const fuelLogs = [
			createFuelEntry({ id: 1, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({ id: 2, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({
				id: 3,
				date: JUNE,
				quantity: 20,
				calculatedConsumption: 8.7,
				totalCost: 30
			}),
			createFuelEntry({
				id: 4,
				date: JUNE,
				quantity: 20,
				calculatedConsumption: 8.7,
				totalCost: 30
			})
		];
		const insights = getInsights(fuelLogs, [], OPTS);
		expect(insights).toEqual([
			{
				id: 'baseline',
				metric: 'baseline',
				severity: 'info',
				text: 'Running about average this month.'
			}
		]);
	});

	it('fires at exactly the 10% threshold (boundary is inclusive)', () => {
		const fuelLogs = [
			createFuelEntry({ id: 1, date: MAY, quantity: 20, calculatedConsumption: 10, totalCost: 30 }),
			createFuelEntry({ id: 2, date: MAY, quantity: 20, calculatedConsumption: 10, totalCost: 30 }),
			createFuelEntry({
				id: 3,
				date: JUNE,
				quantity: 20,
				calculatedConsumption: 11,
				totalCost: 30
			}),
			createFuelEntry({ id: 4, date: JUNE, quantity: 20, calculatedConsumption: 11, totalCost: 30 })
		];
		const insights = getInsights(fuelLogs, [], OPTS);
		expect(insights[0].metric).toBe('consumption');
		expect(insights[0].percentChange).toBeCloseTo(10);
	});

	it('is insufficient (no insight fires) when a side has only a single fill-up (H19b)', () => {
		const fuelLogs = [
			createFuelEntry({ id: 1, date: MAY, quantity: 40, calculatedConsumption: 8, totalCost: 60 }), // only 1 in May
			createFuelEntry({ id: 2, date: JUNE, quantity: 20, calculatedConsumption: 9, totalCost: 30 }),
			createFuelEntry({ id: 3, date: JUNE, quantity: 20, calculatedConsumption: 9, totalCost: 30 })
		];
		const insights = getInsights(fuelLogs, [], OPTS);
		expect(insights.some((insight) => insight.metric === 'consumption')).toBe(false);
	});
});

describe('getInsights — consumption detection, MPG-unit copy honesty (H13)', () => {
	const MPG_OPTS = { homeCurrency: '€', fuelUnit: 'MPG' as const, now: NOW };

	it('renders the "improved" (down-equivalent) message when an MPG numeric value increases (better efficiency)', () => {
		// May avg 25 MPG, June avg 30 MPG — a numeric INCREASE, which for MPG means efficiency improved.
		// The old bug always said "Consumption is up" here (unit-blind); the copy must say "down".
		const fuelLogs = [
			createFuelEntry({
				id: 1,
				date: MAY,
				quantity: 20,
				calculatedConsumption: 25,
				totalCost: 30,
				unit: 'gal',
				distanceUnit: 'mi'
			}),
			createFuelEntry({
				id: 2,
				date: MAY,
				quantity: 20,
				calculatedConsumption: 25,
				totalCost: 30,
				unit: 'gal',
				distanceUnit: 'mi'
			}),
			createFuelEntry({
				id: 3,
				date: JUNE,
				quantity: 20,
				calculatedConsumption: 30,
				totalCost: 30,
				unit: 'gal',
				distanceUnit: 'mi'
			}),
			createFuelEntry({
				id: 4,
				date: JUNE,
				quantity: 20,
				calculatedConsumption: 30,
				totalCost: 30,
				unit: 'gal',
				distanceUnit: 'mi'
			})
		];
		const insights = getInsights(fuelLogs, [], MPG_OPTS);
		const consumption = insights.find((i) => i.metric === 'consumption');
		expect(consumption).toBeDefined();
		// The raw numeric direction stays 'up' (unit-agnostic engine, untouched) ...
		expect(consumption?.direction).toBe('up');
		// ... but the rendered copy communicates the real-world improvement, never "up".
		expect(consumption?.text).toBe('Consumption is down about 20% this month.');
		expect(consumption?.text).not.toContain('is up');
	});

	it('renders the "up" (worse-efficiency) message when an MPG numeric value decreases', () => {
		// May 30 MPG, June 25 MPG — a numeric DECREASE, which for MPG means efficiency got worse.
		const fuelLogs = [
			createFuelEntry({
				id: 1,
				date: MAY,
				quantity: 20,
				calculatedConsumption: 30,
				totalCost: 30,
				unit: 'gal',
				distanceUnit: 'mi'
			}),
			createFuelEntry({
				id: 2,
				date: MAY,
				quantity: 20,
				calculatedConsumption: 30,
				totalCost: 30,
				unit: 'gal',
				distanceUnit: 'mi'
			}),
			createFuelEntry({
				id: 3,
				date: JUNE,
				quantity: 20,
				calculatedConsumption: 25,
				totalCost: 30,
				unit: 'gal',
				distanceUnit: 'mi'
			}),
			createFuelEntry({
				id: 4,
				date: JUNE,
				quantity: 20,
				calculatedConsumption: 25,
				totalCost: 30,
				unit: 'gal',
				distanceUnit: 'mi'
			})
		];
		const insights = getInsights(fuelLogs, [], MPG_OPTS);
		const consumption = insights.find((i) => i.metric === 'consumption');
		expect(consumption).toBeDefined();
		expect(consumption?.direction).toBe('down');
		expect(consumption?.text).toBe('Consumption is up about 17% this month.');
	});

	it('is unaffected for an L/100km user — a numeric increase still renders "up" (regression guard)', () => {
		const fuelLogs = [
			createFuelEntry({ id: 1, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({ id: 2, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({ id: 3, date: JUNE, quantity: 20, calculatedConsumption: 9, totalCost: 30 }),
			createFuelEntry({ id: 4, date: JUNE, quantity: 20, calculatedConsumption: 9, totalCost: 30 })
		];
		const insights = getInsights(fuelLogs, [], OPTS);
		const consumption = insights.find((i) => i.metric === 'consumption');
		expect(consumption?.direction).toBe('up');
		expect(consumption?.text).toBe('Consumption is up about 13% this month.');
	});
});

describe('getInsights — spend detection', () => {
	it('fires a notable spend-up insight (>= 15%) from a June expense', () => {
		// Fuel held flat (May 60, June 60 → consumption + price flat); a June expense pushes spend
		// 60 → 80 = +33%.
		const fuelLogs = [
			createFuelEntry({ id: 1, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({ id: 2, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({ id: 3, date: JUNE, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({ id: 4, date: JUNE, quantity: 20, calculatedConsumption: 8, totalCost: 30 })
		];
		const expenses = [createMaintenanceEntry({ id: 5, date: JUNE, cost: 20 })];
		const insights = getInsights(fuelLogs, expenses, OPTS);
		const spend = insights.find((i) => i.metric === 'spend');
		expect(spend).toBeDefined();
		expect(spend?.direction).toBe('up');
		expect(spend?.text).toBe('Spending is up about 33% this month.');
	});

	it('does NOT fire for a non-home-currency-only dataset (the accepted Epic-5/FR-15 defer)', () => {
		// All spend is in '$', home is '€' → the home bucket is absent → no spend/price insight.
		const fuelLogs = [
			createFuelEntry({ id: 1, date: MAY, currency: '$', totalCost: 60, calculatedConsumption: 8 }),
			createFuelEntry({
				id: 2,
				date: JUNE,
				currency: '$',
				totalCost: 120,
				calculatedConsumption: 8
			})
		];
		const insights = getInsights(fuelLogs, [], OPTS);
		// Consumption is currency-independent (flat here), so the only comparable detection is a flat
		// consumption → calm baseline, never a $-denominated spend/price insight.
		expect(insights.every((i) => i.metric !== 'spend' && i.metric !== 'fuel-price')).toBe(true);
	});
});

describe('getInsights — fuel-price detection (trailing 90-day baseline)', () => {
	it('fires fuel-price-up when this month is pricier than the 90-day baseline', () => {
		// April (in the baseline window) = 40/40 = 1.0 €/L; June (current) = 60/40 = 1.5 €/L → +50%.
		// Consumption + spend are insufficient (no prior MONTH log) so only fuel-price is comparable.
		const fuelLogs = [
			createFuelEntry({
				id: 1,
				date: APRIL,
				quantity: 20,
				totalCost: 20,
				calculatedConsumption: 8
			}),
			createFuelEntry({
				id: 2,
				date: APRIL,
				quantity: 20,
				totalCost: 20,
				calculatedConsumption: 8
			}),
			createFuelEntry({ id: 3, date: JUNE, quantity: 20, totalCost: 30, calculatedConsumption: 8 }),
			createFuelEntry({ id: 4, date: JUNE, quantity: 20, totalCost: 30, calculatedConsumption: 8 })
		];
		const insights = getInsights(fuelLogs, [], OPTS);
		expect(insights).toEqual([
			{
				id: 'fuel-price-up',
				metric: 'fuel-price',
				severity: 'notable',
				direction: 'up',
				percentChange: 50,
				text: 'Fuel prices are up about 50% lately.'
			}
		]);
	});

	it('fuelPriceChange excludes the current month from the baseline (cold-start single month)', () => {
		// Only June data → the 90-day-before-June window is empty → no comparable baseline.
		const fuelLogs = [createFuelEntry({ id: 1, date: JUNE, quantity: 40, totalCost: 60 })];
		const change = fuelPriceChange(fuelLogs, '€', NOW);
		expect(change['€']).toEqual({ status: 'insufficient', reason: 'missing-period' });
	});

	it('excludes 0-cost fills from the price metric — no phantom price spike (H19a regression)', () => {
		// Imported fills with unknown cost are stored as totalCost 0 (commit-boundary convention).
		// Their litres used to dilute the baseline price toward 0 (60 / 480 L = 0.125 €/L here), so a
		// normal June fill read as a massive phantom increase (+1100%, "up ~4000%" in the audit's
		// longer history). A costless row carries no price information — it must be excluded.
		const fuelLogs = [
			...Array.from({ length: 11 }, (_, index) =>
				createFuelEntry({ id: index + 1, date: APRIL, quantity: 40, totalCost: 0 })
			),
			createFuelEntry({ id: 12, date: MAY, quantity: 40, totalCost: 60 }),
			createFuelEntry({ id: 13, date: JUNE, quantity: 20, totalCost: 30 }),
			createFuelEntry({ id: 14, date: JUNE, quantity: 20, totalCost: 30 })
		];

		const change = fuelPriceChange(fuelLogs, '€', NOW);
		expect(change['€'].status).toBe('ok');
		if (change['€'].status === 'ok') {
			expect(change['€'].previous).toBeCloseTo(1.5); // undiluted by the 0-cost litres
			expect(change['€'].percentChange).toBeCloseTo(0); // flat, not a phantom spike
		}

		const insights = getInsights(fuelLogs, [], OPTS);
		expect(insights.some((insight) => insight.metric === 'fuel-price')).toBe(false);
	});

	it('fuelPriceChange normalizes gallons to litres before averaging', () => {
		// 10 gal = 37.854 L at 37.854 cost → 1.0 €/L baseline (May); June 40 L at 60 → 1.5 €/L → +50%.
		const fuelLogs = [
			createFuelEntry({
				id: 1,
				date: MAY,
				unit: 'gal',
				quantity: 5,
				totalCost: 5 * 3.785411784
			}),
			createFuelEntry({
				id: 2,
				date: MAY,
				unit: 'gal',
				quantity: 5,
				totalCost: 5 * 3.785411784
			}),
			createFuelEntry({ id: 3, date: JUNE, unit: 'L', quantity: 20, totalCost: 30 }),
			createFuelEntry({ id: 4, date: JUNE, unit: 'L', quantity: 20, totalCost: 30 })
		];
		const change = fuelPriceChange(fuelLogs, '€', NOW);
		expect(change['€'].status).toBe('ok');
		if (change['€'].status === 'ok') {
			expect(change['€'].current).toBeCloseTo(1.5);
			expect(change['€'].previous).toBeCloseTo(1.0);
			expect(change['€'].percentChange).toBeCloseTo(50);
		}
	});

	it('fuelPriceChange is insufficient (insufficient-sample) with only a single fill-up on one side (H19b)', () => {
		const fuelLogs = [
			createFuelEntry({ id: 1, date: APRIL, quantity: 40, totalCost: 40 }), // only 1 in the baseline window
			createFuelEntry({ id: 2, date: JUNE, quantity: 20, totalCost: 30 }),
			createFuelEntry({ id: 3, date: JUNE, quantity: 20, totalCost: 30 })
		];
		expect(fuelPriceChange(fuelLogs, '€', NOW)['€']).toEqual({
			status: 'insufficient',
			reason: 'insufficient-sample'
		});
	});
});

describe('getInsights — H19b magnitude cap (qualitative "sharply" copy above 100%)', () => {
	it('renders a qualitative "sharply" message instead of a raw 4-digit percent for a near-zero baseline blowout', () => {
		// Baseline (April) price ≈ 0.01 €/L (2 logs, litres 20 total, cost 0.2); current (June) price
		// 5 €/L (2 logs, litres 20 total, cost 100). percentChange is ~49,900% — the old bug would have
		// rendered "up about 49900%"; the copy must instead say "sharply", with no {pct} number at all.
		const fuelLogs = [
			createFuelEntry({ id: 1, date: APRIL, quantity: 10, totalCost: 0.1 }),
			createFuelEntry({ id: 2, date: APRIL, quantity: 10, totalCost: 0.1 }),
			createFuelEntry({ id: 3, date: JUNE, quantity: 10, totalCost: 50 }),
			createFuelEntry({ id: 4, date: JUNE, quantity: 10, totalCost: 50 })
		];
		const insights = getInsights(fuelLogs, [], OPTS);
		const fuelPrice = insights.find((i) => i.metric === 'fuel-price');
		expect(fuelPrice).toBeDefined();
		expect(fuelPrice?.direction).toBe('up');
		expect(fuelPrice?.text).toBe('Fuel prices are up sharply lately.');
		expect(fuelPrice?.text).not.toMatch(/\d/);
	});

	it('renders the normal numeric message at exactly the 100% boundary (inclusive-numeric, not "sharply")', () => {
		// Baseline (April) price 1.0 €/L (2 logs, litres 20, cost 20); current (June) price 2.0 €/L
		// (2 logs, litres 20, cost 40) → exactly +100%, at the cap boundary — still a plain number.
		const fuelLogs = [
			createFuelEntry({ id: 1, date: APRIL, quantity: 10, totalCost: 10 }),
			createFuelEntry({ id: 2, date: APRIL, quantity: 10, totalCost: 10 }),
			createFuelEntry({ id: 3, date: JUNE, quantity: 10, totalCost: 20 }),
			createFuelEntry({ id: 4, date: JUNE, quantity: 10, totalCost: 20 })
		];
		const insights = getInsights(fuelLogs, [], OPTS);
		const fuelPrice = insights.find((i) => i.metric === 'fuel-price');
		expect(fuelPrice).toBeDefined();
		expect(fuelPrice?.percentChange).toBeCloseTo(100);
		expect(fuelPrice?.text).toBe('Fuel prices are up about 100% lately.');
	});
});

describe('getInsights — state machine (baseline vs hide)', () => {
	it('returns a calm baseline when data is sufficient but nothing is notable', () => {
		// May + June flat across every dimension.
		const fuelLogs = [
			createFuelEntry({ id: 1, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({ id: 2, date: MAY, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({ id: 3, date: JUNE, quantity: 20, calculatedConsumption: 8, totalCost: 30 }),
			createFuelEntry({ id: 4, date: JUNE, quantity: 20, calculatedConsumption: 8, totalCost: 30 })
		];
		expect(getInsights(fuelLogs, [], OPTS)).toEqual([
			{
				id: 'baseline',
				metric: 'baseline',
				severity: 'info',
				text: 'Running about average this month.'
			}
		]);
	});

	it('returns [] for no data at all', () => {
		expect(getInsights([], [], OPTS)).toEqual([]);
	});

	it('returns [] for a single-month dataset (every detection insufficient)', () => {
		const fuelLogs = [createFuelEntry({ id: 1, date: JUNE, quantity: 40, totalCost: 60 })];
		expect(getInsights(fuelLogs, [], OPTS)).toEqual([]);
	});
});

describe('getInsights — ranking + selectTopInsights', () => {
	// Build a dataset where all three dimensions are notable but at different exceedance multiples:
	//  - spend:        60 → 90  = +50% at 15% threshold → 3.33×
	//  - fuel-price:   1.0 → 1.5 = +50% at  5% threshold → 10.0×  (most significant)
	//  - consumption:  8 → 9.6  = +20% at 10% threshold → 2.0×    (least significant)
	function notableAcrossAll(): { fuelLogs: FuelLog[]; expenses: Expense[] } {
		const fuelLogs = [
			// May: baseline anchors price at 1.0 €/L and consumption at 8, spend at 40 (split across 2 logs).
			createFuelEntry({ id: 1, date: MAY, quantity: 20, totalCost: 20, calculatedConsumption: 8 }),
			createFuelEntry({ id: 2, date: MAY, quantity: 20, totalCost: 20, calculatedConsumption: 8 }),
			// June: 1.5 €/L (price +50%), consumption 9.6 (+20%), fuel spend 60 (split across 2 logs).
			createFuelEntry({
				id: 3,
				date: JUNE,
				quantity: 20,
				totalCost: 30,
				calculatedConsumption: 9.6
			}),
			createFuelEntry({
				id: 4,
				date: JUNE,
				quantity: 20,
				totalCost: 30,
				calculatedConsumption: 9.6
			})
		];
		// May spend = 40 (fuel) + 20 (expense) = 60; June spend = 60 (fuel) + 30 (expense) = 90 → +50%.
		const expenses = [
			createMaintenanceEntry({ id: 5, date: MAY, cost: 20 }),
			createMaintenanceEntry({ id: 6, date: JUNE, cost: 30 })
		];
		return { fuelLogs, expenses };
	}

	it('sorts most-significant-first by normalized exceedance', () => {
		const { fuelLogs, expenses } = notableAcrossAll();
		const insights = getInsights(fuelLogs, expenses, OPTS);
		expect(insights.map((i) => i.metric)).toEqual(['fuel-price', 'spend', 'consumption']);
	});

	it('selectTopInsights returns the single most-significant for Home (n=1)', () => {
		const { fuelLogs, expenses } = notableAcrossAll();
		const top = selectTopInsights(getInsights(fuelLogs, expenses, OPTS), 1);
		expect(top).toHaveLength(1);
		expect(top[0].metric).toBe('fuel-price');
	});

	it('selectTopInsights returns up to 3 for Understand (n=3)', () => {
		const { fuelLogs, expenses } = notableAcrossAll();
		const top = selectTopInsights(getInsights(fuelLogs, expenses, OPTS), 3);
		expect(top.map((i) => i.metric)).toEqual(['fuel-price', 'spend', 'consumption']);
	});

	it('tiebreaks equal normalized exceedance by DEC-3 metric priority (consumption before spend)', () => {
		// Consumption +20% (2× its 10%) and spend +30% (2× its 15%) → equal exceedance; fuel-price flat.
		// quantity 60 divides cleanly by the consumption values (60/10, 60/12) so averageConsumption's
		// round-trip returns EXACTLY 10 and 12 — the consumption exceedance is a true 2.0×, and the
		// tiebreak (not a float-rounding accident) decides the order.
		const fuelLogs = [
			createFuelEntry({ id: 1, date: MAY, quantity: 30, calculatedConsumption: 10, totalCost: 30 }),
			createFuelEntry({ id: 2, date: MAY, quantity: 30, calculatedConsumption: 10, totalCost: 30 }),
			createFuelEntry({
				id: 3,
				date: JUNE,
				quantity: 30,
				calculatedConsumption: 12,
				totalCost: 30
			}),
			createFuelEntry({ id: 4, date: JUNE, quantity: 30, calculatedConsumption: 12, totalCost: 30 })
		];
		// Fuel spend flat at 60 each month; expenses push total spend 100 → 130 (+30%).
		const expenses = [
			createMaintenanceEntry({ id: 5, date: MAY, cost: 40 }),
			createMaintenanceEntry({ id: 6, date: JUNE, cost: 70 })
		];
		const insights = getInsights(fuelLogs, expenses, OPTS);
		expect(insights.map((i) => i.metric)).toEqual(['consumption', 'spend']);
	});
});
