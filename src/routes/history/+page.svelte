<script lang="ts">
	import { getContext, onDestroy, onMount, tick } from 'svelte';
	import DbErrorCard from '$lib/components/DbErrorCard.svelte';
	import EntryDetailSheet from '$lib/components/EntryDetailSheet.svelte';
	import FuelEntryForm from '$lib/components/FuelEntryForm.svelte';
	import HistoryList from '$lib/components/HistoryList.svelte';
	import MaintenanceForm from '$lib/components/MaintenanceForm.svelte';
	import StatBar from '$lib/components/StatBar.svelte';
	import { deleteExpense, getAllExpenses, restoreExpense } from '$lib/db/repositories/expenses';
	import { deleteFuelLog, getAllFuelLogs, restoreFuelLog } from '$lib/db/repositories/fuelLogs';
	import type { Expense, FuelLog } from '$lib/db/schema';
	import type { ToastApi } from '$lib/state/toast';
	import { getDataGeneration } from '$lib/utils/tabSync';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';
	import {
		compareHistoryEntriesNewestFirst,
		convertHistorySpendToHome,
		filterHistoryEntries,
		filterHistoryEntriesForTimePeriod,
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
	import { m } from '$lib/paraglide/messages';

	const LOADING_INDICATOR_DELAY_MS = 300;
	const MAX_TIMER_DELAY_MS = 2_147_483_647;
	type PostDeleteFocusTarget = { type: 'entry'; key: string } | { type: 'empty' };
	const historyFilterOptions = [
		{ label: m.history_filter_all(), value: 'all' },
		{ label: m.common_fuel(), value: 'fuel' },
		{ label: m.history_filter_maintenance(), value: 'maintenance' }
	] as const satisfies ReadonlyArray<{ label: string; value: HistoryEntryFilter }>;

	const vehiclesCtx = getContext<VehiclesContext>('vehicles');
	const tabSyncCtx = getContext<{ dataRevision: number; restorePending?: boolean } | undefined>(
		'tabSync'
	);
	const toast = getContext<ToastApi | undefined>('toast');

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
	let pendingEditReturnFocusKey = $state<string | null>(null);

	// Delete state — single-action (no arm-then-confirm). `deletingEntryKey` only guards re-entrancy
	// and disables edit/detail entry points for the brief window of the optimistic delete.
	let deletingEntryKey = $state<string | null>(null);
	// Guards against a rapid double-tap of the Undo toast action firing two restores.
	let undoInFlight = false;

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
			historySummaryReferenceDate,
			settingsCtx.settings.currency
		)
	);
	// Optional approximate home-currency total over the same period entries the summary uses,
	// from the user's saved rates. Pass a value only when something converts; null otherwise so
	// StatBar keeps single-currency / rate-less rendering identical to today.
	const visiblePeriodConvertedHomeSpend = $derived(
		convertHistorySpendToHome(
			filterHistoryEntriesForTimePeriod(
				visibleHistoryEntries,
				selectedHistoryTimePeriod,
				historySummaryReferenceDate
			),
			settingsCtx.settings.currency,
			settingsCtx.settings.exchangeRates
		)
	);
	const visiblePeriodConvertedHomeTotal = $derived(
		visiblePeriodConvertedHomeSpend.ratedEntries > 0
			? {
					total: visiblePeriodConvertedHomeSpend.total,
					unconvertedEntries: visiblePeriodConvertedHomeSpend.unconvertedEntries
				}
			: null
	);
	const selectedHistoryTimePeriodAriaLabel = $derived(
		selectedHistoryFilter === 'fuel'
			? m.history_aria_fuel_costs({ period: visibleHistoryTimePeriodSummary.periodAriaLabel })
			: selectedHistoryFilter === 'maintenance'
				? m.history_aria_maintenance_costs({
						period: visibleHistoryTimePeriodSummary.periodAriaLabel
					})
				: m.history_aria_total_costs({ period: visibleHistoryTimePeriodSummary.periodAriaLabel })
	);
	const showFilteredEmptyState = $derived(
		historyEntries.length > 0 && visibleHistoryEntries.length === 0
	);
	const filteredEmptyStateTitle = $derived.by(() => {
		if (selectedHistoryFilter === 'fuel') {
			return currentVehicle
				? m.history_filtered_empty_fuel_vehicle({ vehicleName: currentVehicle.name })
				: m.history_filtered_empty_fuel();
		}
		return currentVehicle
			? m.history_filtered_empty_maintenance_vehicle({ vehicleName: currentVehicle.name })
			: m.history_filtered_empty_maintenance();
	});
	const filteredEmptyStateDescription = $derived(
		selectedHistoryFilter === 'fuel'
			? m.history_filtered_empty_fuel_description()
			: m.history_filtered_empty_maintenance_description()
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

		selectedDetailEntryKey = getHistoryEntryKey(request);
		detailInvokerEntryKey = getHistoryEntryKey(request);
	}

	function handleEdit(request: HistoryEntry): void {
		if (deletingEntryKey) return;
		editingEntry = request;
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

	async function handleDelete(request: HistoryEntry): Promise<void> {
		if (deletingEntryKey) return;

		const entryKey = getHistoryEntryKey(request);
		// Capture a plain-object snapshot BEFORE the delete so Undo can re-insert it. request.entry
		// originates from the $state historyEntries list, so it IS a proxy — $state.snapshot() deep-
		// clones it to a plain, structured-cloneable object safe for the Dexie put() in restore*.
		const snapshot = $state.snapshot(request.entry);
		const postDeleteFocusTarget = getPostDeleteFocusTarget(entryKey);
		const deletingSelectedDetailEntry = selectedDetailEntryKey === entryKey;
		deletingEntryKey = entryKey;

		try {
			if (request.kind === 'maintenance') {
				const result = await deleteExpense(request.entry.id);
				if (result.error) {
					toast?.error(m.history_delete_maintenance_error());
					return;
				}
			} else {
				const result = await deleteFuelLog(request.entry.id);
				if (result.error) {
					toast?.error(m.history_delete_fuel_error());
					return;
				}

				const updatedById = new Map(
					(result.data?.updatedLogs ?? []).map((entry) => [entry.id, entry])
				);
				historyEntries = historyEntries.map((item) => {
					if (item.kind === 'fuel') {
						const updated = updatedById.get(item.entry.id);
						if (updated) return { kind: 'fuel' as const, entry: updated };
					}
					return item;
				});
			}

			if (editingEntry && getHistoryEntryKey(editingEntry) === entryKey) {
				editingEntry = null;
			}
			if (deletingSelectedDetailEntry) {
				closeDetailSheetWithoutFocus();
			}
			historyEntries = historyEntries.filter((item) => getHistoryEntryKey(item) !== entryKey);
			await focusPostDeleteTarget(postDeleteFocusTarget);

			// Capture both guard signals AFTER the delete's own notifyDataChanged() so the baseline is
			// post-delete: any later write (this tab → getDataGeneration, another tab → dataRevision)
			// flips one of them and disables the pending Undo (AC 4).
			const gen = getDataGeneration();
			const rev = tabSyncCtx?.dataRevision ?? 0;
			toast?.action(m.history_delete_undo_toast(), {
				label: m.history_undo_action_label(),
				onClick: () => void handleUndo(request.kind, snapshot, gen, rev)
			});
		} finally {
			deletingEntryKey = null;
		}
	}

	async function handleUndo(
		kind: HistoryEntry['kind'],
		snapshot: FuelLog | Expense,
		gen: number,
		rev: number
	): Promise<void> {
		// In-flight guard: a true rapid double-tap could otherwise pass the generation guard twice and
		// fire a second restore that hits the id-collision guard with a spurious failure toast.
		if (undoInFlight) return;

		// Re-check the guard at click time. If the timeline changed since the delete, the snapshot's
		// own consumption may be stale — refuse rather than risk an inconsistent recompute (AC 4).
		if (getDataGeneration() !== gen || (tabSyncCtx?.dataRevision ?? 0) !== rev) {
			toast?.error(m.history_undo_timeline_changed_error());
			return;
		}

		undoInFlight = true;
		try {
			const result =
				kind === 'fuel'
					? await restoreFuelLog(snapshot as FuelLog)
					: await restoreExpense(snapshot as Expense);
			if (result.error) {
				toast?.error(m.history_restore_error());
				return;
			}

			// Reload to bring the row AND the corrected neighbor consumptions back into the list. The
			// restore's notifyDataChanged() doesn't self-bump dataRevision, so the load is imperative.
			// Reload only when the snapshot's vehicle is still the active one — a vehicle switch during
			// the Undo window is not a DB write, so the guard passes, but reloading the active vehicle
			// would either show the wrong list or skip the reload while still claiming "Restored.".
			if (vehiclesCtx.activeVehicle?.id === snapshot.vehicleId) {
				await loadEntriesForVehicle(snapshot.vehicleId);
				// Re-home focus on the restored row (focusPostDeleteTarget awaits tick() itself).
				await focusPostDeleteTarget({
					type: 'entry',
					key: getHistoryEntryKey({ kind, entry: snapshot } as HistoryEntry)
				});
			}
			toast?.success(m.history_restore_success());
		} finally {
			undoInFlight = false;
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
	}

	function handleEditedFuelFeedbackComplete(): void {
		editingEntry = null;
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
	}

	function handleEditedMaintenanceFeedbackComplete(): void {
		editingEntry = null;
		void restorePendingEditFocus();
	}

	function handleEditCancelled(): void {
		editingEntry = null;
		void restorePendingEditFocus();
	}

	function resetHistoryFilter(): void {
		selectedHistoryFilter = 'all';
	}

	$effect(() => {
		writeHistoryEntryFilter(selectedHistoryFilter);
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
		// Reactive dep: a write in another tab bumps dataRevision → re-run this load (multi-tab safety).
		const revision = tabSyncCtx?.dataRevision ?? 0;
		// ADR-006 AD-WB-4 (H17c): a pending cross-tab restore ALSO bumps dataRevision (to disarm this
		// tab's Undo guard, read below), but must NOT trigger a reload here — that would silently swap
		// this tab's intentionally-stale list for the restored data before the user clicks Reload.
		if (tabSyncCtx?.restorePending) return;
		if (vehicleId && revision >= 0) {
			void loadEntriesForVehicle(vehicleId);
		} else {
			historyEntries = [];
			loading = false;
			// S29: the active vehicle disappearing (deleted / switched away) must clear a stale error
			// card too — otherwise it stays rendered over what is now a genuine "no vehicle" state.
			dbError = false;
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
			<h1 class="text-xl font-semibold text-foreground">{m.nav_history()}</h1>
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
					{m.history_subtitle_no_vehicle()}
				</p>
			{/if}
		</header>

		{#if dbError}
			<div class="flex min-h-[50vh] flex-col items-center justify-center">
				<DbErrorCard title={m.history_db_error_title()} ctaLabel={m.history_db_error_export_cta()}>
					{#snippet body()}
						<p>{m.history_db_error_body()}</p>
						<p>{m.history_db_error_export_hint()}</p>
					{/snippet}
				</DbErrorCard>
			</div>
		{:else if loading && showLoadingState}
			<div
				role="status"
				aria-live="polite"
				class="rounded-2xl border border-border bg-card px-4 py-6 text-center"
			>
				<p class="text-sm text-muted-foreground">{m.history_loading()}</p>
			</div>
		{:else if !loading}
			{#if editingEntry && currentVehicle}
				<section class="space-y-4">
					<div class="space-y-1">
						{#if editingFuelLog}
							<h2 class="text-lg font-semibold text-foreground">
								{m.history_editing_fuel_title()}
							</h2>
							<p class="text-sm text-muted-foreground">
								{m.history_editing_subtitle()}
							</p>
						{:else if editingExpense}
							<h2 class="text-lg font-semibold text-foreground">
								{m.history_editing_maintenance_title()}
							</h2>
							<p class="text-sm text-muted-foreground">
								{m.history_editing_subtitle()}
							</p>
						{/if}
					</div>

					{#key editingEntry ? getHistoryEntryKey(editingEntry) : 'noedit'}
						{#if editingFuelLog && currentVehicle}
							<FuelEntryForm
								vehicleId={currentVehicle.id}
								mode="edit"
								initialFuelLog={editingFuelLog}
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

			{#if historyEntries.length > 0}
				<fieldset class="space-y-3">
					<legend class="text-sm font-medium text-foreground">{m.history_filter_legend()}</legend>
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
					<legend class="text-sm font-medium text-foreground"
						>{m.history_time_period_legend()}</legend
					>
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
					selectedPeriodSpendByCurrency={visibleHistoryTimePeriodSummary.totalSpendByCurrency}
					convertedHomeTotal={visiblePeriodConvertedHomeTotal}
					homeCurrency={settingsCtx.settings.currency}
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
						{m.history_show_all_entries()}
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
					onOpenDetail={handleOpenDetail}
					onEdit={handleEdit}
					onDelete={handleDelete}
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
			deleting={deletingEntryKey !== null && deletingEntryKey === selectedDetailEntryKey}
			onClose={() => void closeDetailSheet()}
			onEdit={handleDetailEdit}
			onDelete={handleDelete}
		/>
	{/if}
</div>
