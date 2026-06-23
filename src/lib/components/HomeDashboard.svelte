<script lang="ts">
	import { onDestroy } from 'svelte';
	import { createLiveQuery } from '$lib/state/liveQuery.svelte';
	import { getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
	import { getAllExpenses } from '$lib/db/repositories/expenses';
	import RemindersDueCard from '$lib/components/RemindersDueCard.svelte';
	import HeroMetric from '$lib/components/HeroMetric.svelte';
	import HomeSkeleton from '$lib/components/HomeSkeleton.svelte';
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
	const summaryLine = $derived.by(() => {
		if (fuelCount === 0 && expenseCount === 0) {
			return `No entries yet for ${vehicleName} — tap the + to log your first.`;
		}
		const fuelPart = `${fuelCount} fill-up${fuelCount === 1 ? '' : 's'}`;
		if (expenseCount === 0) {
			return `Tracking ${fuelPart} for ${vehicleName}.`;
		}
		const expensePart = `${expenseCount} expense${expenseCount === 1 ? '' : 's'}`;
		return `Tracking ${fuelPart} · ${expensePart} for ${vehicleName}.`;
	});

	// Last-fill recency (AC-6) — a small local Intl relative-time over the newest fuel-log date. This is
	// intentionally tiny and replaceable: the formal recency helper (FR-19) arrives in Story 4.1.
	const lastFillDate = $derived.by(() => {
		if (fuelLogs.length === 0) return null;
		return fuelLogs.reduce(
			(latest, log) => (log.date.getTime() > latest.getTime() ? log.date : latest),
			fuelLogs[0].date
		);
	});

	const recencyText = $derived.by(() => {
		if (!lastFillDate) return null;
		const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
		// Whole-day delta between local calendar dates: each date's LOCAL year/month/day is fed into
		// Date.UTC, so both operands share one UTC frame and the timezone offset cancels in the
		// subtraction — "today / yesterday / N days ago" stays stable across the day (no Date mutation).
		const now = new Date();
		const todayMidnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
		const fillMidnight = Date.UTC(
			lastFillDate.getFullYear(),
			lastFillDate.getMonth(),
			lastFillDate.getDate()
		);
		const dayMs = 24 * 60 * 60 * 1000;
		const diffDays = Math.round((fillMidnight - todayMidnight) / dayMs);
		return `Last fill-up: ${rtf.format(diffDays, 'day')}`;
	});
</script>

{#if loading}
	<HomeSkeleton />
{:else}
	<div class="space-y-4 px-4 pt-4">
		<!-- Summary line (priority 1) -->
		<p class="text-base text-foreground">{summaryLine}</p>

		<!-- Hero Metric (priority 2) — Story 3.4: the tap-to-toggle Cost-per-Distance ↔ Consumption
		     `stat`. Reads the 'settings' context itself; fed the already-loaded fuelLogs. -->
		<HeroMetric {fuelLogs} />

		<!-- Up-Next slot (priority 3) — the existing RemindersDueCard stands in until the rich card
		     (status bar + "Log this service") lands in Story 3.5. Stays calm/hidden when none are due.
		     refreshSignal = fuelCount so a same-tab fuel Capture re-evaluates km-based reminders. -->
		<RemindersDueCard {vehicleId} refreshSignal={fuelCount} />

		<!-- Last-fill recency (may sit below the fold) -->
		{#if recencyText}
			<p class="text-sm text-muted-foreground">{recencyText}</p>
		{/if}
	</div>
{/if}
