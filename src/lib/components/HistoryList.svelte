<script lang="ts">
	import { resolve } from '$app/paths';
	import type { FuelUnit } from '$lib/config';
	import EntryCard from '$lib/components/EntryCard.svelte';
	import {
		getHistoryEntryKey,
		type HistoryMonthGroup,
		type HistoryEntry
	} from '$lib/utils/historyEntries';
	import { formatCurrency } from '$lib/utils/calculations';

	type DeleteState = 'idle' | 'armed' | 'loading';

	interface Props {
		monthGroups: HistoryMonthGroup[];
		currency: string;
		preferredFuelUnit?: FuelUnit;
		editDisabled?: boolean;
		detailDisabled?: boolean;
		detailOpenEntryKey?: string | null;
		onOpenDetail?: (request: HistoryEntry) => void;
		onEdit?: (request: HistoryEntry) => void;
		onDeleteRequest?: (request: HistoryEntry) => void;
		onDeleteConfirm?: (request: HistoryEntry) => void;
		onDeleteCancel?: (request: HistoryEntry) => void;
		getDeleteState?: (entry: HistoryEntry) => DeleteState;
		isDeleteDisabled?: (entry: HistoryEntry) => boolean;
	}

	let {
		monthGroups,
		currency,
		preferredFuelUnit = 'L/100km',
		editDisabled = false,
		detailDisabled = false,
		detailOpenEntryKey = null,
		onOpenDetail = () => {},
		onEdit = () => {},
		onDeleteRequest = () => {},
		onDeleteConfirm = () => {},
		onDeleteCancel = () => {},
		getDeleteState = () => 'idle',
		isDeleteDisabled = () => false
	}: Props = $props();

	let revealedEntryKey = $state<string | null>(null);
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
			No entries yet - log your first fill-up!
		</p>
		<p id="history-empty-state-description" class="mt-1 text-sm text-muted-foreground">
			Your saved fuel and maintenance records will appear here in newest-first order.
		</p>
		<a
			bind:this={emptyStateLink}
			data-history-empty-state-cta="true"
			href={resolve('/fuel-entry')}
			class="mt-4 inline-flex rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
		>
			Go to Fuel
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
						{formatCurrency(group.subtotalCost, currency)}
					</p>
				</div>

				<ul aria-label={`History entries for ${group.label}`} class="space-y-3">
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
								onDeleteRequest={(req) => onDeleteRequest(req)}
								onDeleteConfirm={(req) => onDeleteConfirm(req)}
								onDeleteCancel={(req) => onDeleteCancel(req)}
								deleteState={detailOpenEntryKey === getHistoryEntryKey(item)
									? 'idle'
									: getDeleteState(item)}
								deleteDisabled={isDeleteDisabled(item)}
							/>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
{/if}
