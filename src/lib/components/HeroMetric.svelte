<script lang="ts">
	import { getContext } from 'svelte';
	import { averageConsumption, costPerDistance } from '$lib/utils/analytics';
	import {
		formatConsumption,
		formatCurrency,
		getDistanceUnitForFuelUnit,
		getVolumeUnitForFuelUnit
	} from '$lib/utils/calculations';
	import { saveSettings, type AppSettings } from '$lib/utils/settings';
	import { notifySettingsChanged } from '$lib/utils/tabSync';
	import { DEFAULT_HERO_METRIC, type HeroMetric as HeroMetricChoice } from '$lib/config';
	import type { FuelLog } from '$lib/db/schema';

	interface Props {
		// Already-loaded fuel logs for the active vehicle. HomeDashboard owns the liveQuery and only
		// renders this once data has resolved, so HeroMetric stays a pure presentational + toggle
		// component with no Dexie read of its own (Dexie-isolation contract).
		fuelLogs: FuelLog[];
	}

	let { fuelLogs }: Props = $props();

	// The provider (layout) exposes BOTH a `settings` getter and `updateSettings`; HomeDashboard only
	// typed `settings`, but the toggle needs to write back, so type both here.
	const settingsCtx = getContext<{
		settings: AppSettings;
		updateSettings: (s: AppSettings) => void;
	}>('settings');

	const homeCurrency = $derived(settingsCtx.settings.currency);
	const fuelUnit = $derived(settingsCtx.settings.fuelUnit);
	const distanceUnit = $derived(getDistanceUnitForFuelUnit(fuelUnit));
	const fuelCount = $derived(fuelLogs.length);

	// Absent/invalid → 'cost' (DEC-2; mirrors the exchangeRates? optional-field fallback in settings).
	const activeMetric = $derived<HeroMetricChoice>(
		settingsCtx.settings.heroMetric ?? DEFAULT_HERO_METRIC
	);
	const otherMetric = $derived<HeroMetricChoice>(activeMetric === 'cost' ? 'consumption' : 'cost');

	// Cost-per-Distance in the home currency — the verbatim Story-3.3 base stat. `byCurrency[home]`
	// discards non-home-currency buckets (a known Story-3.3 → Epic-5 defer; NOT fixed here).
	const costEntry = $derived(
		costPerDistance(fuelLogs, homeCurrency, fuelUnit)[homeCurrency] ?? null
	);

	// Volume-weighted overall consumption, already in the display unit (Story-3.4 analytics aggregate).
	const consumptionValue = $derived(averageConsumption(fuelLogs, fuelUnit));

	interface MetricView {
		// Visually-hidden uppercase heading copy ("Cost per km" / "Consumption").
		heading: string;
		// The big `stat`-role number when present (null → render the next-action instead).
		value: string | null;
		// Optional trailing unit shown next to a present value (cost only; consumption bakes its unit in).
		unitSuffix: string | null;
		// Graceful per-metric next-action when the value can't be derived yet.
		nextAction: string;
	}

	const metricLabels: Record<HeroMetricChoice, string> = $derived({
		cost: `Cost per ${distanceUnit}`,
		consumption: 'Consumption'
	});

	const view = $derived.by<MetricView>(() => {
		if (activeMetric === 'consumption') {
			return {
				heading: metricLabels.consumption,
				value:
					consumptionValue === null
						? null
						: formatConsumption(consumptionValue, getVolumeUnitForFuelUnit(fuelUnit)),
				unitSuffix: null,
				nextAction:
					fuelCount === 0
						? 'Log your first fill-up to see consumption.'
						: 'Log another fill-up to calculate consumption.'
			};
		}

		// Cost (default) — strings preserved verbatim from the Story-3.3 base cost stat.
		return {
			heading: metricLabels.cost,
			value: costEntry ? formatCurrency(costEntry.costPerDistance, homeCurrency) : null,
			unitSuffix: costEntry ? `/ ${costEntry.distanceUnit}` : null,
			nextAction:
				fuelCount === 0
					? `Log your first fill-up to see cost per ${distanceUnit}.`
					: `Log another fill-up to calculate cost per ${distanceUnit}.`
		};
	});

	// Accessible name: announces the current metric + its value (or next-action) AND that activating
	// switches to the other metric. The button stays focused across a toggle, but a focused element's
	// aria-label change is not reliably re-announced, so the transient aria-live region below carries
	// the change announcement.
	const valueSpeech = $derived(
		view.value ? `${view.value}${view.unitSuffix ? ` ${view.unitSuffix}` : ''}` : view.nextAction
	);
	// Strip a trailing period from valueSpeech before appending the toggle hint: the value state
	// ("€0.12 / km") has none, but the insufficient-data state ends in a full sentence ("…cost per
	// km.") — without this the name would read "…cost per km.. Tap to switch…" (double period).
	const accessibleName = $derived(
		`${view.heading}: ${valueSpeech.replace(/\.$/, '')}. Tap to switch to ${metricLabels[otherMetric]}.`
	);

	// Transient polite announcement: EMPTY on initial render (so the default view collides with no
	// getByText assertion and no SR speaks on load), then set only when the active metric actually
	// changes — a local toggle or a cross-tab settings sync. Value-only changes (live data) don't
	// re-announce. Reading `view` inside the effect is safe: effects run after derivations settle.
	let announcement = $state('');
	let lastAnnouncedMetric: HeroMetricChoice | null = null;

	$effect(() => {
		const metric = activeMetric;
		const speech = `${view.heading}: ${valueSpeech}`;
		if (lastAnnouncedMetric === null) {
			lastAnnouncedMetric = metric; // prime on mount without announcing the default
			return;
		}
		if (metric !== lastAnnouncedMetric) {
			lastAnnouncedMetric = metric;
			announcement = speech;
		}
	});

	function toggleMetric(): void {
		const next: AppSettings = { ...settingsCtx.settings, heroMetric: otherMetric };
		// Persist FIRST: if the localStorage write fails (quota/security), don't desync the in-memory
		// view from what's stored — leave the metric unchanged.
		if (!saveSettings(next)) {
			return;
		}
		settingsCtx.updateSettings(next);
		notifySettingsChanged();
	}
</script>

<!-- Hero Metric (priority 2) — `stat` role: the one big number earns the most pixels (DESIGN.md). The
     whole metric is the tap target (DEC-2 "tap toggles"): a single <button> that is keyboard-operable,
     ≥44px, with a visible focus ring and an accessible name announcing the current metric + value. -->
<section class="rounded-xl border border-border bg-card">
	<button
		type="button"
		onclick={toggleMetric}
		aria-label={accessibleName}
		class="flex w-full min-h-[44px] flex-col items-start gap-1 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
	>
		<span class="flex w-full items-start justify-between gap-2">
			<span
				aria-hidden="true"
				class="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
			>
				{view.heading}
			</span>
			<!-- Trend-chip slot (AC6): reserve the final footprint so Story 4.2's ▲/▼/▬ chip drops in with
			     no layout shift. Renders nothing in 3.4 — calm and empty, never a "—" that reads as data. -->
			<span aria-hidden="true" class="h-5 w-10 shrink-0"></span>
		</span>
		{#if view.value}
			<span
				aria-hidden="true"
				class="text-[2rem] font-semibold leading-none tabular-nums text-foreground"
			>
				{view.value}
				{#if view.unitSuffix}
					<span class="text-base font-normal text-muted-foreground">{view.unitSuffix}</span>
				{/if}
			</span>
		{:else}
			<span aria-hidden="true" class="text-sm text-muted-foreground">{view.nextAction}</span>
		{/if}
	</button>
	<!-- Transient change announcement for SRs (empty until the metric actually changes). -->
	<span class="sr-only" role="status" aria-live="polite">{announcement}</span>
</section>
