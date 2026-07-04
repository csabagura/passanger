<script lang="ts">
	import { onDestroy, getContext } from 'svelte';
	import { resolve } from '$app/paths';
	import { createRepoLiveQuery } from '$lib/state/liveQuery.svelte';
	import { getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
	import { getAllExpenses } from '$lib/db/repositories/expenses';
	import InteractiveChart, { type ChartDatum } from '$lib/components/InteractiveChart.svelte';
	import DbErrorCard from '$lib/components/DbErrorCard.svelte';
	import {
		consumptionTrend,
		fuelVsMaintenanceSplit,
		maintenanceCostTrend,
		monthlySpendByCurrency
	} from '$lib/utils/analytics';
	import { getInsights, selectTopInsights } from '$lib/utils/metrics/insight';
	import {
		formatConsumption,
		formatCurrency,
		getVolumeUnitForFuelUnit,
		isFiniteNumber
	} from '$lib/utils/calculations';
	import { mergeHistoryEntries, summarizeSpendByCurrency } from '$lib/utils/historyEntries';
	import { selectDisplayRateBlend } from '$lib/utils/displayRate';
	import { MAX_INSIGHTS_UNDERSTAND } from '$lib/config';
	import { m } from '$lib/paraglide/messages';
	import type { AppSettings } from '$lib/utils/settings';
	import type { FuelLog, Expense } from '$lib/db/schema';

	interface Props {
		// A FIXED active-vehicle id for this component's lifetime. The Understand shell wraps this in a
		// `{#key currentVehicle.id}` block, so a vehicle switch tears this instance down (onDestroy →
		// liveQuery.destroy) and mounts a fresh one — mirrors HomeDashboard.
		vehicleId: number;
		vehicleName?: string;
		// Injectable reference date for the insight detections (mirrors HeroMetric / InsightLine). Absent
		// in production → the engine reads the real clock; tests pin a fixed Date for determinism.
		now?: Date;
	}

	let { vehicleId, vehicleName, now }: Props = $props();

	// AD-4 reactive reads (mirror HomeDashboard): a new Capture (fuel OR expense) re-emits here without
	// a reload. `initial = undefined` distinguishes "not loaded yet" (→ skeleton) from "loaded empty"
	// (→ no-data state). Reads go through repositories (Dexie-isolation contract). This replaces the
	// retired analytics page's one-shot load + tabSync.dataRevision $effect.
	const fuelQuery = createRepoLiveQuery<FuelLog[]>(() => getAllFuelLogs(vehicleId), undefined);
	const expenseQuery = createRepoLiveQuery<Expense[]>(() => getAllExpenses(vehicleId), undefined);

	onDestroy(() => {
		fuelQuery.destroy();
		expenseQuery.destroy();
	});

	const loading = $derived(fuelQuery.current === undefined || expenseQuery.current === undefined);
	const dbError = $derived(Boolean(fuelQuery.error) || Boolean(expenseQuery.error));

	const fuelLogs = $derived(fuelQuery.current ?? []);
	const expenses = $derived(expenseQuery.current ?? []);

	// The dashboard reads the 'settings' context itself (mirror HeroMetric / InsightLine) for the home
	// currency + preferred fuel unit the per-currency aggregates need.
	const settingsCtx = getContext<{ settings: AppSettings }>('settings');
	const homeCurrency = $derived(settingsCtx.settings.currency);
	const fuelUnit = $derived(settingsCtx.settings.fuelUnit);
	const volumeUnit = $derived(getVolumeUnitForFuelUnit(fuelUnit));
	// User-entered Display Rates (Story 5.2 / FR-15, DEC-4) — already present on the settings context,
	// reactive via notifySettingsChanged, no liveQuery/dataRevision plumbing needed.
	const exchangeRates = $derived(settingsCtx.settings.exchangeRates);

	const entries = $derived(mergeHistoryEntries(fuelLogs, expenses));
	const hasData = $derived(entries.length > 0);

	// --- Plain-language insights (Story-4.3 handoff, FR-11): up to 3, rendered verbatim above the
	// charts (the t() seam — UI never re-derives copy). Empty list → render nothing (no dead-end). ---
	const insights = $derived(
		selectTopInsights(
			getInsights(fuelLogs, expenses, { homeCurrency, fuelUnit, now }),
			MAX_INSIGHTS_UNDERSTAND
		)
	);

	// --- Monthly spend (home-currency series) --- S27: monthlySpendByCurrency is now engine-owned
	// zero-filled across its own data range, so a real zero-spend month renders as a zero-value bar
	// rather than being dropped — no `value > 0` filter here.
	const monthlyPoints = $derived<ChartDatum[]>(
		monthlySpendByCurrency(entries, homeCurrency).map((bucket) => {
			const value = bucket.byCurrency[homeCurrency] ?? 0;
			return {
				label: bucket.label,
				value,
				valueText: formatCurrency(value, homeCurrency)
			};
		})
	);

	// --- Consumption trend — each point is 1:1 with a fuel log, so it links back to /history (no
	// per-entry deep link exists today; see Dev Notes "Link-to-entry reality"). The value is ALREADY in
	// the display unit (consumptionTrend converts), so format with formatConsumption — NOT
	// formatConsumptionForDisplay (that double-converts; the recurring Story-3.4 trap). ---
	const consumptionPoints = $derived<ChartDatum[]>(
		consumptionTrend(fuelLogs, fuelUnit).map((point) => ({
			label: point.label,
			value: point.consumption,
			valueText: formatConsumption(point.consumption, volumeUnit),
			entryHref: resolve('/history')
		}))
	);

	// --- Maintenance cost trend (NET-NEW, FR-14) — home-currency monthly Expense totals. Aggregate
	// bars sum many entries → no single-entry link. S27: zero-filled across its own data range — no
	// `value > 0` filter (a real zero-spend month renders as a zero-value bar, not a gap). ---
	const maintenancePoints = $derived<ChartDatum[]>(
		maintenanceCostTrend(expenses, homeCurrency).map((bucket) => {
			const value = bucket.byCurrency[homeCurrency] ?? 0;
			return {
				label: bucket.label,
				value,
				valueText: formatCurrency(value, homeCurrency)
			};
		})
	);

	// --- Fuel vs maintenance split (keep the existing accessible stacked-bar + legend; add a view-as-
	// table toggle for FR-17 parity without regressing the legend) ---
	const splitByCurrency = $derived(fuelVsMaintenanceSplit(entries, homeCurrency));
	const homeSplit = $derived(splitByCurrency[homeCurrency] ?? { fuel: 0, maintenance: 0 });
	const homeSplitTotal = $derived(homeSplit.fuel + homeSplit.maintenance);
	const fuelSplitPercent = $derived(
		homeSplitTotal > 0 ? (homeSplit.fuel / homeSplitTotal) * 100 : 0
	);
	const maintenanceSplitPercent = $derived(
		homeSplitTotal > 0 ? (homeSplit.maintenance / homeSplitTotal) * 100 : 0
	);
	const splitChartLabel = $derived(
		homeSplitTotal > 0
			? m.understand_split_aria({
					currency: homeCurrency,
					fuelAmount: formatCurrency(homeSplit.fuel, homeCurrency),
					fuelPercent: Math.round(fuelSplitPercent),
					maintenanceAmount: formatCurrency(homeSplit.maintenance, homeCurrency),
					maintenancePercent: Math.round(maintenanceSplitPercent)
				})
			: m.understand_split_aria_empty()
	);
	let splitAsTable = $state(false);

	// --- Other-currency note: totals we can't merge into the home-currency charts (offline, no FX —
	// the accepted Story-3.3 → Epic-5/FR-15 defer). ---
	const spendByCurrency = $derived(summarizeSpendByCurrency(entries, homeCurrency));
	const otherCurrencyTotals = $derived(
		Object.entries(spendByCurrency)
			.filter(([currency]) => currency !== homeCurrency)
			.sort(([, left], [, right]) => right - left)
	);
	// --- Optional blended home total (Story 5.2 / FR-15) — reuses the shipped convertHistorySpendToHome
	// engine over the same `entries`, gated on a usable Display Rate (null when nothing converts, exactly
	// like History's `ratedEntries > 0` gate). No rate → null → no number, keeping the no-rate view
	// byte-identical. ---
	const displayRateBlend = $derived(selectDisplayRateBlend(entries, homeCurrency, exchangeRates));

	// When a blend shows, the honest "not converted" note narrows to the foreign currencies that still
	// lack a usable rate (partial coverage stays honest); when no blend shows it lists every foreign
	// currency exactly as before (byte-identical no-rate rendering — AC3).
	const unconvertedCurrencyTotals = $derived(
		displayRateBlend
			? otherCurrencyTotals.filter(([currency]) => {
					const rate = exchangeRates?.[currency];
					return !(isFiniteNumber(rate) && rate > 0);
				})
			: otherCurrencyTotals
	);
	const hasUnconvertedCurrencies = $derived(unconvertedCurrencyTotals.length > 0);
</script>

<div class="px-4 pt-4">
	<div class="space-y-6">
		<header class="space-y-1">
			<h1 class="text-xl font-semibold text-foreground">{m.understand_title()}</h1>
			{#if vehicleName}
				<p class="text-sm text-muted-foreground">
					{m.understand_subtitle_vehicle({ name: vehicleName })}
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					{m.understand_subtitle_generic()}
				</p>
			{/if}
		</header>

		{#if dbError}
			<!-- DB-error takes precedence: a rejected read never emits a `current`, so `loading` would
			     otherwise stay true forever and trap the surface on the skeleton. -->
			<DbErrorCard
				title={m.understand_db_error_title()}
				body={m.understand_db_error_body()}
				ctaLabel={m.understand_export_data()}
			/>
		{:else if loading}
			<!-- Cold-load skeleton: hand-rolled motion-safe pulse (mirror HomeSkeleton — NO shadcn, protects
			     NFR-4). aria-hidden shapes + a polite status sibling for screen readers. -->
			<p class="sr-only" role="status" aria-live="polite">{m.understand_loading()}</p>
			<div aria-hidden="true" class="space-y-4">
				{#each [0, 1, 2] as block (block)}
					<div class="rounded-3xl border border-border bg-card p-4">
						<div class="h-4 w-32 rounded bg-muted motion-safe:animate-pulse"></div>
						<div class="mt-3 h-44 w-full rounded-lg bg-muted motion-safe:animate-pulse"></div>
					</div>
				{/each}
			</div>
		{:else if !hasData}
			<div
				role="region"
				aria-label={m.understand_no_data_region()}
				class="rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center"
			>
				<p class="text-base font-semibold text-foreground">{m.understand_no_data_title()}</p>
				<p class="mt-1 text-sm text-muted-foreground">
					{m.understand_no_data_body()}
				</p>
			</div>
		{:else}
			<!-- ≤3 plain-language insights, above the charts (Story-4.3 handoff). Verbatim text only. -->
			{#if insights.length}
				<div class="space-y-1">
					{#each insights as insight (insight.id)}
						<p class="text-base text-foreground">{insight.text}</p>
					{/each}
				</div>
			{/if}

			{#if displayRateBlend}
				<!-- Blended home-currency total from the user's own Display Rate (FR-15, DEC-4). Real,
				     selectable text (NFR-3); `≈` precedes the value as a readable approximation marker, not an
				     icon-only signal. Calm, non-alarmist voice (no FX claim — "using your rate"). -->
				<p class="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
					{m.understand_blend_total({
						amount: formatCurrency(displayRateBlend.total, homeCurrency),
						label: displayRateBlend.label
					})}
				</p>
			{/if}

			{#if hasUnconvertedCurrencies}
				<p
					class="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground"
				>
					{m.understand_unconverted_note_lead({ currency: homeCurrency })}
					<span class="font-medium text-foreground"
						>{unconvertedCurrencyTotals
							.map(([currency, amount]) => formatCurrency(amount, currency))
							.join(' · ')}</span
					>.
				</p>
			{/if}

			<!-- Monthly spend (bar) -->
			<InteractiveChart
				idBase="understand-monthly"
				title={m.chart_monthly_spend_title()}
				kind="bar"
				points={monthlyPoints}
				subtitle={m.chart_monthly_spend_subtitle({ currency: homeCurrency })}
				ariaSummary={m.chart_monthly_spend_aria({ currency: homeCurrency })}
				emptyText={m.understand_no_spend_in_currency({ currency: homeCurrency })}
			/>

			<!-- Consumption trend (line) -->
			<InteractiveChart
				idBase="understand-consumption"
				title={m.chart_consumption_title()}
				kind="line"
				points={consumptionPoints}
				subtitle={m.chart_consumption_subtitle({ unit: volumeUnit === 'L' ? 'L/100km' : 'MPG' })}
				ariaSummary={m.chart_consumption_aria()}
				emptyText={m.chart_consumption_empty()}
				singlePointHint={m.chart_consumption_single_hint()}
			/>

			<!-- Maintenance cost trend (bar, NET-NEW FR-14) -->
			<InteractiveChart
				idBase="understand-maintenance"
				title={m.chart_maintenance_title()}
				kind="bar"
				points={maintenancePoints}
				subtitle={m.chart_maintenance_subtitle({ currency: homeCurrency })}
				ariaSummary={m.chart_maintenance_aria({ currency: homeCurrency })}
				emptyText={m.understand_no_maintenance_in_currency({ currency: homeCurrency })}
			/>

			<!-- Fuel vs maintenance split (keep the bespoke stacked bar + accessible legend; the legend is
			     already a screen-reader-navigable representation. A view-as-table toggle is offered for
			     FR-17 parity without forcing the split through InteractiveChart, which would risk the
			     legend). -->
			<section
				aria-labelledby="understand-split-title"
				class="space-y-3 rounded-3xl border border-border bg-card p-4 shadow-sm"
			>
				<div class="flex items-start justify-between gap-3">
					<div class="space-y-1">
						<h2 id="understand-split-title" class="text-base font-semibold text-foreground">
							{m.understand_split_title()}
						</h2>
						<p class="text-xs text-muted-foreground">
							{m.understand_split_subtitle({ currency: homeCurrency })}
						</p>
					</div>
					{#if homeSplitTotal > 0}
						<button
							type="button"
							aria-pressed={splitAsTable}
							onclick={() => (splitAsTable = !splitAsTable)}
							class="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
						>
							{splitAsTable ? m.chart_view_as_chart() : m.chart_view_as_table()}
						</button>
					{/if}
				</div>

				{#if homeSplitTotal <= 0}
					<p class="py-6 text-center text-sm text-muted-foreground">
						{m.understand_no_spend_in_currency({ currency: homeCurrency })}
					</p>
				{:else if splitAsTable}
					<table class="w-full border-collapse text-sm">
						<caption class="sr-only"
							>{m.understand_split_caption({ detail: splitChartLabel })}</caption
						>
						<thead>
							<tr class="border-b border-border text-left text-xs text-muted-foreground">
								<th scope="col" class="py-1.5 pr-3 font-medium"
									>{m.understand_split_col_category()}</th
								>
								<th scope="col" class="py-1.5 pr-3 font-medium"
									>{m.understand_split_col_amount()}</th
								>
								<th scope="col" class="py-1.5 font-medium">{m.understand_split_col_share()}</th>
							</tr>
						</thead>
						<tbody>
							<tr class="border-b border-border/50">
								<td class="py-1.5 pr-3 text-foreground">{m.common_fuel()}</td>
								<td class="py-1.5 pr-3 tabular-nums text-foreground"
									>{formatCurrency(homeSplit.fuel, homeCurrency)}</td
								>
								<td class="py-1.5 tabular-nums text-foreground">{Math.round(fuelSplitPercent)}%</td>
							</tr>
							<tr>
								<td class="py-1.5 pr-3 text-foreground">{m.understand_maintenance()}</td>
								<td class="py-1.5 pr-3 tabular-nums text-foreground"
									>{formatCurrency(homeSplit.maintenance, homeCurrency)}</td
								>
								<td class="py-1.5 tabular-nums text-foreground"
									>{Math.round(maintenanceSplitPercent)}%</td
								>
							</tr>
						</tbody>
					</table>
				{:else}
					<div role="img" aria-label={splitChartLabel} class="space-y-3">
						<div class="flex h-6 w-full overflow-hidden rounded-full bg-muted">
							{#if homeSplit.fuel > 0}
								<div
									class="h-full bg-accent"
									style={`width: ${fuelSplitPercent}%`}
									aria-hidden="true"
								></div>
							{/if}
							{#if homeSplit.maintenance > 0}
								<div
									class="h-full bg-foreground/40"
									style={`width: ${maintenanceSplitPercent}%`}
									aria-hidden="true"
								></div>
							{/if}
						</div>
						<dl class="grid grid-cols-2 gap-3">
							<div class="space-y-1">
								<dt class="flex items-center gap-2 text-xs text-muted-foreground">
									<span class="inline-block h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true"
									></span>
									{m.understand_split_legend_fuel({ percent: Math.round(fuelSplitPercent) })}
								</dt>
								<dd class="text-lg font-semibold tabular-nums text-foreground">
									{formatCurrency(homeSplit.fuel, homeCurrency)}
								</dd>
							</div>
							<div class="space-y-1">
								<dt class="flex items-center gap-2 text-xs text-muted-foreground">
									<span
										class="inline-block h-2.5 w-2.5 rounded-full bg-foreground/40"
										aria-hidden="true"
									></span>
									{m.understand_split_legend_maintenance({
										percent: Math.round(maintenanceSplitPercent)
									})}
								</dt>
								<dd class="text-lg font-semibold tabular-nums text-foreground">
									{formatCurrency(homeSplit.maintenance, homeCurrency)}
								</dd>
							</div>
						</dl>
					</div>
				{/if}
			</section>
		{/if}
	</div>
</div>
