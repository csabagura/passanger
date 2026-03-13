<script lang="ts">
	import Wrench from '@lucide/svelte/icons/wrench';
	import { resolve } from '$app/paths';
	import { getContext, onDestroy, tick } from 'svelte';
	import { RESULT_CARD_DISMISS_MS, VEHICLE_ID_STORAGE_KEY } from '$lib/config';
	import EntryCard from '$lib/components/EntryCard.svelte';
	import FuelEntryForm from '$lib/components/FuelEntryForm.svelte';
	import MaintenanceForm from '$lib/components/MaintenanceForm.svelte';
	import { deleteExpense, getAllExpenses } from '$lib/db/repositories/expenses';
	import { deleteFuelLog, getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
	import { getAllVehicles, getVehicleById } from '$lib/db/repositories/vehicles';
	import type { Expense, FuelLog, Vehicle } from '$lib/db/schema';
	import type { AppSettings } from '$lib/utils/settings';
	import { readStoredVehicleId, safeRemoveItem, safeSetItem } from '$lib/utils/vehicleStorage';

	type EditableEntry = { kind: 'fuel'; entry: FuelLog } | { kind: 'maintenance'; entry: Expense };
	type PostDeleteFocusTarget = { type: 'entry'; key: string } | { type: 'empty' };

	let currentVehicle = $state<Vehicle | null>(null);
	let loading = $state(true);
	let dbError = $state(false);
	let vehicleLoadStarted = $state(false);
	let editableEntries = $state<EditableEntry[]>([]);
	let entriesError = $state('');
	let refreshEntriesToken = $state(0);
	let pinnedEntryKey = $state<string | null>(null);
	let editingEntry = $state<EditableEntry | null>(null);
	let fuelEditTimelineVersion = $state(0);
	let armedDeleteEntryKey = $state<string | null>(null);
	let deletingEntryKey = $state<string | null>(null);
	let deleteErrorText = $state('');
	let pinnedEntryTimeout: ReturnType<typeof setTimeout> | null = null;
	let entryListElement = $state<HTMLUListElement | undefined>(undefined);
	let emptyEntriesFocusTarget = $state<HTMLDivElement | undefined>(undefined);

	const settingsCtx = getContext<{ settings: AppSettings }>('settings');

	const editingFuelLog = $derived(editingEntry?.kind === 'fuel' ? editingEntry.entry : undefined);
	const editingExpense = $derived(
		editingEntry?.kind === 'maintenance' ? editingEntry.entry : undefined
	);
	const sortedEditableEntries = $derived(sortEditableEntries(editableEntries, pinnedEntryKey));

	function getEditableEntryKey(value: EditableEntry): string {
		return `${value.kind}-${value.entry.id}`;
	}

	function sortEditableEntries(
		entries: EditableEntry[],
		pinnedKey: string | null
	): EditableEntry[] {
		return [...entries].sort((left, right) => {
			const leftPinned = pinnedKey !== null && getEditableEntryKey(left) === pinnedKey;
			const rightPinned = pinnedKey !== null && getEditableEntryKey(right) === pinnedKey;

			if (leftPinned !== rightPinned) {
				return leftPinned ? -1 : 1;
			}

			const dateDifference = right.entry.date.getTime() - left.entry.date.getTime();
			return dateDifference !== 0 ? dateDifference : right.entry.id - left.entry.id;
		});
	}

	function mergeEntries(fuelLogs: FuelLog[], expenses: Expense[]): EditableEntry[] {
		return [
			...fuelLogs.map((entry) => ({ kind: 'fuel', entry }) satisfies EditableEntry),
			...expenses.map((entry) => ({ kind: 'maintenance', entry }) satisfies EditableEntry)
		];
	}

	function clearPinnedEntryTimeout() {
		if (pinnedEntryTimeout) {
			clearTimeout(pinnedEntryTimeout);
			pinnedEntryTimeout = null;
		}
	}

	function schedulePinnedEntryReset(nextPinnedEntryKey: string | null) {
		clearPinnedEntryTimeout();
		if (nextPinnedEntryKey === null) {
			return;
		}

		pinnedEntryTimeout = setTimeout(() => {
			pinnedEntryKey = null;
			pinnedEntryTimeout = null;
		}, RESULT_CARD_DISMISS_MS);
	}

	function upsertEditableEntry(value: EditableEntry): void {
		upsertEditableEntries([value], getEditableEntryKey(value));
	}

	function upsertEditableEntries(values: EditableEntry[], nextPinnedEntryKey: string | null): void {
		const updatedEntriesByKey = new Map(values.map((value) => [getEditableEntryKey(value), value]));
		editableEntries = [
			...values,
			...editableEntries.filter((entry) => !updatedEntriesByKey.has(getEditableEntryKey(entry)))
		];
		pinnedEntryKey = nextPinnedEntryKey;
		schedulePinnedEntryReset(nextPinnedEntryKey);
	}

	function applyEditableEntryUpdates(values: EditableEntry[]): void {
		const updatedEntriesByKey = new Map(values.map((value) => [getEditableEntryKey(value), value]));
		editableEntries = editableEntries.map(
			(entry) => updatedEntriesByKey.get(getEditableEntryKey(entry)) ?? entry
		);
	}

	function removeEditableEntry(entryKey: string): void {
		editableEntries = editableEntries.filter((entry) => getEditableEntryKey(entry) !== entryKey);
	}

	function clearDeletedEntryState(entryKey: string): void {
		if (editingEntry && getEditableEntryKey(editingEntry) === entryKey) {
			editingEntry = null;
			fuelEditTimelineVersion = 0;
		}

		if (pinnedEntryKey === entryKey) {
			clearPinnedEntryTimeout();
			pinnedEntryKey = null;
		}

		if (armedDeleteEntryKey === entryKey) {
			armedDeleteEntryKey = null;
		}
	}

	function getPostDeleteFocusTarget(entryKey: string): PostDeleteFocusTarget {
		const orderedEntryKeys = sortEditableEntries(editableEntries, pinnedEntryKey).map((entry) =>
			getEditableEntryKey(entry)
		);
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
			entryListElement?.querySelector<HTMLElement>(`[data-entry-key="${target.key}"]`)?.focus();
			return;
		}

		emptyEntriesFocusTarget?.focus();
	}

	function refreshOpenFuelEditAfterFuelDeletion(
		deletedFuelLogId: number,
		updatedEntries: EditableEntry[]
	): void {
		if (editingEntry?.kind !== 'fuel' || editingEntry.entry.id === deletedFuelLogId) {
			return;
		}

		const updatedEditingEntry = updatedEntries.find(
			(entry): entry is Extract<EditableEntry, { kind: 'fuel' }> =>
				entry.kind === 'fuel' && entry.entry.id === editingEntry?.entry.id
		);
		if (updatedEditingEntry) {
			editingEntry = updatedEditingEntry;
		}

		fuelEditTimelineVersion += 1;
	}

	function getDeleteState(entry: EditableEntry): 'idle' | 'armed' | 'loading' {
		const entryKey = getEditableEntryKey(entry);
		if (deletingEntryKey === entryKey) {
			return 'loading';
		}

		return armedDeleteEntryKey === entryKey ? 'armed' : 'idle';
	}

	async function loadCurrentVehicle() {
		dbError = false;
		currentVehicle = null;

		const storedVehicleId = readStoredVehicleId();
		if (storedVehicleId !== null) {
			const result = await getVehicleById(storedVehicleId);
			if (!result.error) {
				currentVehicle = result.data;
				loading = false;
				return;
			}

			if (result.error.code !== 'NOT_FOUND') {
				dbError = true;
				loading = false;
				return;
			}

			safeRemoveItem(VEHICLE_ID_STORAGE_KEY);
		}

		const recoveryResult = await getAllVehicles();
		if (!recoveryResult.error && recoveryResult.data && recoveryResult.data.length > 0) {
			const recoveredVehicle = recoveryResult.data[0];
			currentVehicle = recoveredVehicle;
			safeSetItem(VEHICLE_ID_STORAGE_KEY, String(recoveredVehicle.id));
		} else if (recoveryResult.error && recoveryResult.error.code === 'GET_FAILED') {
			dbError = true;
		}

		loading = false;
	}

	$effect(() => {
		if (vehicleLoadStarted) {
			return;
		}

		vehicleLoadStarted = true;
		void loadCurrentVehicle();
	});

	$effect(() => {
		const vehicleId = currentVehicle?.id;
		const refreshToken = refreshEntriesToken;

		if (!vehicleId) {
			editableEntries = [];
			entriesError = '';
			deleteErrorText = '';
			clearPinnedEntryTimeout();
			pinnedEntryKey = null;
			editingEntry = null;
			fuelEditTimelineVersion = 0;
			armedDeleteEntryKey = null;
			deletingEntryKey = null;
			return;
		}

		let cancelled = false;
		entriesError = '';

		Promise.all([getAllFuelLogs(vehicleId), getAllExpenses(vehicleId)]).then(
			([fuelResult, expenseResult]) => {
				if (cancelled) {
					return;
				}

				if (fuelResult.error || expenseResult.error) {
					entriesError = 'Could not load saved entries.';
					return;
				}

				editableEntries = mergeEntries(fuelResult.data ?? [], expenseResult.data ?? []);
			}
		);

		return () => {
			cancelled = true;
			void refreshToken;
		};
	});

	function handleEntryEditRequest(request: EditableEntry) {
		if (deletingEntryKey) {
			return;
		}

		deleteErrorText = '';
		armedDeleteEntryKey = null;
		fuelEditTimelineVersion = 0;
		editingEntry = request;
	}

	function handleCreatedMaintenanceSaved(expense: Expense) {
		entriesError = '';
		deleteErrorText = '';
		armedDeleteEntryKey = null;
		upsertEditableEntry({ kind: 'maintenance', entry: expense });
		refreshEntriesToken += 1;
	}

	function handleEditedMaintenanceSaved(expense: Expense) {
		entriesError = '';
		deleteErrorText = '';
		armedDeleteEntryKey = null;
		upsertEditableEntry({ kind: 'maintenance', entry: expense });
		refreshEntriesToken += 1;
	}

	function handleEditedMaintenanceFeedbackComplete() {
		editingEntry = null;
	}

	function handleEditedFuelSaved(result: FuelLog | FuelLog[]) {
		const updatedLogs = Array.isArray(result) ? result : [result];
		const updatedEntries = updatedLogs.map(
			(entry) => ({ kind: 'fuel', entry }) satisfies EditableEntry
		);
		const editedFuelEntryKey =
			editingEntry?.kind === 'fuel'
				? getEditableEntryKey(editingEntry)
				: updatedEntries[0]
					? getEditableEntryKey(updatedEntries[0])
					: null;

		entriesError = '';
		deleteErrorText = '';
		armedDeleteEntryKey = null;
		upsertEditableEntries(updatedEntries, editedFuelEntryKey);
		refreshEntriesToken += 1;
	}

	function handleEditedFuelFeedbackComplete() {
		editingEntry = null;
		fuelEditTimelineVersion = 0;
	}

	function handleEditCancelled() {
		editingEntry = null;
		fuelEditTimelineVersion = 0;
	}

	function handleDeleteRequest(request: EditableEntry) {
		if (deletingEntryKey) {
			return;
		}

		deleteErrorText = '';
		armedDeleteEntryKey = getEditableEntryKey(request);
	}

	function handleDeleteCancel(request: EditableEntry) {
		if (deletingEntryKey) {
			return;
		}

		if (armedDeleteEntryKey === getEditableEntryKey(request)) {
			armedDeleteEntryKey = null;
		}
	}

	async function handleDeleteConfirm(request: EditableEntry) {
		if (deletingEntryKey) {
			return;
		}

		const entryKey = getEditableEntryKey(request);
		const postDeleteFocusTarget = getPostDeleteFocusTarget(entryKey);

		entriesError = '';
		deleteErrorText = '';
		deletingEntryKey = entryKey;

		try {
			if (request.kind === 'maintenance') {
				const result = await deleteExpense(request.entry.id);
				if (result.error) {
					deleteErrorText = 'Could not delete maintenance entry. Please try again.';
					return;
				}

				removeEditableEntry(entryKey);
			} else {
				const result = await deleteFuelLog(request.entry.id);
				if (result.error) {
					deleteErrorText = 'Could not delete fuel entry. Please try again.';
					return;
				}

				const updatedEntries = result.data.updatedLogs.map(
					(entry) => ({ kind: 'fuel', entry }) satisfies EditableEntry
				);

				removeEditableEntry(entryKey);
				applyEditableEntryUpdates(updatedEntries);
				refreshOpenFuelEditAfterFuelDeletion(request.entry.id, updatedEntries);
			}

			clearDeletedEntryState(entryKey);
			refreshEntriesToken += 1;
			await focusPostDeleteTarget(postDeleteFocusTarget);
		} finally {
			deletingEntryKey = null;
		}
	}

	onDestroy(() => {
		clearPinnedEntryTimeout();
	});
</script>

{#if !loading}
	{#if dbError}
		<div
			role="alert"
			class="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8 text-center"
		>
			<div class="flex flex-col items-center gap-2">
				<p class="text-lg font-semibold text-foreground">Could not load your vehicle</p>
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
	{:else if currentVehicle}
		<div class="space-y-6 px-4 pt-4">
			<header class="space-y-1">
				<h1 class="text-xl font-semibold text-foreground">{currentVehicle.name}</h1>
				<p class="text-sm text-muted-foreground">
					{currentVehicle.make}
					{currentVehicle.model}{currentVehicle.year ? ` · ${currentVehicle.year}` : ''}
				</p>
			</header>

			<section class="space-y-4">
				<div class="space-y-1">
					{#if editingFuelLog}
						<h2 class="text-lg font-semibold text-foreground">Editing fuel entry</h2>
						<p class="text-sm text-muted-foreground">
							Save your changes or cancel to return to a new maintenance entry.
						</p>
					{:else if editingExpense}
						<h2 class="text-lg font-semibold text-foreground">Editing maintenance entry</h2>
						<p class="text-sm text-muted-foreground">
							Save your changes or cancel to return to a new maintenance entry.
						</p>
					{/if}
				</div>

				{#key editingEntry ? getEditableEntryKey(editingEntry) : 'maintenance-create'}
					{#if editingFuelLog}
						<FuelEntryForm
							vehicleId={currentVehicle.id}
							mode="edit"
							initialFuelLog={editingFuelLog}
							timelineContextVersion={fuelEditTimelineVersion}
							onSave={handleEditedFuelSaved}
							onSuccessFeedbackComplete={handleEditedFuelFeedbackComplete}
							onCancel={handleEditCancelled}
						/>
					{:else if editingExpense}
						<MaintenanceForm
							vehicleId={currentVehicle.id}
							mode="edit"
							initialExpense={editingExpense}
							onSave={handleEditedMaintenanceSaved}
							onSuccessFeedbackComplete={handleEditedMaintenanceFeedbackComplete}
							onCancel={handleEditCancelled}
						/>
					{:else}
						<MaintenanceForm vehicleId={currentVehicle.id} onSave={handleCreatedMaintenanceSaved} />
					{/if}
				{/key}
			</section>

			{#if deleteErrorText || entriesError}
				<div role="alert" class="rounded-2xl border border-destructive/20 bg-destructive/10 p-4">
					<p class="text-sm text-destructive">{deleteErrorText || entriesError}</p>
				</div>
			{/if}

			<section aria-labelledby="maintenance-edit-entries-heading" class="space-y-4">
				<div class="flex items-center justify-between gap-3">
					<div>
						<h2 id="maintenance-edit-entries-heading" class="text-lg font-semibold text-foreground">
							Recent entries
						</h2>
						<p class="text-sm text-muted-foreground">
							Edit or delete fuel and maintenance records directly from this screen.
						</p>
					</div>
				</div>

				{#if sortedEditableEntries.length === 0}
					<div
						bind:this={emptyEntriesFocusTarget}
						role="group"
						tabindex="-1"
						aria-labelledby="maintenance-empty-state-title"
						aria-describedby="maintenance-empty-state-description"
						class="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center"
					>
						<p id="maintenance-empty-state-title" class="text-sm font-medium text-foreground">
							No saved entries yet
						</p>
						<p id="maintenance-empty-state-description" class="mt-1 text-sm text-muted-foreground">
							Fuel and maintenance records will appear here as soon as they are saved.
						</p>
					</div>
				{:else}
					<ul bind:this={entryListElement} class="space-y-3">
						{#each sortedEditableEntries as item (getEditableEntryKey(item))}
							<li>
								<EntryCard
									kind={item.kind}
									entry={item.entry}
									entryKey={getEditableEntryKey(item)}
									currency={settingsCtx.settings.currency}
									preferredFuelUnit={settingsCtx.settings.fuelUnit}
									editDisabled={editingEntry !== null || deletingEntryKey !== null}
									onEdit={handleEntryEditRequest}
									onDeleteRequest={handleDeleteRequest}
									onDeleteConfirm={handleDeleteConfirm}
									onDeleteCancel={handleDeleteCancel}
									deleteState={getDeleteState(item)}
									deleteDisabled={deletingEntryKey !== null &&
										deletingEntryKey !== getEditableEntryKey(item)}
								/>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>
	{:else}
		<div
			role="region"
			aria-label="Maintenance vehicle setup"
			class="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
		>
			<Wrench size={48} class="text-muted-foreground" aria-hidden="true" />
			<h1 class="text-2xl font-semibold text-foreground">No vehicle yet</h1>
			<p class="max-w-sm text-sm text-muted-foreground">
				Use the Fuel Entry flow to add your vehicle first, then come back here to log service and
				expense records.
			</p>
			<a
				href={resolve('/fuel-entry')}
				class="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
			>
				Go to Fuel Entry
			</a>
		</div>
	{/if}
{/if}
