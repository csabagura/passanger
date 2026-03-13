<script lang="ts">
	import { formatConsumption, formatCurrency } from '$lib/utils/calculations';
	import type { HistorySummary } from '$lib/utils/historyEntries';

	interface Props {
		summary: HistorySummary;
		selectedPeriodTotal: number;
		selectedPeriodLabel: string;
		selectedPeriodAriaLabel: string;
		currency: string;
	}

	let {
		summary,
		selectedPeriodTotal,
		selectedPeriodLabel,
		selectedPeriodAriaLabel,
		currency
	}: Props = $props();

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
	<h2 id="history-stat-bar-title" class="sr-only">History totals</h2>

	<div
		aria-label={`${selectedPeriodAriaLabel}: ${formatCurrency(selectedPeriodTotal, currency)}`}
		role="group"
		class="space-y-1"
	>
		<p class="text-[2rem] font-bold leading-none tabular-nums text-foreground">
			{formatCurrency(selectedPeriodTotal, currency)}
		</p>
		<p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">{selectedPeriodLabel}</p>
	</div>

	<dl
		class="mt-4 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-2xl border border-border bg-muted/30"
	>
		<div class="flex flex-col-reverse gap-1 px-3 py-4 text-center">
			<dt class="text-xs uppercase tracking-[0.16em] text-muted-foreground">Total spend</dt>
			<dd class="text-lg font-semibold tabular-nums text-foreground">
				{formatCurrency(summary.totalSpend, currency)}
			</dd>
		</div>

		<div class="flex flex-col-reverse gap-1 px-3 py-4 text-center">
			<dt class="text-xs uppercase tracking-[0.16em] text-muted-foreground">Fuel volume</dt>
			<dd class="text-lg font-semibold tabular-nums text-foreground">
				{formatVolumeWithUnit(summary.totalFuelVolume, summary.fuelVolumeUnit)}
			</dd>
		</div>

		<div class="flex flex-col-reverse gap-1 px-3 py-4 text-center">
			<dt class="text-xs uppercase tracking-[0.16em] text-muted-foreground">Avg consumption</dt>
			<dd class="text-lg font-semibold tabular-nums text-foreground">
				{#if summary.averageConsumption === null}
					No data
				{:else}
					{formatConsumption(summary.averageConsumption, summary.averageConsumptionUnit)}
				{/if}
			</dd>
		</div>
	</dl>
</section>
