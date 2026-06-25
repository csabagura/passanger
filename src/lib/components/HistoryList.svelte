<script lang="ts">
	import { resolve } from '$app/paths';
	import type { FuelUnit } from '$lib/config';
	import EntryCard from '$lib/components/EntryCard.svelte';
	import {
		getHistoryEntryKey,
		summarizeSpendByCurrency,
		type HistoryMonthGroup,
		type HistoryEntry
	} from '$lib/utils/historyEntries';
	import { formatCurrency } from '$lib/utils/calculations';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		monthGroups: HistoryMonthGroup[];
		currency: string;
		preferredFuelUnit?: FuelUnit;
		vehicleName?: string;
		hasVehicles?: boolean;
		editDisabled?: boolean;
		detailDisabled?: boolean;
		onOpenDetail?: (request: HistoryEntry) => void;
		onEdit?: (request: HistoryEntry) => void;
		onDelete?: (request: HistoryEntry) => void;
	}

	let {
		monthGroups,
		currency,
		preferredFuelUnit = 'L/100km',
		vehicleName,
		hasVehicles = true,
		editDisabled = false,
		detailDisabled = false,
		onOpenDetail = () => {},
		onEdit = () => {},
		onDelete = () => {}
	}: Props = $props();

	let revealedEntryKey = $state<string | null>(null);

	// A month can contain entries in multiple currencies, which can't be summed without an
	// FX rate. Single-currency months render exactly as before; mixed months show each
	// currency's subtotal separately.
	function formatMonthSubtotal(group: HistoryMonthGroup): string {
		const byCurrency = Object.entries(summarizeSpendByCurrency(group.entries, currency));
		if (byCurrency.length <= 1) {
			return formatCurrency(group.subtotalCost, byCurrency[0]?.[0] ?? currency);
		}
		return byCurrency.map(([cur, amount]) => formatCurrency(amount, cur)).join(' · ');
	}
	let emptyStateLink = $state<HTMLAnchorElement | undefined>(undefined);
	let hasMounted = false;

	$effect(() => {
		if (monthGroups.length === 0) {
			if (!hasMounted) {
				emptyStateLink?.focus();
			}
			hasMounted = true;
			revealedEntryKey = null;
			return;
		}

		hasMounted = true;

		if (
			revealedEntryKey &&
			!monthGroups.some((group) =>
				group.entries.some((entry) => getHistoryEntryKey(entry) === revealedEntryKey)
			)
		) {
			revealedEntryKey = null;
		}
	});

	function handleActionRevealChange(entryKey: string, nextRevealed: boolean): void {
		revealedEntryKey = nextRevealed
			? entryKey
			: revealedEntryKey === entryKey
				? null
				: revealedEntryKey;
	}

	function handleDetailOpen(request: HistoryEntry): void {
		revealedEntryKey = null;
		onOpenDetail(request);
	}
</script>

{#if monthGroups.length === 0}
	<div
		role="region"
		aria-labelledby="history-empty-state-title"
		aria-describedby="history-empty-state-description"
		class="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center"
	>
		<p id="history-empty-state-title" class="text-base font-semibold text-foreground">
			{#if !hasVehicles}
				{m.history_empty_no_vehicles_title()}
			{:else if vehicleName}
				{m.history_empty_vehicle_title({ vehicleName })}
			{:else}
				{m.history_empty_generic_title()}
			{/if}
		</p>
		<p id="history-empty-state-description" class="mt-1 text-sm text-muted-foreground">
			{#if !hasVehicles}
				{m.history_empty_no_vehicles_description()}
			{:else if vehicleName}
				{m.history_empty_vehicle_description({ vehicleName })}
			{:else}
				{m.history_empty_generic_description()}
			{/if}
		</p>
		<a
			bind:this={emptyStateLink}
			data-history-empty-state-cta="true"
			href={resolve(!hasVehicles ? '/settings' : '/fuel-entry')}
			class="mt-4 inline-flex rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
		>
			{!hasVehicles ? m.history_empty_go_to_settings() : m.history_empty_go_to_fuel()}
		</a>
	</div>
{:else}
	<div class="space-y-6">
		{#each monthGroups as group (group.key)}
			<section aria-labelledby={`history-month-group-${group.key}`} class="space-y-3">
				<div class="flex items-center justify-between border-b border-border/80 pb-2">
					<h2
						id={`history-month-group-${group.key}`}
						class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
					>
						{group.label}
					</h2>
					<p class="text-sm font-semibold tabular-nums text-foreground">
						{formatMonthSubtotal(group)}
					</p>
				</div>

				<ul aria-label={m.history_entries_for_month_aria({ month: group.label })} class="space-y-3">
					{#each group.entries as item (getHistoryEntryKey(item))}
						<li>
							<EntryCard
								kind={item.kind}
								entry={item.entry}
								entryKey={getHistoryEntryKey(item)}
								{currency}
								{preferredFuelUnit}
								presentation="history"
								actionPresentation="swipe"
								actionsRevealed={revealedEntryKey === getHistoryEntryKey(item)}
								onActionRevealChange={(revealed) =>
									handleActionRevealChange(getHistoryEntryKey(item), revealed)}
								{editDisabled}
								{detailDisabled}
								onOpenDetail={(req) => handleDetailOpen(req)}
								onEdit={(req) => onEdit(req)}
								onDelete={(req) => onDelete(req)}
							/>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
{/if}
