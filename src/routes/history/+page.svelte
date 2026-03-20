<script lang="ts">
	import { resolve } from '$app/paths';
	import { getContext, onDestroy, onMount, tick } from 'svelte';
	import EntryDetailSheet from '$lib/components/EntryDetailSheet.svelte';
	import FuelEntryForm from '$lib/components/FuelEntryForm.svelte';
	import HistoryList from '$lib/components/HistoryList.svelte';
	import MaintenanceForm from '$lib/components/MaintenanceForm.svelte';
	import StatBar from '$lib/components/StatBar.svelte';
	import { deleteExpense, getAllExpenses } from '$lib/db/repositories/expenses';
	import { deleteFuelLog, getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
	import type { Expense, FuelLog, Vehicle } from '$lib/db/schema';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';
	import {
		compareHistoryEntriesNewestFirst,
		filterHistoryEntries,
		getHistoryEntryKey,
		groupHistoryEntriesByMonth,
		historyTimePeriodOptions,
		mergeHistoryEntries,
		summarizeHistoryEntriesForTimePeriod,
		type HistoryEntry,
		type HistoryEntryFilter,
		type HistoryTimePeriod
	} from '$lib/utils/historyEntries';
	import { readHistoryEntryFilter, writeHistoryEntryFilter } from '$lib/utils/historyFilterStorage';
	import type { AppSettings } from '$lib/utils/settings';

	const LOADING_INDICATOR_DELAY_MS = 300;
	const MAX_TIMER_DELAY_MS = 2_147_483_647;
	type PostDeleteFocusTarget = { type: 'entry'; key: string } | { type: 'empty' };
	const historyFilterOptions = [
		{ label: 'All', value: 'all' },
		{ label: 'Fuel', value: 'fuel' },
		{ label: 'Maintenance', value: 'maintenance' }
	] as const satisfies ReadonlyArray<{ label: string; value: HistoryEntryFilter }>;

	const vehiclesCtx = getContext<VehiclesContext>('vehicles');

	let currentVehicle = $derived(vehiclesCtx.activeVehicle);
	let historyEntries = $state<HistoryEntry[]>([]);
	let selectedHistoryFilter = $state<HistoryEntryFilter>(readHistoryEntryFilter());
	let selectedHistoryTimePeriod = $state<HistoryTimePeriod>('current-month');
	let loading = $state(true);
	let showLoadingState = $state(false);
	let dbError = $state(false);
	let loadingIndicatorTimeout: ReturnType<typeof setTimeout> | null = null;
	let historySummaryRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
	let destroyed = false;
	let historySummaryReferenceDate = $state(new Date());

	// Edit state
	let editingEntry = $state<HistoryEntry | null>(null);
	let fuelEditTimelineVersion = $state(0);
	let pendingEditReturnFocusKey = $state<string | null>(null);

	// Delete state
	let armedDeleteEntryKey = $state<string | null>(null);
	let deletingEntryKey = $state<string | null>(null);
	let deleteErrorText = $state('');

	// Detail-sheet state
	let selectedDetailEntryKey = $state<string | null>(null);
	let detailInvokerEntryKey = $state<string | null>(null);
	let historyPageContent = $state<HTMLElement | null>(null);

	const settingsCtx = getContext<{ settings: AppSettings }>('settings');
	const visibleHistoryEntries = $derived(
		filterHistoryEntries(historyEntries, selectedHistoryFilter)
	);
	const visibleHistoryMonthGroups = $derived(groupHistoryEntriesByMonth(visibleHistoryEntries));
	const visibleHistoryTimePeriodSummary = $derived(
		summarizeHistoryEntriesForTimePeriod(
			visibleHistoryEntries,
			selectedHistoryTimePeriod,
			settingsCtx.settings.fuelUnit,
			historySummaryReferenceDate
		)
	);
	const selectedHistoryTimePeriodAriaLabel = $derived(
		selectedHistoryFilter === 'fuel'
			? `Fuel costs for ${visibleHistoryTimePeriodSummary.periodAriaLabel}`
			: selectedHistoryFilter === 'maintenance'
				? `Maintenance costs for ${visibleHistoryTimePeriodSummary.periodAriaLabel}`
				: `Total car costs for ${visibleHistoryTimePeriodSummary.periodAriaLabel}`
	);
	const showFilteredEmptyState = $derived(
		historyEntries.length > 0 && visibleHistoryEntries.length === 0
	);
	const filteredEmptyStateTitle = $derived.by(() => {
		const vehicleSuffix = currentVehicle ? ` for ${currentVehicle.name}` : '';
		return selectedHistoryFilter === 'fuel'
			? `No fuel entries${vehicleSuffix} yet.`
			: `No maintenance entries${vehicleSuffix} yet.`;
	});
	const filteredEmptyStateDescription = $derived(
		selectedHistoryFilter === 'fuel'
			? 'Show all entries to review your saved maintenance records.'
			: 'Show all entries to review your saved fuel fill-ups.'
	);

	const editingFuelLog = $derived(editingEntry?.kind === 'fuel' ? editingEntry.entry : undefined);
	const editingExpense = $derived(
		editingEntry?.kind === 'maintenance' ? editingEntry.entry : undefined
	);
	const selectedDetailEntry = $derived(
		selectedDetailEntryKey
			? (visibleHistoryEntries.find(
					(entry) => getHistoryEntryKey(entry) === selectedDetailEntryKey
				) ?? null)
			: null
	);
	const selectedDetailDeleteErrorText = $derived(
		selectedDetailEntry && armedDeleteEntryKey === getHistoryEntryKey(selectedDetailEntry)
			? deleteErrorText
			: ''
	);

	function clearLoadingIndicatorTimeout(): void {
		if (loadingIndicatorTimeout) {
			clearTimeout(loadingIndicatorTimeout);
			loadingIndicatorTimeout = null;
		}
	}

	function clearHistorySummaryRefreshTimeout(): void {
		if (historySummaryRefreshTimeout) {
			clearTimeout(historySummaryRefreshTimeout);
			historySummaryRefreshTimeout = null;
		}
	}

	function scheduleHistorySummaryRefresh(referenceDate: Date): void {
		clearHistorySummaryRefreshTimeout();
		const nextMonthStart = new Date(
			referenceDate.getFullYear(),
			referenceDate.getMonth() + 1,
			1,
			0,
			0,
			0,
			0
		);
		const delayUntilNextMonth = nextMonthStart.getTime() - referenceDate.getTime();
		historySummaryRefreshTimeout = setTimeout(
			() => {
				const now = new Date();
				if (now.getTime() >= nextMonthStart.getTime()) {
					updateHistorySummaryReferenceDate(now);
					return;
				}

				scheduleHistorySummaryRefresh(now);
			},
			Math.min(Math.max(1, delayUntilNextMonth), MAX_TIMER_DELAY_MS)
		);
	}

	function updateHistorySummaryReferenceDate(referenceDate: Date = new Date()): void {
		historySummaryReferenceDate = referenceDate;
		scheduleHistorySummaryRefresh(referenceDate);
	}

	function handleCalendarContextResume(): void {
		updateHistorySummaryReferenceDate();
	}

	function handleVisibilityChange(): void {
		if (document.visibilityState === 'visible') {
			updateHistorySummaryReferenceDate();
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

	function getDeleteState(entry: HistoryEntry): 'idle' | 'armed' | 'loading' {
		const key = getHistoryEntryKey(entry);
		if (deletingEntryKey === key) return 'loading';
		return armedDeleteEntryKey === key ? 'armed' : 'idle';
	}

	function isDeleteDisabled(entry: HistoryEntry): boolean {
		return deletingEntryKey !== null && deletingEntryKey !== getHistoryEntryKey(entry);
	}

	function getPreferredFocusTarget(
		preferredEntryKey: string | null | undefined
	): PostDeleteFocusTarget {
		if (
			preferredEntryKey &&
			visibleHistoryEntries.some((entry) => getHistoryEntryKey(entry) === preferredEntryKey)
		) {
			return { type: 'entry', key: preferredEntryKey };
		}

		const firstVisibleEntryKey = visibleHistoryEntries[0]
			? getHistoryEntryKey(visibleHistoryEntries[0])
			: null;

		return firstVisibleEntryKey ? { type: 'entry', key: firstVisibleEntryKey } : { type: 'empty' };
	}

	async function restorePendingEditFocus(): Promise<void> {
		if (!pendingEditReturnFocusKey) {
			return;
		}

		const focusTarget = getPreferredFocusTarget(pendingEditReturnFocusKey);
		pendingEditReturnFocusKey = null;
		await focusPostDeleteTarget(focusTarget);
	}

	function closeDetailSheetWithoutFocus(): void {
		if (
			selectedDetailEntryKey &&
			armedDeleteEntryKey === selectedDetailEntryKey &&
			deletingEntryKey === null
		) {
			armedDeleteEntryKey = null;
			deleteErrorText = '';
		}

		selectedDetailEntryKey = null;
		detailInvokerEntryKey = null;
	}

	async function closeDetailSheet(preferredEntryKey?: string | null): Promise<void> {
		const focusTarget = getPreferredFocusTarget(
			preferredEntryKey ?? detailInvokerEntryKey ?? selectedDetailEntryKey
		);
		closeDetailSheetWithoutFocus();
		await focusPostDeleteTarget(focusTarget);
	}

	function handleOpenDetail(request: HistoryEntry): void {
		if (editingEntry || deletingEntryKey) {
			return;
		}

		deleteErrorText = '';
		armedDeleteEntryKey = null;
		selectedDetailEntryKey = getHistoryEntryKey(request);
		detailInvokerEntryKey = getHistoryEntryKey(request);
	}

	function handleEdit(request: HistoryEntry): void {
		if (deletingEntryKey) return;
		deleteErrorText = '';
		armedDeleteEntryKey = null;
		fuelEditTimelineVersion = 0;
		editingEntry = request;
	}

	function handleDeleteRequest(request: HistoryEntry): void {
		if (deletingEntryKey) return;
		deleteErrorText = '';
		armedDeleteEntryKey = getHistoryEntryKey(request);
	}

	function handleDeleteCancel(request: HistoryEntry): void {
		if (deletingEntryKey) return;
		if (armedDeleteEntryKey === getHistoryEntryKey(request)) {
			armedDeleteEntryKey = null;
			deleteErrorText = '';
		}
	}

	function getPostDeleteFocusTarget(entryKey: string): PostDeleteFocusTarget {
		const orderedEntryKeys = visibleHistoryEntries.map((entry) => getHistoryEntryKey(entry));
		const remainingEntryKeys = orderedEntryKeys.filter((key) => key !== entryKey);
		if (remainingEntryKeys.length === 0) {
			return { type: 'empty' };
		}

		const deletedEntryIndex = orderedEntryKeys.indexOf(entryKey);
		const nextEntryKey =
			remainingEntryKeys[deletedEntryIndex] ??
			remainingEntryKeys[deletedEntryIndex - 1] ??
			remainingEntryKeys[0];

		return { type: 'entry', key: nextEntryKey };
	}

	async function focusPostDeleteTarget(target: PostDeleteFocusTarget): Promise<void> {
		await tick();

		if (target.type === 'entry') {
			const preferredTarget = document.querySelector<HTMLElement>(
				`[data-entry-key="${target.key}"]`
			);
			if (preferredTarget) {
				preferredTarget.focus();
				return;
			}
		}

		const firstVisibleEntry = document.querySelector<HTMLElement>('[data-entry-key]');
		if (firstVisibleEntry) {
			firstVisibleEntry.focus();
			return;
		}

		document.querySelector<HTMLElement>('[data-history-empty-state-cta="true"]')?.focus();
	}

	function refreshOpenFuelEditAfterFuelDeletion(
		deletedFuelLogId: number,
		updatedEntries: HistoryEntry[]
	): void {
		if (editingEntry?.kind !== 'fuel' || editingEntry.entry.id === deletedFuelLogId) {
			return;
		}

		const updatedEditingEntry = updatedEntries.find(
			(entry): entry is Extract<HistoryEntry, { kind: 'fuel' }> =>
				entry.kind === 'fuel' && entry.entry.id === editingEntry?.entry.id
		);
		if (updatedEditingEntry) {
			editingEntry = updatedEditingEntry;
		}

		fuelEditTimelineVersion += 1;
	}

	async function handleDeleteConfirm(request: HistoryEntry): Promise<void> {
		if (deletingEntryKey) return;

		const entryKey = getHistoryEntryKey(request);
		const postDeleteFocusTarget = getPostDeleteFocusTarget(entryKey);
		const deletingSelectedDetailEntry = selectedDetailEntryKey === entryKey;
		deleteErrorText = '';
		deletingEntryKey = entryKey;

		try {
			if (request.kind === 'maintenance') {
				const result = await deleteExpense(request.entry.id);
				if (result.error) {
					deleteErrorText = 'Could not delete maintenance entry. Please try again.';
					return;
				}
			} else {
				const result = await deleteFuelLog(request.entry.id);
				if (result.error) {
					deleteErrorText = 'Could not delete fuel entry. Please try again.';
					return;
				}

				const updatedEntries = (result.data?.updatedLogs ?? []).map(
					(entry) => ({ kind: 'fuel', entry }) satisfies HistoryEntry
				);
				const updatedById = new Map(
					updatedEntries.map((updatedEntry) => [updatedEntry.entry.id, updatedEntry.entry])
				);
				historyEntries = historyEntries.map((item) => {
					if (item.kind === 'fuel') {
						const updated = updatedById.get(item.entry.id);
						if (updated) return { kind: 'fuel' as const, entry: updated };
					}
					return item;
				});
				refreshOpenFuelEditAfterFuelDeletion(request.entry.id, updatedEntries);
			}

			if (armedDeleteEntryKey === entryKey) armedDeleteEntryKey = null;
			if (editingEntry && getHistoryEntryKey(editingEntry) === entryKey) {
				editingEntry = null;
				fuelEditTimelineVersion = 0;
			}
			if (deletingSelectedDetailEntry) {
				closeDetailSheetWithoutFocus();
			}
			historyEntries = historyEntries.filter((item) => getHistoryEntryKey(item) !== entryKey);
			await focusPostDeleteTarget(postDeleteFocusTarget);
		} finally {
			deletingEntryKey = null;
		}
	}

	function handleDetailEdit(request: HistoryEntry): void {
		pendingEditReturnFocusKey = detailInvokerEntryKey ?? getHistoryEntryKey(request);
		closeDetailSheetWithoutFocus();
		handleEdit(request);
	}

	function handleEditedFuelSaved(result: FuelLog | FuelLog[]): void {
		const updatedLogs = Array.isArray(result) ? result : [result];
		const updatedById = new Map(updatedLogs.map((log) => [log.id, log]));
		historyEntries = historyEntries
			.map((item) => {
				if (item.kind === 'fuel') {
					const updated = updatedById.get(item.entry.id);
					if (updated) return { kind: 'fuel' as const, entry: updated };
				}
				return item;
			})
			.sort(compareHistoryEntriesNewestFirst);
		deleteErrorText = '';
		armedDeleteEntryKey = null;
		fuelEditTimelineVersion = 0;
	}

	function handleEditedFuelFeedbackComplete(): void {
		editingEntry = null;
		fuelEditTimelineVersion = 0;
		void restorePendingEditFocus();
	}

	function handleEditedMaintenanceSaved(expense: Expense): void {
		historyEntries = historyEntries
			.map((item) => {
				if (item.kind === 'maintenance' && item.entry.id === expense.id) {
					return { kind: 'maintenance' as const, entry: expense };
				}
				return item;
			})
			.sort(compareHistoryEntriesNewestFirst);
		deleteErrorText = '';
		armedDeleteEntryKey = null;
	}

	function handleEditedMaintenanceFeedbackComplete(): void {
		editingEntry = null;
		void restorePendingEditFocus();
	}

	function handleEditCancelled(): void {
		editingEntry = null;
		fuelEditTimelineVersion = 0;
		void restorePendingEditFocus();
	}

	function resetHistoryFilter(): void {
		selectedHistoryFilter = 'all';
	}

	$effect(() => {
		writeHistoryEntryFilter(selectedHistoryFilter);
	});

	$effect(() => {
		if (deletingEntryKey !== null) {
			return;
		}

		const visibleEntryKeys = new Set(
			visibleHistoryEntries.map((entry) => getHistoryEntryKey(entry))
		);
		if (armedDeleteEntryKey && !visibleEntryKeys.has(armedDeleteEntryKey)) {
			armedDeleteEntryKey = null;
		}
	});

	$effect(() => {
		if (!selectedDetailEntryKey) {
			return;
		}

		const detailEntryStillVisible = visibleHistoryEntries.some(
			(entry) => getHistoryEntryKey(entry) === selectedDetailEntryKey
		);
		if (detailEntryStillVisible) {
			return;
		}

		const focusTarget = getPreferredFocusTarget(detailInvokerEntryKey ?? selectedDetailEntryKey);
		closeDetailSheetWithoutFocus();
		void focusPostDeleteTarget(focusTarget);
	});

	$effect(() => {
		if (!historyPageContent) {
			return;
		}

		if (selectedDetailEntry) {
			historyPageContent.setAttribute('inert', '');
			(historyPageContent as HTMLElement & { inert?: boolean }).inert = true;
			return;
		}

		historyPageContent.removeAttribute('inert');
		(historyPageContent as HTMLElement & { inert?: boolean }).inert = false;
	});

	$effect(() => {
		const vehicleId = vehiclesCtx.activeVehicle?.id;
		if (vehicleId) {
			void loadEntriesForVehicle(vehicleId);
		} else {
			historyEntries = [];
			loading = false;
		}
	});

	onMount(() => {
		updateHistorySummaryReferenceDate();
		window.addEventListener('focus', handleCalendarContextResume);
		window.addEventListener('pageshow', handleCalendarContextResume);
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			clearHistorySummaryRefreshTimeout();
			window.removeEventListener('focus', handleCalendarContextResume);
			window.removeEventListener('pageshow', handleCalendarContextResume);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	});

	onDestroy(() => {
		destroyed = true;
		clearLoadingIndicatorTimeout();
		clearHistorySummaryRefreshTimeout();
	});
</script>

<div class="px-4 pt-4">
	<div
		bind:this={historyPageContent}
		data-history-page-content="true"
		class="space-y-6"
		aria-hidden={selectedDetailEntry ? 'true' : undefined}
		class:pointer-events-none={selectedDetailEntry !== null}
	>
		<header class="space-y-1">
			<h1 class="text-xl font-semibold text-foreground">History</h1>
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
					Review your fuel fill-ups and maintenance costs in one place.
				</p>
			{/if}
		</header>

		{#if dbError}
			<div
				role="alert"
				class="flex min-h-[50vh] flex-col items-center justify-center gap-6 p-8 text-center"
			>
				<div class="flex flex-col items-center gap-2">
					<p class="text-lg font-semibold text-foreground">Could not load your history</p>
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
				<p class="text-sm text-muted-foreground">Loading history...</p>
			</div>
		{:else if !loading}
			{#if editingEntry && currentVehicle}
				<section class="space-y-4">
					<div class="space-y-1">
						{#if editingFuelLog}
							<h2 class="text-lg font-semibold text-foreground">Editing fuel entry</h2>
							<p class="text-sm text-muted-foreground">
								Save your changes or cancel to return to history.
							</p>
						{:else if editingExpense}
							<h2 class="text-lg font-semibold text-foreground">Editing maintenance entry</h2>
							<p class="text-sm text-muted-foreground">
								Save your changes or cancel to return to history.
							</p>
						{/if}
					</div>

					{#key editingEntry ? getHistoryEntryKey(editingEntry) : 'noedit'}
						{#if editingFuelLog && currentVehicle}
							<FuelEntryForm
								vehicleId={currentVehicle.id}
								mode="edit"
								initialFuelLog={editingFuelLog}
								timelineContextVersion={fuelEditTimelineVersion}
								onSave={handleEditedFuelSaved}
								onSuccessFeedbackComplete={handleEditedFuelFeedbackComplete}
								onCancel={handleEditCancelled}
							/>
						{:else if editingExpense && currentVehicle}
							<MaintenanceForm
								vehicleId={currentVehicle.id}
								mode="edit"
								initialExpense={editingExpense}
								onSave={handleEditedMaintenanceSaved}
								onSuccessFeedbackComplete={handleEditedMaintenanceFeedbackComplete}
								onCancel={handleEditCancelled}
							/>
						{/if}
					{/key}
				</section>
			{/if}

			{#if deleteErrorText}
				<div role="alert" class="rounded-2xl border border-destructive/20 bg-destructive/10 p-4">
					<p class="text-sm text-destructive">{deleteErrorText}</p>
				</div>
			{/if}

			{#if historyEntries.length > 0}
				<fieldset class="space-y-3">
					<legend class="text-sm font-medium text-foreground">Entry type</legend>
					<div class="flex rounded-2xl bg-muted/50 p-1">
						{#each historyFilterOptions as option (option.value)}
							<label class="flex-1">
								<input
									bind:group={selectedHistoryFilter}
									class="peer sr-only"
									name="history-filter"
									type="radio"
									value={option.value}
								/>
								<span
									class="flex min-h-11 items-center justify-center rounded-xl border border-transparent px-4 text-sm font-medium text-muted-foreground transition-colors peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
								>
									{option.label}
								</span>
							</label>
						{/each}
					</div>
				</fieldset>

				<fieldset class="space-y-3">
					<legend class="text-sm font-medium text-foreground">Time period</legend>
					<div class="flex rounded-2xl bg-muted/50 p-1">
						{#each historyTimePeriodOptions as option (option.value)}
							<label class="flex-1">
								<input
									bind:group={selectedHistoryTimePeriod}
									class="peer sr-only"
									name="history-time-period"
									type="radio"
									value={option.value}
								/>
								<span
									class="flex min-h-11 items-center justify-center rounded-xl border border-transparent px-4 text-sm font-medium text-muted-foreground transition-colors peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
								>
									{option.label}
								</span>
							</label>
						{/each}
					</div>
				</fieldset>

				<StatBar
					summary={visibleHistoryTimePeriodSummary}
					selectedPeriodTotal={visibleHistoryTimePeriodSummary.totalSpend}
					selectedPeriodLabel={visibleHistoryTimePeriodSummary.periodLabel}
					selectedPeriodAriaLabel={selectedHistoryTimePeriodAriaLabel}
					currency={settingsCtx.settings.currency}
				/>
			{/if}

			{#if showFilteredEmptyState}
				<div
					role="region"
					aria-labelledby="history-filter-empty-state-title"
					aria-describedby="history-filter-empty-state-description"
					class="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center"
				>
					<p id="history-filter-empty-state-title" class="text-base font-semibold text-foreground">
						{filteredEmptyStateTitle}
					</p>
					<p id="history-filter-empty-state-description" class="mt-1 text-sm text-muted-foreground">
						{filteredEmptyStateDescription}
					</p>
					<button
						data-history-empty-state-cta="true"
						type="button"
						onclick={resetHistoryFilter}
						class="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
					>
						Show all entries
					</button>
				</div>
			{:else}
				<HistoryList
					vehicleName={currentVehicle?.name}
					hasVehicles={vehiclesCtx.vehicles.length > 0}
					monthGroups={visibleHistoryMonthGroups}
					currency={settingsCtx.settings.currency}
					preferredFuelUnit={settingsCtx.settings.fuelUnit}
					editDisabled={editingEntry !== null || deletingEntryKey !== null}
					detailDisabled={editingEntry !== null || deletingEntryKey !== null}
					detailOpenEntryKey={selectedDetailEntryKey}
					onOpenDetail={handleOpenDetail}
					onEdit={handleEdit}
					onDeleteRequest={handleDeleteRequest}
					onDeleteConfirm={handleDeleteConfirm}
					onDeleteCancel={handleDeleteCancel}
					{getDeleteState}
					{isDeleteDisabled}
				/>
			{/if}
		{/if}
	</div>

	{#if selectedDetailEntry}
		<EntryDetailSheet
			entry={selectedDetailEntry}
			currency={settingsCtx.settings.currency}
			preferredFuelUnit={settingsCtx.settings.fuelUnit}
			vehicleName={currentVehicle?.name}
			deleteState={getDeleteState(selectedDetailEntry)}
			deleteDisabled={isDeleteDisabled(selectedDetailEntry)}
			deleteErrorText={selectedDetailDeleteErrorText}
			onClose={() => void closeDetailSheet()}
			onEdit={handleDetailEdit}
			onDeleteRequest={handleDeleteRequest}
			onDeleteConfirm={handleDeleteConfirm}
			onDeleteCancel={handleDeleteCancel}
		/>
	{/if}
</div>
