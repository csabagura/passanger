import { formatCurrency, isFiniteNumber } from '$lib/utils/calculations';
import {
	convertHistorySpendToHome,
	resolveHistoryEntryCurrency,
	type HistoryEntry
} from '$lib/utils/historyEntries';
import { m } from '$lib/paraglide/messages';

export interface DisplayRateBlend {
	/** Approximate single home-currency total (Σ home entries at rate 1 + Σ foreign × rate). */
	total: number;
	/** The spec label: "using your rate (1 X = Y)" for one rated currency, else "using your rates". */
	label: string;
	/** Foreign entries whose currency still has no usable rate (shown unconverted alongside). */
	unconvertedEntries: number;
}

/**
 * Story 5.2 (FR-15, DEC-4). Select the optional blended Display-Rate total for a surface (Understand).
 * This is pure display/label logic — the arithmetic is delegated to the shipped
 * `convertHistorySpendToHome` engine; we never re-implement the conversion or storage. Returns `null`
 * when nothing converts (`ratedEntries === 0`), which is the "no usable rate → no blended number" gate
 * (the same `ratedEntries > 0` gate History uses), so a lone home-currency total never masquerades as a
 * blend.
 */
export function selectDisplayRateBlend(
	entries: HistoryEntry[],
	homeCurrency: string,
	rates: Record<string, number> | undefined
): DisplayRateBlend | null {
	const blend = convertHistorySpendToHome(entries, homeCurrency, rates);
	if (blend.ratedEntries === 0) {
		return null;
	}

	return {
		total: blend.total,
		unconvertedEntries: blend.unconvertedEntries,
		label: buildBlendLabel(
			collectRatedForeignCurrencies(entries, homeCurrency, rates),
			homeCurrency,
			rates
		)
	};
}

/**
 * The distinct non-home currencies present in `entries` that have a usable (finite > 0) rate. The
 * `ratedEntries > 0` gate in the caller guarantees this is non-empty when a label is built.
 */
function collectRatedForeignCurrencies(
	entries: HistoryEntry[],
	homeCurrency: string,
	rates: Record<string, number> | undefined
): string[] {
	const rated = new Set<string>();
	for (const entry of entries) {
		const currency = resolveHistoryEntryCurrency(entry, homeCurrency);
		if (currency === homeCurrency) {
			continue;
		}
		const rate = rates?.[currency];
		if (isFiniteNumber(rate) && rate > 0) {
			rated.add(currency);
		}
	}
	return [...rated];
}

function buildBlendLabel(
	ratedForeignCurrencies: string[],
	homeCurrency: string,
	rates: Record<string, number> | undefined
): string {
	// Two or more rated foreign currencies → no single inline pair fits, mirror History's "your rates".
	if (ratedForeignCurrencies.length >= 2) {
		return m.display_rate_label_multi();
	}

	const currency = ratedForeignCurrencies[0];
	// Non-null per the ratedEntries > 0 gate, but guard defensively rather than assert.
	const rate = rates?.[currency];
	if (!isFiniteNumber(rate) || rate <= 0) {
		return m.display_rate_label_multi();
	}

	// For a weak foreign currency (home €, rate ≈ 0.0025), "1 Ft = €0.00" is useless; flip to the
	// legible inverse "1 € = 400 Ft".
	if (roundsToZero(rate, homeCurrency)) {
		return m.display_rate_label_single({
			from: homeCurrency,
			to: formatCurrency(1 / rate, currency)
		});
	}
	return m.display_rate_label_single({ from: currency, to: formatCurrency(rate, homeCurrency) });
}

/**
 * Whether `formatCurrency(value, currency)` would round to a zero amount at the currency's decimals
 * (e.g. "€0.00" / "0 Ft"). Re-formats and re-parses so it tracks `formatCurrency`'s rounding without
 * duplicating its zero-decimal/suffix tables.
 */
function roundsToZero(value: number, currency: string): boolean {
	const numeric = parseFloat(formatCurrency(value, currency).replace(/[^0-9.]/g, ''));
	return numeric === 0;
}
