import type { FuelUnit } from '$lib/config';
import {
	CONSUMPTION_CHANGE_THRESHOLD_PCT,
	DEFAULT_CURRENCY,
	DEFAULT_UNIT,
	FUEL_PRICE_BASELINE_DAYS,
	FUEL_PRICE_CHANGE_THRESHOLD_PCT,
	SPEND_CHANGE_THRESHOLD_PCT
} from '$lib/config';
import type { Expense, FuelLog } from '$lib/db/schema';
import { isFiniteNumber, LITERS_PER_GALLON } from '$lib/utils/calculations';
import { mergeHistoryEntries } from '$lib/utils/historyEntries';
import { comparePeriods, consumptionDelta, spendDelta, type PeriodDelta } from './periodDelta';
import { m } from '$lib/paraglide/messages';

/**
 * Plain-language Insight engine — the last piece of the AD-5 derived-metrics engine (Story 4.3 /
 * FR-11, DEC-3). It maps the shipped 4.1 deltas + DEC-3 thresholds (config.ts) into ready-to-render,
 * non-alarmist English sentences. It detects exactly the three DEC-3 v1 changes — consumption Δ and
 * spend Δ vs the prior calendar month, fuel-price/litre Δ vs the trailing-90-day average — surfaces
 * only changes that exceed their own threshold, ranks them most-significant-first, and emits a calm
 * baseline line when data is sufficient but nothing is notable.
 *
 * Pure: no Svelte, no Dexie, no network, no clock read except the injectable `now` default (mirrors
 * the 4.1 engine). Returns plain data (`Insight[]`), NOT `Result<T>` (the read-model convention).
 * Spend/fuel-price are computed per currency and NEVER summed (offline, no FX); only the home-currency
 * bucket is surfaced (the accepted Story-3.3 → Epic-5/FR-15 non-home defer — an insight simply does
 * not fire for a non-home-currency-only dataset; documented, not patched here).
 *
 * `insight.ts` is the SINGLE owner of the phrasing (precedent: `serviceReminder.ts#buildLabel`). The
 * UI renders `Insight.text` verbatim and never re-derives it — so a later Epic-6 / Story 6.1 Paraglide
 * (`m.*()`) pass swaps the copy here with zero UI change. That is the "routes through t()" seam (AC7);
 * no `t()`/Paraglide is introduced now (it does not exist in the codebase).
 */

export type InsightMetric = 'consumption' | 'spend' | 'fuel-price';

export interface Insight {
	/** Stable key for {#each} keys + future i18n keying, e.g. 'consumption-up' | 'baseline'. */
	id: string;
	metric: InsightMetric | 'baseline';
	severity: 'info' | 'notable';
	/** Omitted for the baseline. */
	direction?: 'up' | 'down';
	/** Signed; used for ranking + the copy. Omitted for the baseline. */
	percentChange?: number;
	/** FINAL English copy — rendered verbatim (the t() seam). */
	text: string;
}

export interface InsightOptions {
	homeCurrency?: string;
	fuelUnit?: FuelUnit;
	now?: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Fixed priority for tie-breaking equally-significant insights — DEC-3 listing order.
const METRIC_PRIORITY: Record<InsightMetric, number> = {
	consumption: 0,
	spend: 1,
	'fuel-price': 2
};

/**
 * The plain-language copy table — Register B (numeric, OQ-3): honest, derives directly from the
 * engine percent, and trivially testable. `pct` is the rounded magnitude; direction is framed
 * humanly (up/down) and never as a warning (DEC-13 non-alarmist), and never invents a cause (UJ-4).
 */
function buildText(metric: InsightMetric, direction: 'up' | 'down', percentChange: number): string {
	const pct = Math.round(Math.abs(percentChange));
	switch (metric) {
		case 'consumption':
			return direction === 'up'
				? m.insight_consumption_up({ pct })
				: m.insight_consumption_down({ pct });
		case 'spend':
			return direction === 'up' ? m.insight_spend_up({ pct }) : m.insight_spend_down({ pct });
		case 'fuel-price':
			return direction === 'up'
				? m.insight_fuel_price_up({ pct })
				: m.insight_fuel_price_down({ pct });
	}
}

function getMonthKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Volume-weighted price per litre, per currency: `Σ totalCost / Σ litres`. Gallons are normalized to
 * litres (`quantity * LITERS_PER_GALLON`) so the ratio is comparable within a currency. Mirrors the
 * `isFiniteNumber` / non-positive guards the analytics aggregates use (PREP-1) — a non-finite or
 * non-positive row is skipped, and a currency with no usable volume yields no entry.
 */
function pricePerLitreByCurrency(
	fuelLogs: FuelLog[],
	homeCurrency: string
): Record<string, number> {
	const totals = new Map<string, { cost: number; litres: number }>();
	for (const log of fuelLogs) {
		if (!isFiniteNumber(log.totalCost) || !isFiniteNumber(log.quantity) || log.quantity <= 0) {
			continue;
		}
		const currency = log.currency ?? homeCurrency;
		const litres = log.unit === 'gal' ? log.quantity * LITERS_PER_GALLON : log.quantity;
		const current = totals.get(currency) ?? { cost: 0, litres: 0 };
		current.cost += log.totalCost;
		current.litres += litres;
		totals.set(currency, current);
	}

	const result: Record<string, number> = {};
	for (const [currency, { cost, litres }] of totals) {
		if (isFiniteNumber(cost) && litres > 0) {
			result[currency] = cost / litres;
		}
	}
	return result;
}

/**
 * Fuel-price/litre delta per currency (Story 4.3, the net-new derivation — no engine producer
 * exists; 4.1 explicitly punted it here). Unlike the MoM detections, the baseline is the TRAILING
 * 90-day average (DEC-3, `FUEL_PRICE_BASELINE_DAYS`), so it lives here rather than in `periodDelta.ts`
 * — but it REUSES the `comparePeriods` primitive. `current` = the current calendar month's price/litre;
 * `baseline` = the average price/litre across the 90 days BEFORE the current month.
 *
 * OQ-1 resolution: the baseline EXCLUDES the current month (the "90 days before the current month"
 * reading) rather than including it. Including the current month would make a single-month-only dataset
 * compare its price against a baseline that IS itself → trivially 0% → a misleading "Running about
 * average this month." baseline insight in the exact cold-start state where AC5 requires rendering
 * nothing. Excluding it gives a genuine prior-period contrast and the correct cold-start `[]` (and
 * makes fuel-price semantically parallel to the MoM detections, whose baseline never includes `now`).
 * Per currency, never summed; exported so it is independently unit-testable.
 */
export function fuelPriceChange(
	fuelLogs: FuelLog[],
	homeCurrency: string = DEFAULT_CURRENCY,
	now: Date = new Date()
): Record<string, PeriodDelta> {
	const currentMonthKey = getMonthKey(now);
	const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
	const baselineStart = currentMonthStart - FUEL_PRICE_BASELINE_DAYS * MS_PER_DAY;

	const currentLogs = fuelLogs.filter((log) => getMonthKey(log.date) === currentMonthKey);
	const baselineLogs = fuelLogs.filter((log) => {
		const time = log.date.getTime();
		return time >= baselineStart && time < currentMonthStart;
	});

	const currentPrice = pricePerLitreByCurrency(currentLogs, homeCurrency);
	const baselinePrice = pricePerLitreByCurrency(baselineLogs, homeCurrency);

	const currencies = new Set([...Object.keys(currentPrice), ...Object.keys(baselinePrice)]);
	const result: Record<string, PeriodDelta> = {};
	for (const currency of currencies) {
		result[currency] = comparePeriods(
			currentPrice[currency] ?? null,
			baselinePrice[currency] ?? null
		);
	}
	return result;
}

interface Detection {
	metric: InsightMetric;
	delta: PeriodDelta | null;
	threshold: number;
}

function makeNotable(
	metric: InsightMetric,
	delta: Extract<PeriodDelta, { status: 'ok' }>
): Insight {
	// A notable change exceeds its threshold, so |percentChange| is well above the flat band — the
	// engine's `direction` is 'up' or 'down' here ('flat' is only returned on an exact 0).
	const direction = delta.direction === 'down' ? 'down' : 'up';
	return {
		id: `${metric}-${direction}`,
		metric,
		severity: 'notable',
		direction,
		percentChange: delta.percentChange,
		text: buildText(metric, direction, delta.percentChange)
	};
}

/**
 * Compute the plain-language insights for a dataset, sorted most-significant-first.
 *
 * State machine (AC5):
 * - ≥1 notable change → one `notable` Insight per exceeding detection, ranked.
 * - ≥1 detection is `status:'ok'` but none exceeds its threshold → one calm `info` baseline.
 * - every detection is `insufficient`/absent (or there is no data) → `[]` (the UI renders nothing;
 *   HeroMetric already carries the cold-start/insufficient copy — no duplication).
 */
export function getInsights(
	fuelLogs: FuelLog[],
	expenses: Expense[],
	options: InsightOptions = {}
): Insight[] {
	const homeCurrency = options.homeCurrency ?? DEFAULT_CURRENCY;
	const fuelUnit = options.fuelUnit ?? DEFAULT_UNIT;
	const now = options.now ?? new Date();

	const entries = mergeHistoryEntries(fuelLogs, expenses);

	const detections: Detection[] = [
		{
			metric: 'consumption',
			delta: consumptionDelta(fuelLogs, fuelUnit, now),
			threshold: CONSUMPTION_CHANGE_THRESHOLD_PCT
		},
		{
			metric: 'spend',
			delta: spendDelta(entries, homeCurrency, now)[homeCurrency] ?? null,
			threshold: SPEND_CHANGE_THRESHOLD_PCT
		},
		{
			metric: 'fuel-price',
			delta: fuelPriceChange(fuelLogs, homeCurrency, now)[homeCurrency] ?? null,
			threshold: FUEL_PRICE_CHANGE_THRESHOLD_PCT
		}
	];

	const notables: Insight[] = [];
	let anyComparable = false;

	for (const { metric, delta, threshold } of detections) {
		if (!delta || delta.status !== 'ok') {
			continue;
		}
		anyComparable = true;
		if (Math.abs(delta.percentChange) >= threshold) {
			notables.push(makeNotable(metric, delta));
		}
	}

	if (notables.length > 0) {
		return sortBySignificance(notables);
	}

	// Sufficient data but nothing notable → one calm baseline (honors FR-11 "at least one insight on
	// Home" when data is present). No comparable baseline anywhere → render nothing (HeroMetric covers
	// the cold-start / insufficient state, so the insight line must not duplicate it).
	if (anyComparable) {
		return [{ id: 'baseline', metric: 'baseline', severity: 'info', text: m.insight_baseline() }];
	}
	return [];
}

/**
 * Rank notable insights most-significant-first by NORMALIZED EXCEEDANCE — `|percentChange| / threshold`
 * (OQ-2): so a 30% spend at 2× its 15% threshold outranks a 12% consumption at 1.2× its 10% threshold,
 * which a raw-magnitude sort would get backwards. Tiebreak by fixed DEC-3 metric priority.
 */
function sortBySignificance(insights: Insight[]): Insight[] {
	const thresholdFor: Record<InsightMetric, number> = {
		consumption: CONSUMPTION_CHANGE_THRESHOLD_PCT,
		spend: SPEND_CHANGE_THRESHOLD_PCT,
		'fuel-price': FUEL_PRICE_CHANGE_THRESHOLD_PCT
	};
	const exceedance = (insight: Insight): number => {
		const metric = insight.metric as InsightMetric;
		return Math.abs(insight.percentChange ?? 0) / thresholdFor[metric];
	};
	return [...insights].sort((left, right) => {
		const delta = exceedance(right) - exceedance(left);
		if (delta !== 0) {
			return delta;
		}
		return (
			METRIC_PRIORITY[left.metric as InsightMetric] - METRIC_PRIORITY[right.metric as InsightMetric]
		);
	});
}

/**
 * The top `limit` insights. Home passes `1` (the single most-significant); the /understand route
 * (Story 4.4) will pass `MAX_INSIGHTS_UNDERSTAND`. Pure slice — `getInsights` already sorted.
 */
export function selectTopInsights(insights: Insight[], limit: number): Insight[] {
	return insights.slice(0, limit);
}
