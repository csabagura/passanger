<script lang="ts">
	import { tick } from 'svelte';
	import {
		getServiceRemindersForVehicle,
		deleteServiceReminder
	} from '$lib/db/repositories/serviceReminders';
	import type { ServiceReminder } from '$lib/db/schema';
	import { computeReminderStatus, type ReminderStatus } from '$lib/utils/serviceReminder';
	import ServiceReminderForm from './ServiceReminderForm.svelte';

	type ViewState =
		| { mode: 'list' }
		| { mode: 'create' }
		| { mode: 'edit'; reminder: ServiceReminder };
	type DeleteState = 'idle' | 'armed' | 'loading';

	interface Props {
		vehicleId: number;
		currentOdometer?: number;
		today?: Date;
	}

	let { vehicleId, currentOdometer = undefined, today = new Date() }: Props = $props();

	let reminders = $state<ServiceReminder[]>([]);
	let viewState = $state<ViewState>({ mode: 'list' });
	let deleteTarget = $state<ServiceReminder | null>(null);
	let deleteState = $state<DeleteState>('idle');
	let deleteError = $state('');
	let loading = $state(true);
	let loadError = $state('');

	let listContainerEl = $state<HTMLElement | null>(null);
	let addButtonEl = $state<HTMLButtonElement | null>(null);

	const deletePromptVisible = $derived(deleteState === 'armed' || deleteState === 'loading');

	const STATUS_STYLES: Record<ReminderStatus, { badge: string; label: string }> = {
		overdue: {
			badge: 'border-destructive/30 bg-destructive/10 text-destructive',
			label: 'Overdue'
		},
		'due-soon': { badge: 'border-amber-500/30 bg-amber-500/10 text-amber-600', label: 'Due soon' },
		ok: { badge: 'border-border bg-muted/40 text-muted-foreground', label: 'On track' }
	};

	async function loadReminders() {
		const result = await getServiceRemindersForVehicle(vehicleId);
		if (result.error) {
			loadError = 'Could not load reminders. Please try again.';
			return;
		}
		reminders = result.data;
		loadError = '';
	}

	async function init() {
		loading = true;
		await loadReminders();
		loading = false;
	}

	// Reload whenever the active vehicle changes.
	$effect(() => {
		// reference vehicleId so the effect re-runs on change
		void vehicleId;
		init();
	});

	function resetDeleteState() {
		deleteTarget = null;
		deleteState = 'idle';
		deleteError = '';
	}

	function handleCreateClick() {
		resetDeleteState();
		viewState = { mode: 'create' };
	}

	function handleEditClick(reminder: ServiceReminder) {
		resetDeleteState();
		viewState = { mode: 'edit', reminder };
	}

	async function handleSaveOrUpdate(reminder: ServiceReminder) {
		await loadReminders();
		viewState = { mode: 'list' };
		await tick();
		focusReminderOrAddButton(reminder.id);
	}

	function handleCancel() {
		viewState = { mode: 'list' };
	}

	function handleDeleteRequest(reminder: ServiceReminder) {
		if (deleteState === 'loading') return;
		deleteTarget = reminder;
		deleteState = 'armed';
		deleteError = '';
	}

	function handleDeleteCancel() {
		if (deleteState === 'loading') return;
		resetDeleteState();
	}

	async function handleDeleteConfirm() {
		if (!deleteTarget || deleteState === 'loading') return;
		deleteState = 'loading';
		deleteError = '';

		const deletedId = deleteTarget.id;
		const deletedIndex = reminders.findIndex((r) => r.id === deletedId);

		const result = await deleteServiceReminder(deletedId);
		if (result.error) {
			deleteError = 'Could not delete reminder. Please try again.';
			deleteState = 'armed';
			return;
		}

		deleteTarget = null;
		deleteState = 'idle';

		await loadReminders();
		await tick();
		if (reminders.length > 0) {
			const nextIndex = Math.min(deletedIndex, reminders.length - 1);
			focusReminderOrAddButton(reminders[nextIndex].id);
		} else {
			addButtonEl?.focus();
		}
	}

	function focusReminderOrAddButton(reminderId: number) {
		const el = listContainerEl?.querySelector<HTMLElement>(
			`[data-reminder-id="${reminderId}"] button`
		);
		if (el) {
			el.focus();
		} else {
			addButtonEl?.focus();
		}
	}
</script>

{#if viewState.mode === 'create'}
	<ServiceReminderForm {vehicleId} onSave={handleSaveOrUpdate} onCancel={handleCancel} />
{:else if viewState.mode === 'edit'}
	<ServiceReminderForm
		{vehicleId}
		onSave={handleSaveOrUpdate}
		initialReminder={viewState.reminder}
		onUpdate={handleSaveOrUpdate}
		onCancel={handleCancel}
	/>
{:else if loading}
	<p class="text-sm text-muted-foreground">Loading reminders…</p>
{:else if loadError}
	<p role="alert" class="text-sm text-destructive">{loadError}</p>
{:else if reminders.length === 0}
	<div class="space-y-3 text-center">
		<p class="text-sm text-muted-foreground">
			No reminders yet. Add one to track when maintenance is due.
		</p>
		<button
			type="button"
			onclick={handleCreateClick}
			bind:this={addButtonEl}
			class="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
		>
			+ Add reminder
		</button>
	</div>
{:else}
	<ul class="space-y-3" aria-label="Service reminders" bind:this={listContainerEl}>
		{#each reminders as reminder (reminder.id)}
			{@const status = computeReminderStatus(reminder, currentOdometer, today)}
			{@const styles = STATUS_STYLES[status.status]}
			{@const isDeleteTarget = deleteTarget?.id === reminder.id && deletePromptVisible}
			{@const deleteDialogId = `delete-reminder-dialog-${reminder.id}`}
			<li class="rounded-xl border border-border p-4" data-reminder-id={reminder.id}>
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-semibold text-foreground">{reminder.title}</span>
							<span
								class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium {styles.badge}"
							>
								{styles.label}
							</span>
						</div>
						<p class="mt-1 text-sm text-muted-foreground">{status.label}</p>
					</div>
					<div class="flex gap-2">
						<button
							type="button"
							onclick={() => handleEditClick(reminder)}
							aria-label="Edit {reminder.title}"
							class="min-h-11 min-w-11 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-foreground"
						>
							Edit
						</button>
						<button
							type="button"
							disabled={deletePromptVisible}
							onclick={() => handleDeleteRequest(reminder)}
							aria-label="Delete {reminder.title}"
							class="min-h-11 min-w-11 rounded-xl border border-destructive/20 px-3 py-2 text-sm font-semibold text-destructive disabled:cursor-not-allowed disabled:opacity-70"
						>
							Delete
						</button>
					</div>
				</div>

				{#if isDeleteTarget}
					<div
						role="alertdialog"
						aria-labelledby={deleteDialogId}
						class="mt-4 rounded-2xl border border-destructive/20 bg-destructive/10 p-4"
					>
						<p id={deleteDialogId} class="text-sm font-semibold text-destructive">
							Delete {reminder.title}? This reminder will be removed permanently.
						</p>

						{#if deleteError}
							<div
								role="alert"
								class="mt-3 rounded-xl border border-destructive/20 bg-background/80 p-3"
							>
								<p class="text-sm text-destructive">{deleteError}</p>
							</div>
						{/if}

						<div class="mt-3 flex flex-wrap justify-end gap-2">
							<button
								type="button"
								disabled={deleteState === 'loading'}
								onclick={handleDeleteCancel}
								class="rounded-xl border border-destructive/20 px-3 py-2 text-sm font-semibold text-destructive disabled:cursor-not-allowed disabled:opacity-70"
							>
								Cancel
							</button>
							<button
								type="button"
								disabled={deleteState === 'loading'}
								onclick={handleDeleteConfirm}
								class="rounded-xl bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-70"
							>
								{deleteState === 'loading' ? 'Deleting…' : 'Confirm delete'}
							</button>
						</div>
					</div>
				{/if}
			</li>
		{/each}
	</ul>

	<div class="mt-4">
		<button
			type="button"
			onclick={handleCreateClick}
			bind:this={addButtonEl}
			class="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
		>
			+ Add reminder
		</button>
	</div>
{/if}
