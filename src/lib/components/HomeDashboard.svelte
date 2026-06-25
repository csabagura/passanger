<script lang="ts">
	import { onDestroy } from 'svelte';
	import { createLiveQuery } from '$lib/state/liveQuery.svelte';
	import { getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
	import { getAllExpenses } from '$lib/db/repositories/expenses';
	import UpNextCard from '$lib/components/UpNextCard.svelte';
	import HeroMetric from '$lib/components/HeroMetric.svelte';
	import InsightLine from '$lib/components/InsightLine.svelte';
	import HomeSkeleton from '$lib/components/HomeSkeleton.svelte';
	import { recency } from '$lib/utils/metrics/recency';
	import { m } from '$lib/paraglide/messages';
	import type { FuelLog, Expense } from '$lib/db/schema';

	interface Props {
		// A FIXED active-vehicle id for this component's lifetime. Home wraps <HomeDashboard> in a
		// `{#key activeVehicleId}` block, so a vehicle switch tears this instance down (onDestroy →
		// liveQuery.destroy) and mounts a fresh one — the Story-3.3 "re-subscribe on vehicle switch"
		// contract, without creating $state inside an $effect.
		vehicleId: number;
		vehicleName: string;
	}

	let { vehicleId, vehicleName }: Props = $props();

	// HomeDashboard no longer reads currency/unit or computes the cost figure directly — Story 3.4
	// moved the Hero Metric (cost ↔ consumption toggle + remembered choice) into <HeroMetric>, which
	// reads the 'settings' context itself and is fed the already-loaded `fuelLogs` below.

	// AD-4 reactive reads: a new Capture (fuel OR expense) for this vehicle re-emits here without a
	// reload. `initial = undefined` distinguishes "not loaded yet" (→ skeleton) from "loaded empty"
	// (→ next-action states). Reads go through repositories inside queryFn (Dexie-isolation contract).
	const fuelQuery = createLiveQuery<FuelLog[]>(
		() => getAllFuelLogs(vehicleId).then((r) => r.data ?? []),
		undefined
	);
	const expenseQuery = createLiveQuery<Expense[]>(
		() => getAllExpenses(vehicleId).then((r) => r.data ?? []),
		undefined
	);

	// Teardown contract: release both Dexie subscriptions when this keyed instance is destroyed.
	onDestroy(() => {
		fuelQuery.destroy();
		expenseQuery.destroy();
	});

	// Skeleton until BOTH seeds resolve, so no glance block renders against a half-loaded picture.
	const loading = $derived(fuelQuery.current === undefined || expenseQuery.current === undefined);

	const fuelLogs = $derived(fuelQuery.current ?? []);
	const expenses = $derived(expenseQuery.current ?? []);
	const fuelCount = $derived(fuelLogs.length);
	const expenseCount = $derived(expenses.length);

	// Summary line — a basic glance sentence (OQ-1: NOT the Story-4.3 plain-language Insight). Reflects
	// both fuel and expense counts so either Capture type updates it live.
	// i18n (6.1): the #1 concatenation trap. Each count is its OWN plural message (HU keeps the noun
	// singular after a numeral), and the full sentence is ONE template per shape — the plural noun
	// phrases are passed as params so Hungarian word order can differ. No translated fragment is glued.
	const summaryLine = $derived.by(() => {
		if (fuelCount === 0 && expenseCount === 0) {
			return m.home_summary_empty({ vehicleName });
		}
		const fuelPart = m.home_fillups_count({ count: fuelCount });
		if (expenseCount === 0) {
			return m.home_tracking_fuel({ fuelPart, vehicleName });
		}
		const expensePart = m.home_expenses_count({ count: expenseCount });
		return m.home_tracking_fuel_expense({ fuelPart, expensePart, vehicleName });
	});

	// Last-fill recency (AC-6) — the newest fuel-log date rendered via the FR-19 recency helper
	// (Story 4.1). String output is byte-identical to the inline version this replaces.
	const lastFillDate = $derived.by(() => {
		if (fuelLogs.length === 0) return null;
		return fuelLogs.reduce(
			(latest, log) => (log.date.getTime() > latest.getTime() ? log.date : latest),
			fuelLogs[0].date
		);
	});

	const recencyText = $derived(
		lastFillDate ? m.home_last_fillup({ recency: recency(lastFillDate) }) : null
	);
</script>

{#if loading}
	<HomeSkeleton />
{:else}
	<div class="space-y-4 px-4 pt-4">
		<!-- Summary line (priority 1) -->
		<p class="text-base text-foreground">{summaryLine}</p>

		<!-- Plain-language Insight (Story 4.3 / FR-11) — the single most-significant insight, above the
		     Hero Metric (UX order Insight → Hero → Up-Next). Reads the 'settings' context itself; fed the
		     already-loaded fuel + expense logs. Renders nothing in cold-start/insufficient states. -->
		<InsightLine {fuelLogs} {expenses} />

		<!-- Hero Metric (priority 2) — Story 3.4: the tap-to-toggle Cost-per-Distance ↔ Consumption
		     `stat`. Reads the 'settings' context itself; fed the already-loaded fuelLogs. -->
		<HeroMetric {fuelLogs} />

		<!-- Up-Next slot (priority 3) — Story 3.5's rich card: the single most-urgent reminder with a
		     status accent bar, "Log this service", and a dismiss control. Stays calm/hidden when none
		     are due. Fed the already-loaded fuelLogs so a same-tab fuel Capture re-derives the current
		     odometer (and any newly-due km reminder) without a refresh signal. -->
		<UpNextCard {vehicleId} {fuelLogs} />

		<!-- Last-fill recency (may sit below the fold) -->
		{#if recencyText}
			<p class="text-sm text-muted-foreground">{recencyText}</p>
		{/if}
	</div>
{/if}
