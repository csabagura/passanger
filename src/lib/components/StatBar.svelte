<script lang="ts">
	import { formatConsumption, formatCurrency } from '$lib/utils/calculations';
	import { m } from '$lib/paraglide/messages';
	import type { HistorySummary } from '$lib/utils/historyEntries';

	interface Props {
		summary: HistorySummary;
		selectedPeriodTotal: number;
		selectedPeriodLabel: string;
		selectedPeriodAriaLabel: string;
		currency: string;
		// Spend split by currency for the selected period. When more than one currency is
		// present the totals are shown per currency (they can't be summed without an FX
		// rate). Omitted/single-currency → behaves exactly like the single-total display.
		selectedPeriodSpendByCurrency?: Record<string, number>;
		// Optional approximate home-currency total derived from user-entered rates. Only
		// shown when the period is multi-currency. Null/omitted → no converted line (the
		// caller passes null when nothing converts), keeping single-currency output identical.
		convertedHomeTotal?: { total: number; unconvertedEntries: number } | null;
		homeCurrency?: string;
	}

	let {
		summary,
		selectedPeriodTotal,
		selectedPeriodLabel,
		selectedPeriodAriaLabel,
		currency,
		selectedPeriodSpendByCurrency = undefined,
		convertedHomeTotal = null,
		homeCurrency = undefined
	}: Props = $props();

	const spendByCurrencyEntries = $derived(
		selectedPeriodSpendByCurrency ? Object.entries(selectedPeriodSpendByCurrency) : []
	);
	const isMultiCurrency = $derived(spendByCurrencyEntries.length > 1);
	// Approximate converted total, shown only for multi-currency views with at least one
	// usable rate (the caller passes null otherwise). Marked `· your rates` to signal it is
	// user-entered/approximate; appends an unconverted-entry count when some entries lack a rate.
	const showConvertedHomeTotal = $derived(isMultiCurrency && convertedHomeTotal !== null);
	const formattedConvertedHomeTotal = $derived(
		convertedHomeTotal
			? `${m.stat_converted_total({
					amount: formatCurrency(convertedHomeTotal.total, homeCurrency ?? currency)
				})}${
					convertedHomeTotal.unconvertedEntries > 0
						? ` ${m.stat_unconverted_suffix({ count: convertedHomeTotal.unconvertedEntries })}`
						: ''
				}`
			: ''
	);
	// Single currency (the common case) renders identically to before; multi-currency
	// joins each currency's subtotal with a separator.
	const formattedSelectedPeriodTotal = $derived(
		isMultiCurrency
			? spendByCurrencyEntries.map(([cur, amount]) => formatCurrency(amount, cur)).join(' · ')
			: formatCurrency(selectedPeriodTotal, currency)
	);

	// The "Total spend" grid stat reflects the summary's own breakdown (which, in the app,
	// equals the selected period). Segmented when multiple currencies are present.
	const summarySpendByCurrencyEntries = $derived(Object.entries(summary.totalSpendByCurrency));
	const formattedTotalSpend = $derived(
		summarySpendByCurrencyEntries.length > 1
			? summarySpendByCurrencyEntries
					.map(([cur, amount]) => formatCurrency(amount, cur))
					.join(' · ')
			: formatCurrency(summary.totalSpend, summarySpendByCurrencyEntries[0]?.[0] ?? currency)
	);

	function formatVolume(value: number): string {
		return Number.isInteger(value) ? String(value) : value.toFixed(1);
	}

	function formatVolumeWithUnit(value: number, unit: HistorySummary['fuelVolumeUnit']): string {
		return `${formatVolume(value)} ${unit}`;
	}
</script>

<section
	aria-labelledby="history-stat-bar-title"
	class="rounded-3xl border border-border bg-card p-4 shadow-sm"
>
	<h2 id="history-stat-bar-title" class="sr-only">{m.stat_section_title()}</h2>

	<div
		aria-label={m.stat_period_aria({
			label: selectedPeriodAriaLabel,
			total: formattedSelectedPeriodTotal
		})}
		role="group"
		class="space-y-1"
	>
		<p class="text-[2rem] font-bold leading-none tabular-nums text-foreground">
			{formattedSelectedPeriodTotal}
		</p>
		{#if showConvertedHomeTotal}
			<p class="text-sm tabular-nums text-muted-foreground">
				{formattedConvertedHomeTotal}
			</p>
		{/if}
		<p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">{selectedPeriodLabel}</p>
	</div>

	<dl
		class="mt-4 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-2xl border border-border bg-muted/30"
	>
		<div class="flex flex-col-reverse gap-1 px-3 py-4 text-center">
			<dt class="text-xs uppercase tracking-[0.16em] text-muted-foreground">
				{m.stat_total_spend()}
			</dt>
			<dd class="text-lg font-semibold tabular-nums text-foreground">
				{formattedTotalSpend}
			</dd>
		</div>

		<div class="flex flex-col-reverse gap-1 px-3 py-4 text-center">
			<dt class="text-xs uppercase tracking-[0.16em] text-muted-foreground">
				{m.stat_fuel_volume()}
			</dt>
			<dd class="text-lg font-semibold tabular-nums text-foreground">
				{formatVolumeWithUnit(summary.totalFuelVolume, summary.fuelVolumeUnit)}
			</dd>
		</div>

		<div class="flex flex-col-reverse gap-1 px-3 py-4 text-center">
			<dt class="text-xs uppercase tracking-[0.16em] text-muted-foreground">
				{m.stat_avg_consumption()}
			</dt>
			<dd class="text-lg font-semibold tabular-nums text-foreground">
				{#if summary.averageConsumption === null}
					{m.stat_no_data()}
				{:else}
					{formatConsumption(summary.averageConsumption, summary.averageConsumptionUnit)}
				{/if}
			</dd>
		</div>
	</dl>
</section>
