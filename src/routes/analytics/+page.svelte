<script lang="ts">
	import { resolve } from '$app/paths';
	import { getContext } from 'svelte';
	import { getAllExpenses } from '$lib/db/repositories/expenses';
	import { getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
	import { formatConsumption, formatCurrency } from '$lib/utils/calculations';
	import { getVolumeUnitForFuelUnit } from '$lib/utils/calculations';
	import {
		mergeHistoryEntries,
		summarizeSpendByCurrency,
		type HistoryEntry
	} from '$lib/utils/historyEntries';
	import {
		consumptionTrend,
		fuelVsMaintenanceSplit,
		monthlySpendByCurrency
	} from '$lib/utils/analytics';
	import type { AppSettings } from '$lib/utils/settings';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';

	const LOADING_INDICATOR_DELAY_MS = 300;
	// viewBox geometry — charts scale responsively via width:100% on the <svg>.
	const CHART_WIDTH = 320;
	const BAR_CHART_HEIGHT = 180;
	const LINE_CHART_HEIGHT = 180;
	const CHART_PADDING_X = 8;
	const CHART_TOP = 12;
	const CHART_BOTTOM = 28; // room for x-axis labels

	const vehiclesCtx = getContext<VehiclesContext>('vehicles');
	const settingsCtx = getContext<{ settings: AppSettings }>('settings');
	const tabSyncCtx = getContext<{ dataRevision: number } | undefined>('tabSync');

	let currentVehicle = $derived(vehiclesCtx.activeVehicle);
	let historyEntries = $state<HistoryEntry[]>([]);
	let loading = $state(true);
	let showLoadingState = $state(false);
	let dbError = $state(false);
	let loadingIndicatorTimeout: ReturnType<typeof setTimeout> | null = null;
	let destroyed = false;

	const homeCurrency = $derived(settingsCtx.settings.currency);
	const preferredFuelUnit = $derived(settingsCtx.settings.fuelUnit);
	const consumptionUnit = $derived(getVolumeUnitForFuelUnit(preferredFuelUnit));

	const hasData = $derived(historyEntries.length > 0);

	// --- Monthly spend (home currency series rendered; other currencies summarized) ---
	const monthlyBuckets = $derived(monthlySpendByCurrency(historyEntries, homeCurrency));
	const monthlyHomeSeries = $derived(
		monthlyBuckets.map((bucket) => ({
			monthKey: bucket.monthKey,
			label: bucket.label,
			value: bucket.byCurrency[homeCurrency] ?? 0
		}))
	);
	const maxMonthlySpend = $derived(
		monthlyHomeSeries.reduce((max, point) => Math.max(max, point.value), 0)
	);
	const hasMonthlyHomeSpend = $derived(maxMonthlySpend > 0);

	// --- Consumption trend ---
	const trendPoints = $derived(
		consumptionTrend(historyEntries.flatMap(toFuelLog), preferredFuelUnit)
	);
	const maxConsumption = $derived(
		trendPoints.reduce((max, point) => Math.max(max, point.consumption), 0)
	);
	const minConsumption = $derived(
		trendPoints.reduce(
			(min, point) => Math.min(min, point.consumption),
			trendPoints[0]?.consumption ?? 0
		)
	);

	// --- Fuel vs maintenance split ---
	const splitByCurrency = $derived(fuelVsMaintenanceSplit(historyEntries, homeCurrency));
	const homeSplit = $derived(splitByCurrency[homeCurrency] ?? { fuel: 0, maintenance: 0 });
	const homeSplitTotal = $derived(homeSplit.fuel + homeSplit.maintenance);
	const fuelSplitPercent = $derived(
		homeSplitTotal > 0 ? (homeSplit.fuel / homeSplitTotal) * 100 : 0
	);
	const maintenanceSplitPercent = $derived(
		homeSplitTotal > 0 ? (homeSplit.maintenance / homeSplitTotal) * 100 : 0
	);

	// --- Other-currency note (totals we can't merge into the home-currency charts) ---
	const spendByCurrency = $derived(summarizeSpendByCurrency(historyEntries, homeCurrency));
	const otherCurrencyTotals = $derived(
		Object.entries(spendByCurrency)
			.filter(([currency]) => currency !== homeCurrency)
			.sort(([, left], [, right]) => right - left)
	);
	const hasOtherCurrencies = $derived(otherCurrencyTotals.length > 0);

	function toFuelLog(entry: HistoryEntry) {
		return entry.kind === 'fuel' ? [entry.entry] : [];
	}

	function barChartX(index: number, count: number): { x: number; width: number } {
		const innerWidth = CHART_WIDTH - CHART_PADDING_X * 2;
		const slot = innerWidth / Math.max(count, 1);
		const width = Math.max(slot * 0.6, 1);
		const x = CHART_PADDING_X + slot * index + (slot - width) / 2;
		return { x, width };
	}

	function barChartY(value: number): { y: number; height: number } {
		const innerHeight = BAR_CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
		const ratio = maxMonthlySpend > 0 ? value / maxMonthlySpend : 0;
		const height = Math.max(ratio * innerHeight, value > 0 ? 2 : 0);
		const y = CHART_TOP + (innerHeight - height);
		return { y, height };
	}

	function trendPointCoordinate(index: number, value: number): { x: number; y: number } {
		const innerWidth = CHART_WIDTH - CHART_PADDING_X * 2;
		const innerHeight = LINE_CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
		const count = trendPoints.length;
		const x = count > 1 ? CHART_PADDING_X + (innerWidth * index) / (count - 1) : CHART_WIDTH / 2;
		const span = maxConsumption - minConsumption;
		const ratio = span > 0 ? (value - minConsumption) / span : 0.5;
		const y = CHART_TOP + (innerHeight - ratio * innerHeight);
		return { x, y };
	}

	const trendLinePath = $derived.by(() => {
		if (trendPoints.length === 0) {
			return '';
		}
		return trendPoints
			.map((point, index) => {
				const { x, y } = trendPointCoordinate(index, point.consumption);
				return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
			})
			.join(' ');
	});

	const trendAreaPath = $derived.by(() => {
		if (trendPoints.length === 0) {
			return '';
		}
		const baseline = LINE_CHART_HEIGHT - CHART_BOTTOM;
		const first = trendPointCoordinate(0, trendPoints[0].consumption);
		const last = trendPointCoordinate(
			trendPoints.length - 1,
			trendPoints[trendPoints.length - 1].consumption
		);
		return `${trendLinePath} L${last.x.toFixed(2)} ${baseline} L${first.x.toFixed(2)} ${baseline} Z`;
	});

	function formatTrendValue(value: number): string {
		return formatConsumption(value, consumptionUnit);
	}

	const monthlyChartLabel = $derived.by(() => {
		if (!hasMonthlyHomeSpend) {
			return 'Monthly spend chart with no data in your home currency.';
		}
		const parts = monthlyHomeSeries
			.filter((point) => point.value > 0)
			.map((point) => `${point.label}: ${formatCurrency(point.value, homeCurrency)}`);
		return `Monthly spend in ${homeCurrency}. ${parts.join('. ')}.`;
	});

	const trendChartLabel = $derived.by(() => {
		if (trendPoints.length === 0) {
			return 'Fuel consumption trend with no data.';
		}
		const parts = trendPoints.map(
			(point) => `${point.label}: ${formatTrendValue(point.consumption)}`
		);
		return `Fuel consumption trend over ${trendPoints.length} fill-ups. ${parts.join('. ')}.`;
	});

	const splitChartLabel = $derived.by(() => {
		if (homeSplitTotal <= 0) {
			return 'Fuel versus maintenance split with no data in your home currency.';
		}
		return (
			`Spending split in ${homeCurrency}. ` +
			`Fuel: ${formatCurrency(homeSplit.fuel, homeCurrency)} (${Math.round(fuelSplitPercent)}%). ` +
			`Maintenance: ${formatCurrency(homeSplit.maintenance, homeCurrency)} (${Math.round(maintenanceSplitPercent)}%).`
		);
	});

	function clearLoadingIndicatorTimeout(): void {
		if (loadingIndicatorTimeout) {
			clearTimeout(loadingIndicatorTimeout);
			loadingIndicatorTimeout = null;
		}
	}

	async function loadEntriesForVehicle(vehicleId: number): Promise<void> {
		dbError = false;
		loading = true;
		showLoadingState = false;
		clearLoadingIndicatorTimeout();
		loadingIndicatorTimeout = setTimeout(() => {
			if (!destroyed && loading) {
				showLoadingState = true;
			}
		}, LOADING_INDICATOR_DELAY_MS);

		try {
			const [fuelResult, expenseResult] = await Promise.all([
				getAllFuelLogs(vehicleId),
				getAllExpenses(vehicleId)
			]);
			if (destroyed) {
				return;
			}

			if (fuelResult.error || expenseResult.error) {
				dbError = true;
				historyEntries = [];
				return;
			}

			historyEntries = mergeHistoryEntries(fuelResult.data ?? [], expenseResult.data ?? []);
		} catch {
			if (!destroyed) {
				dbError = true;
				historyEntries = [];
			}
		} finally {
			clearLoadingIndicatorTimeout();
			if (!destroyed) {
				loading = false;
				showLoadingState = false;
			}
		}
	}

	$effect(() => {
		const vehicleId = vehiclesCtx.activeVehicle?.id;
		// Reactive dep: a write in another tab bumps dataRevision → re-run this load (multi-tab safety).
		const revision = tabSyncCtx?.dataRevision ?? 0;
		if (vehicleId && revision >= 0) {
			void loadEntriesForVehicle(vehicleId);
		} else {
			historyEntries = [];
			loading = false;
		}
	});

	$effect(() => {
		return () => {
			destroyed = true;
			clearLoadingIndicatorTimeout();
		};
	});
</script>

<svelte:head>
	<title>Analytics | passanger</title>
</svelte:head>

<div class="px-4 pt-4">
	<div class="space-y-6">
		<header class="space-y-1">
			<h1 class="text-xl font-semibold text-foreground">Analytics</h1>
			{#if currentVehicle}
				<p class="text-sm text-muted-foreground">
					{currentVehicle.name} · {currentVehicle.make}
					{currentVehicle.model}
					{#if currentVehicle.year}
						· {currentVehicle.year}
					{/if}
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					Spot trends in your fuel and maintenance spending over time.
				</p>
			{/if}
		</header>

		{#if !currentVehicle}
			<div
				role="region"
				aria-label="No vehicle selected"
				class="rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center"
			>
				<p class="text-base font-semibold text-foreground">No vehicle yet</p>
				<p class="mt-1 text-sm text-muted-foreground">
					Add a vehicle to start tracking fuel and maintenance, and your analytics will appear here.
				</p>
				<a
					href={resolve('/log')}
					class="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
				>
					Add a vehicle
				</a>
			</div>
		{:else if dbError}
			<div
				role="alert"
				class="flex min-h-[50vh] flex-col items-center justify-center gap-6 p-8 text-center"
			>
				<div class="flex flex-col items-center gap-2">
					<p class="text-lg font-semibold text-foreground">Could not load your analytics</p>
					<p class="text-sm text-muted-foreground">
						There was a problem reaching the database. Please restart the app to try again.
					</p>
					<p class="text-sm text-muted-foreground">
						If the problem persists, export your data before clearing app storage.
					</p>
				</div>
				<a
					href={resolve('/export')}
					class="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
				>
					Export My Data
				</a>
			</div>
		{:else if loading && showLoadingState}
			<div
				role="status"
				aria-live="polite"
				class="rounded-2xl border border-border bg-card px-4 py-6 text-center"
			>
				<p class="text-sm text-muted-foreground">Loading analytics...</p>
			</div>
		{:else if !loading}
			{#if !hasData}
				<div
					role="region"
					aria-label="No data yet"
					class="rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center"
				>
					<p class="text-base font-semibold text-foreground">Nothing to chart yet</p>
					<p class="mt-1 text-sm text-muted-foreground">
						Log a few fill-ups and expenses and your spending and consumption trends will show up
						here.
					</p>
					<a
						href={resolve('/log')}
						class="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
					>
						Add an entry
					</a>
				</div>
			{:else}
				{#if hasOtherCurrencies}
					<p
						class="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground"
					>
						Charts show amounts in your home currency ({homeCurrency}). Other currencies aren't
						converted (no exchange rate offline) — their totals are:
						<span class="font-medium text-foreground">
							{otherCurrencyTotals
								.map(([currency, amount]) => formatCurrency(amount, currency))
								.join(' · ')}</span
						>.
					</p>
				{/if}

				<!-- Monthly spend -->
				<section
					aria-labelledby="analytics-monthly-title"
					class="space-y-3 rounded-3xl border border-border bg-card p-4 shadow-sm"
				>
					<div class="space-y-1">
						<h2 id="analytics-monthly-title" class="text-base font-semibold text-foreground">
							Monthly spend
						</h2>
						<p class="text-xs text-muted-foreground">Total per month in {homeCurrency}</p>
					</div>

					{#if hasMonthlyHomeSpend}
						<svg
							viewBox={`0 0 ${CHART_WIDTH} ${BAR_CHART_HEIGHT}`}
							preserveAspectRatio="none"
							class="h-44 w-full"
							role="img"
							aria-label={monthlyChartLabel}
						>
							<line
								x1={CHART_PADDING_X}
								y1={BAR_CHART_HEIGHT - CHART_BOTTOM}
								x2={CHART_WIDTH - CHART_PADDING_X}
								y2={BAR_CHART_HEIGHT - CHART_BOTTOM}
								class="stroke-border"
								stroke-width="1"
							/>
							{#each monthlyHomeSeries as point, index (point.monthKey)}
								{@const bar = barChartX(index, monthlyHomeSeries.length)}
								{@const vertical = barChartY(point.value)}
								<rect
									x={bar.x}
									y={vertical.y}
									width={bar.width}
									height={vertical.height}
									rx="2"
									class="fill-accent"
								/>
							{/each}
						</svg>
						<ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
							{#each monthlyHomeSeries.filter((point) => point.value > 0) as point (point.monthKey)}
								<li>
									<span class="text-foreground">{point.label}</span>:
									<span class="tabular-nums">{formatCurrency(point.value, homeCurrency)}</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="py-6 text-center text-sm text-muted-foreground">
							No spending recorded in {homeCurrency} yet.
						</p>
					{/if}
				</section>

				<!-- Consumption trend -->
				<section
					aria-labelledby="analytics-consumption-title"
					class="space-y-3 rounded-3xl border border-border bg-card p-4 shadow-sm"
				>
					<div class="space-y-1">
						<h2 id="analytics-consumption-title" class="text-base font-semibold text-foreground">
							Consumption trend
						</h2>
						<p class="text-xs text-muted-foreground">
							{consumptionUnit === 'L' ? 'L/100km' : 'MPG'} per fill-up, oldest to newest
						</p>
					</div>

					{#if trendPoints.length >= 2}
						<svg
							viewBox={`0 0 ${CHART_WIDTH} ${LINE_CHART_HEIGHT}`}
							preserveAspectRatio="none"
							class="h-44 w-full"
							role="img"
							aria-label={trendChartLabel}
						>
							<path d={trendAreaPath} class="fill-accent/15" />
							<path
								d={trendLinePath}
								fill="none"
								class="stroke-accent"
								stroke-width="2"
								stroke-linejoin="round"
								stroke-linecap="round"
								vector-effect="non-scaling-stroke"
							/>
						</svg>
						<p class="text-xs text-muted-foreground">
							Best <span class="text-foreground">{formatTrendValue(minConsumption)}</span> · Worst
							<span class="text-foreground">{formatTrendValue(maxConsumption)}</span>
						</p>
					{:else if trendPoints.length === 1}
						<div
							role="img"
							aria-label={trendChartLabel}
							class="rounded-2xl bg-muted/40 px-4 py-6 text-center"
						>
							<p class="text-2xl font-bold tabular-nums text-foreground">
								{formatTrendValue(trendPoints[0].consumption)}
							</p>
							<p class="mt-1 text-xs text-muted-foreground">
								One fill-up so far. Add more to see a trend.
							</p>
						</div>
					{:else}
						<p class="py-6 text-center text-sm text-muted-foreground">
							No consumption data yet. Add a second fill-up to start the trend.
						</p>
					{/if}
				</section>

				<!-- Fuel vs maintenance split -->
				<section
					aria-labelledby="analytics-split-title"
					class="space-y-3 rounded-3xl border border-border bg-card p-4 shadow-sm"
				>
					<div class="space-y-1">
						<h2 id="analytics-split-title" class="text-base font-semibold text-foreground">
							Fuel vs maintenance
						</h2>
						<p class="text-xs text-muted-foreground">Share of spend in {homeCurrency}</p>
					</div>

					{#if homeSplitTotal > 0}
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
										Fuel ({Math.round(fuelSplitPercent)}%)
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
										Maintenance ({Math.round(maintenanceSplitPercent)}%)
									</dt>
									<dd class="text-lg font-semibold tabular-nums text-foreground">
										{formatCurrency(homeSplit.maintenance, homeCurrency)}
									</dd>
								</div>
							</dl>
						</div>
					{:else}
						<p class="py-6 text-center text-sm text-muted-foreground">
							No spending recorded in {homeCurrency} yet.
						</p>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
</div>
