<script lang="ts">
	import { getContext } from 'svelte';
	import { getInsights } from '$lib/utils/metrics/insight';
	import type { AppSettings } from '$lib/utils/settings';
	import type { Expense, FuelLog } from '$lib/db/schema';

	interface Props {
		// Already-loaded fuel logs + expenses for the active vehicle. HomeDashboard owns the liveQuery
		// and only renders this once data resolves, so InsightLine stays a pure presentational read with
		// no Dexie access of its own (Dexie-isolation contract).
		fuelLogs: FuelLog[];
		expenses: Expense[];
		// Injectable reference date for the month-over-month / trailing-window detections (mirrors
		// HeroMetric). Absent in production (HomeDashboard passes nothing) → the engine reads the real
		// clock; tests pin a fixed Date so the comparison is deterministic.
		now?: Date;
	}

	let { fuelLogs, expenses, now }: Props = $props();

	// Read the 'settings' context itself (HomeDashboard does not read settings — mirror HeroMetric)
	// for the home currency + preferred fuel unit the per-currency detections need.
	const settingsCtx = getContext<{ settings: AppSettings }>('settings');
	const homeCurrency = $derived(settingsCtx.settings.currency);
	const fuelUnit = $derived(settingsCtx.settings.fuelUnit);

	// The engine owns ALL phrasing (AC7): render `insights[0].text` verbatim, never re-derive here.
	const insights = $derived(getInsights(fuelLogs, expenses, { homeCurrency, fuelUnit, now }));
</script>

<!-- Plain-language Insight (Story 4.3 / FR-11): the SINGLE most-significant insight, above the Hero
     Metric. Non-interactive readable text (unlike the Hero <button>) — its real text content is read
     by screen readers on navigation. Renders nothing in cold-start/insufficient states (HeroMetric
     already shows the "add a couple more fill-ups" / "Log your first fill-up" copy — no duplication). -->
{#if insights.length}
	<p class="text-base text-foreground">{insights[0].text}</p>
{/if}
