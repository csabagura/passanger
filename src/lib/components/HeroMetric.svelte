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
	import {
		DEFAULT_HERO_METRIC,
		TREND_FLAT_BAND_PCT,
		type HeroMetric as HeroMetricChoice
	} from '$lib/config';
	import {
		consumptionDelta,
		costPerDistanceDelta,
		type PeriodDelta
	} from '$lib/utils/metrics/periodDelta';
	import type { FuelLog } from '$lib/db/schema';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		// Already-loaded fuel logs for the active vehicle. HomeDashboard owns the liveQuery and only
		// renders this once data has resolved, so HeroMetric stays a pure presentational + toggle
		// component with no Dexie read of its own (Dexie-isolation contract).
		fuelLogs: FuelLog[];
		// Injectable reference date for the month-over-month trend (Story 4.2). Absent in production
		// (HomeDashboard passes nothing) → the engine reads the real clock; tests pin a fixed Date so
		// the month-boundary comparison is deterministic. Mirrors serviceReminder's injectable `today`.
		now?: Date;
	}

	let { fuelLogs, now }: Props = $props();

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

	// Month-over-month trend for the ACTIVE metric (Story 4.2). NOTE: the big value above is an
	// ALL-TIME aggregate; the trend is THIS calendar month vs LAST (DEC-9) — different windows by
	// design. A vehicle can have a falling all-time average yet a ▲ this month. Do not "fix" this.
	// Cost is per-currency: take the home-currency bucket only (the non-home asymmetry is the accepted
	// Story-3.3 → Epic-5/FR-15 defer — do not fall back to a non-home bucket to find a trend).
	const activeTrend = $derived<PeriodDelta | null>(
		activeMetric === 'consumption'
			? consumptionDelta(fuelLogs, fuelUnit, now)
			: (costPerDistanceDelta(fuelLogs, homeCurrency, fuelUnit, now)[homeCurrency] ?? null)
	);

	// Apply the presentation flat band (config) → a single display direction, or null when there is no
	// usable trend (insufficient baseline / absent home-currency bucket). The engine only returns
	// 'flat' on an exact 0 (floats never hit), so the band is what makes ▬ reachable.
	const trendDirection = $derived<'up' | 'down' | 'flat' | null>(
		activeTrend?.status === 'ok'
			? Math.abs(activeTrend.percentChange) < TREND_FLAT_BAND_PCT
				? 'flat'
				: activeTrend.direction
			: null
	);

	// Glyph + colour for each direction. NON-ALARMIST (DEC-13): ▲ up = brand blue (text-primary, the
	// one DESIGN.md-sanctioned trend-up colour); ▼ down / ▬ flat = muted. NO success/destructive
	// green-red — rising cost is shown calmly, not as a warning. Glyph-only (AC7); no percent/sentence.
	const TREND_PRESENTATION: Record<'up' | 'down' | 'flat', { glyph: string; colorClass: string }> =
		{
			up: { glyph: '▲', colorClass: 'text-primary' },
			down: { glyph: '▼', colorClass: 'text-muted-foreground' },
			flat: { glyph: '▬', colorClass: 'text-muted-foreground' }
		};

	// Spoken direction clause for the accessible name (ok-state only; empty when no usable trend).
	const trendSpeech = $derived(
		trendDirection
			? `, ${{ up: m.hero_trend_up(), down: m.hero_trend_down(), flat: m.hero_trend_flat() }[trendDirection]}`
			: ''
	);

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
		cost: m.hero_label_cost({ unit: distanceUnit }),
		consumption: m.hero_label_consumption()
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
					fuelCount === 0 ? m.hero_next_consumption_first() : m.hero_next_consumption_more()
			};
		}

		// Cost (default) — strings preserved verbatim from the Story-3.3 base cost stat.
		return {
			heading: metricLabels.cost,
			value: costEntry ? formatCurrency(costEntry.costPerDistance, homeCurrency) : null,
			unitSuffix: costEntry ? `/ ${costEntry.distanceUnit}` : null,
			nextAction:
				fuelCount === 0
					? m.hero_next_cost_first({ unit: distanceUnit })
					: m.hero_next_cost_more({ unit: distanceUnit })
		};
	});

	// Accessible name: announces the current metric + its value (or next-action) AND that activating
	// switches to the other metric. The button stays focused across a toggle, but a focused element's
	// aria-label change is not reliably re-announced, so the transient aria-live region below carries
	// the change announcement.
	const valueSpeech = $derived(
		view.value !== null
			? `${view.value}${view.unitSuffix ? ` ${view.unitSuffix}` : ''}`
			: view.nextAction
	);
	// Strip a trailing period from valueSpeech before appending the toggle hint: the value state
	// ("€0.12 / km") has none, but the insufficient-data state ends in a full sentence ("…cost per
	// km.") — without this the name would read "…cost per km.. Tap to switch…" (double period).
	// i18n (6.1): composed accessible name as ONE template — heading / value-or-next-action / trend
	// clause / other-metric label are all passed as params so Hungarian controls word order. The
	// trailing-period strip on the value state stays (the value form has no period; the next-action
	// form ends in one) so the template's own ". Tap to switch…" never double-periods.
	const accessibleName = $derived(
		m.hero_accessible_name({
			heading: view.heading,
			value: valueSpeech.replace(/\.$/, ''),
			trend: trendSpeech,
			otherLabel: metricLabels[otherMetric]
		})
	);

	// A muted "log more to see a trend" hint shows ONLY when a metric value is present but there is no
	// usable trend yet (no prior month). With no value at all, `nextAction` already covers the empty
	// state, so no hint (3.4 AC6 calm-empty contract holds — the chip slot also stays glyph-free).
	const showTrendHint = $derived(view.value !== null && trendDirection === null);

	// Transient polite announcement: EMPTY on initial render (so the default view collides with no
	// getByText assertion and no SR speaks on load), then set only when the active metric actually
	// changes — a local toggle or a cross-tab settings sync. Value-only changes (live data) don't
	// re-announce. Reading `view` inside the effect is safe: effects run after derivations settle.
	let announcement = $state('');
	let lastAnnouncedMetric: HeroMetricChoice | null = null;

	$effect(() => {
		const metric = activeMetric;
		const speech = m.hero_announcement({
			heading: view.heading,
			value: valueSpeech,
			trend: trendSpeech
		});
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
		if (saveSettings(next).error) {
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
			<!-- Trend chip (Story 4.2): the month-over-month direction for the active metric, glyph-only
			     (AC7 — magnitude/sentence is 4.3 Insight). Keeps 3.4's reserved h-5 w-10 footprint so
			     there is zero layout shift whether or not a glyph shows; stays calm and empty (no "—")
			     when there's no usable trend. aria-hidden — direction reaches SRs via the button name. -->
			<span
				aria-hidden="true"
				class="flex h-5 w-10 shrink-0 items-center justify-end text-base leading-none"
			>
				{#if trendDirection}
					<span class={TREND_PRESENTATION[trendDirection].colorClass}
						>{TREND_PRESENTATION[trendDirection].glyph}</span
					>
				{/if}
			</span>
		</span>
		{#if view.value !== null}
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
		{#if showTrendHint}
			<!-- Calm nudge when a value exists but there's no prior month to trend against (EXPERIENCE.md:79).
			     aria-hidden — the authoritative button aria-label already conveys the state, so no double
			     announcement; the chip slot above stays glyph-free in this case (AC5). -->
			<span aria-hidden="true" class="text-xs text-muted-foreground">{m.hero_trend_hint()}</span>
		{/if}
	</button>
	<!-- Transient change announcement for SRs (empty until the metric actually changes). -->
	<span class="sr-only" role="status" aria-live="polite">{announcement}</span>
</section>
