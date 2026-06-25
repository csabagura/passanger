<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { createLiveQuery } from '$lib/state/liveQuery.svelte';
	import { getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
	import {
		getServiceRemindersForVehicle,
		deleteServiceReminder
	} from '$lib/db/repositories/serviceReminders';
	import {
		computeReminderStatus,
		REMINDER_STATUS_PRESENTATION,
		type ReminderStatus
	} from '$lib/utils/serviceReminder';
	import { predictedDateView } from '$lib/utils/metrics/reminderPrediction';
	import { isFiniteNumber } from '$lib/utils/calculations';
	import ServiceReminderForm from '$lib/components/ServiceReminderForm.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import type { FuelLog, ServiceReminder } from '$lib/db/schema';

	interface Props {
		// A FIXED active-vehicle id for this component's lifetime — the Maintain shell wraps this in a
		// `{#key currentVehicle.id}` block, so a vehicle switch tears this instance down (onDestroy →
		// liveQuery.destroy) and mounts a fresh one (AD-4, mirrors Understand/Home).
		vehicleId: number;
		vehicleName?: string;
		// Injectable reference date for status + prediction (deterministic tests); real clock in prod.
		now?: Date;
	}

	let { vehicleId, vehicleName, now = new Date() }: Props = $props();

	// AD-4 reactive reads (mirror UnderstandDashboard): reminders AND fuel logs. Logging a fill-up
	// elsewhere re-derives currentOdometer + cadence here for free; a reminder edit re-emits the list.
	// `initial = undefined` distinguishes "not loaded yet" (→ skeleton) from "loaded empty" (→ no-data).
	const reminderQuery = createLiveQuery<ServiceReminder[]>(
		() => getServiceRemindersForVehicle(vehicleId).then((r) => r.data ?? []),
		undefined
	);
	const fuelQuery = createLiveQuery<FuelLog[]>(
		() => getAllFuelLogs(vehicleId).then((r) => r.data ?? []),
		undefined
	);

	onDestroy(() => {
		reminderQuery.destroy();
		fuelQuery.destroy();
	});

	// dbError checked FIRST: a rejected read never emits `current`, so `loading` would otherwise stay
	// true forever and trap the surface on the skeleton (the Understand error-state lesson).
	const dbError = $derived(Boolean(reminderQuery.error) || Boolean(fuelQuery.error));
	const loading = $derived(reminderQuery.current === undefined || fuelQuery.current === undefined);

	const reminders = $derived(reminderQuery.current ?? []);
	const fuelLogs = $derived(fuelQuery.current ?? []);

	// currentOdometer = max odometer across the vehicle's fuel logs (same definition as Up-Next /
	// Settings). A corrupt/legacy non-finite odometer is dropped (PREP-1) so it can't poison the max.
	const currentOdometer = $derived.by(() => {
		const usable = fuelLogs.map((log) => log.odometer).filter(isFiniteNumber);
		return usable.length === 0 ? undefined : Math.max(...usable);
	});

	// Most-urgent-first ordering (overdue → due-soon → ok), stable within group (OQ-3, matches Up-Next).
	const STATUS_RANK: Record<ReminderStatus, number> = { overdue: 0, 'due-soon': 1, ok: 2 };

	// Every reminder (incl. `ok`, unlike Home's Up-Next) with its computed status + predicted date.
	const rows = $derived(
		reminders
			.map((reminder, index) => ({
				reminder,
				status: computeReminderStatus(reminder, currentOdometer, now),
				dateView: predictedDateView(reminder, fuelLogs, currentOdometer, now),
				index
			}))
			.sort(
				(a, b) => STATUS_RANK[a.status.status] - STATUS_RANK[b.status.status] || a.index - b.index
			)
	);

	type ViewState =
		| { mode: 'list' }
		| { mode: 'create' }
		| { mode: 'edit'; reminder: ServiceReminder };
	type DeleteState = 'idle' | 'armed' | 'loading';

	let viewState = $state<ViewState>({ mode: 'list' });
	let deleteTarget = $state<ServiceReminder | null>(null);
	let deleteState = $state<DeleteState>('idle');
	let deleteError = $state('');

	let listContainerEl = $state<HTMLElement | null>(null);
	let addButtonEl = $state<HTMLElement | null>(null);
	// The reminder a save/update should return focus to, once its row has rendered. Set on save,
	// cleared by the focus-restore $effect below (see handleSaveOrUpdate for why a bare tick() is not
	// enough on the create path).
	let pendingFocusReminderId = $state<number | null>(null);

	const deletePromptVisible = $derived(deleteState === 'armed' || deleteState === 'loading');

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

	// The reminder list re-emits via liveQuery after the form's repo write (notifyDataChanged) — so we
	// only swap back to the list view; no manual reload (AD-4). That emission is ASYNC, so on a CREATE
	// the new row is not in the DOM yet here — a bare `tick()` + focus would miss it and fall through to
	// the Add button. Record the id and let the focus-restore $effect land focus once the row renders.
	function handleSaveOrUpdate(reminder: ServiceReminder) {
		viewState = { mode: 'list' };
		pendingFocusReminderId = reminder.id;
	}

	// Restore focus to a just-saved reminder's row once it has actually rendered. Reads `rows` so it
	// re-runs on the async liveQuery emit that follows a create/edit; one-shot (clears the pending id
	// when it lands). Only acts in list view with a pending id, so it never steals focus otherwise.
	$effect(() => {
		void rows;
		if (pendingFocusReminderId === null || viewState.mode !== 'list') return;
		const el = listContainerEl?.querySelector<HTMLElement>(
			`[data-reminder-id="${pendingFocusReminderId}"] button`
		);
		if (el) {
			el.focus();
			pendingFocusReminderId = null;
		}
	});

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

		const result = await deleteServiceReminder(deleteTarget.id);
		if (result.error) {
			deleteError = m.maintain_delete_error();
			deleteState = 'armed';
			return;
		}

		deleteTarget = null;
		deleteState = 'idle';
		// liveQuery re-emits the shortened list; move focus to a stable control (the deleted row is gone).
		await tick();
		addButtonEl?.focus();
	}
</script>

<div class="px-4 pt-4">
	<div class="space-y-6">
		<header class="space-y-1">
			<h1 class="text-xl font-semibold text-foreground">{m.maintain_heading()}</h1>
			{#if vehicleName}
				<p class="text-sm text-muted-foreground">
					{m.maintain_reminders_for({ vehicle: vehicleName })}
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					{m.maintain_subtitle_generic()}
				</p>
			{/if}
		</header>

		{#if dbError}
			<!-- DB-error takes precedence over loading (a rejected read never emits `current`). -->
			<div role="alert" class="flex flex-col items-center justify-center gap-4 p-8 text-center">
				<p class="text-lg font-semibold text-foreground">{m.maintain_error_heading()}</p>
				<p class="text-sm text-muted-foreground">
					{m.maintain_error_body()}
				</p>
				<a
					href={resolve('/export')}
					class="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
				>
					{m.maintain_export_cta()}
				</a>
			</div>
		{:else if viewState.mode === 'create'}
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
			<!-- Cold-load skeleton: hand-rolled motion-safe pulse (mirror Understand — NO shadcn, protects
			     NFR-4). aria-hidden shapes + a polite status sibling for screen readers. -->
			<p class="sr-only" role="status" aria-live="polite">{m.maintain_loading()}</p>
			<div aria-hidden="true" class="space-y-3">
				{#each [0, 1, 2] as block (block)}
					<div class="rounded-xl border border-border p-4">
						<div class="h-4 w-40 rounded bg-muted motion-safe:animate-pulse"></div>
						<div class="mt-2 h-3 w-28 rounded bg-muted motion-safe:animate-pulse"></div>
					</div>
				{/each}
			</div>
		{:else if rows.length === 0}
			<div
				role="region"
				aria-label={m.maintain_empty_region_label()}
				class="space-y-3 rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center"
			>
				<p class="text-base font-semibold text-foreground">{m.maintain_empty_heading()}</p>
				<p class="text-sm text-muted-foreground">
					{m.maintain_empty_body()}
				</p>
				<Button bind:ref={addButtonEl} onclick={handleCreateClick}
					>{m.maintain_add_reminder()}</Button
				>
			</div>
		{:else}
			<ul class="space-y-3" aria-label={m.maintain_list_label()} bind:this={listContainerEl}>
				{#each rows as row (row.reminder.id)}
					{@const styles = REMINDER_STATUS_PRESENTATION[row.status.status]}
					{@const isDeleteTarget = deleteTarget?.id === row.reminder.id && deletePromptVisible}
					{@const deleteDialogId = `delete-reminder-dialog-${row.reminder.id}`}
					<li class="rounded-xl border border-border p-4" data-reminder-id={row.reminder.id}>
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-semibold text-foreground">{row.reminder.title}</span>
									<!-- Status badge: a text label + colour (never colour-only — C-5/AC9), shipped tokens. -->
									<span
										class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium {styles.badge}"
									>
										{styles.label}
									</span>
								</div>
								<p class="mt-1 text-sm text-muted-foreground">{row.status.label}</p>
								{#if row.dateView.kind !== 'none'}
									<!-- Predicted date (FR-10/FR-12): an additional line under remaining distance/time. A
									     sufficient cadence shows "≈ due …"; an insufficient one shows the honest note. -->
									<p class="mt-0.5 text-sm text-muted-foreground">{row.dateView.text}</p>
								{/if}
							</div>
							<div class="flex gap-2">
								<Button
									variant="outline"
									size="icon"
									onclick={() => handleEditClick(row.reminder)}
									aria-label={m.maintain_edit_reminder_label({ title: row.reminder.title })}
								>
									{m.common_edit()}
								</Button>
								<!-- Outline + destructive TEXT (not the destructive fill variant): red-on-card meets the
							     4.5:1 AA floor, whereas `bg-destructive/10 text-destructive` is only ~3.86:1 (C-5/AC9). -->
								<Button
									variant="outline"
									size="icon"
									class="text-destructive hover:text-destructive"
									disabled={deletePromptVisible}
									onclick={() => handleDeleteRequest(row.reminder)}
									aria-label={m.maintain_delete_reminder_label({ title: row.reminder.title })}
								>
									{m.common_delete()}
								</Button>
							</div>
						</div>

						{#if isDeleteTarget}
							<div
								role="alertdialog"
								aria-labelledby={deleteDialogId}
								class="mt-4 rounded-2xl border border-destructive/20 bg-destructive/10 p-4"
							>
								<p id={deleteDialogId} class="text-sm font-semibold text-destructive">
									{m.maintain_delete_confirm({ title: row.reminder.title })}
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
									<Button
										variant="outline"
										disabled={deleteState === 'loading'}
										onclick={handleDeleteCancel}
									>
										{m.common_cancel()}
									</Button>
									<Button
										variant="destructive"
										disabled={deleteState === 'loading'}
										onclick={handleDeleteConfirm}
									>
										{deleteState === 'loading'
											? m.maintain_deleting()
											: m.maintain_delete_confirm_action()}
									</Button>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			<div class="mt-4">
				<Button bind:ref={addButtonEl} onclick={handleCreateClick}
					>{m.maintain_add_reminder()}</Button
				>
			</div>
		{/if}
	</div>
</div>
