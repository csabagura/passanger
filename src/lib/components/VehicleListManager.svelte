<script lang="ts">
	import { tick, getContext } from 'svelte';
	import { MAX_VEHICLES } from '$lib/config';
	import {
		getAllVehicles,
		getArchivedVehicles,
		archiveVehicle,
		restoreVehicle,
		deleteVehicle
	} from '$lib/db/repositories/vehicles';
	import type { Vehicle } from '$lib/db/schema';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';
	import VehicleForm from './VehicleForm.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';

	// H12: the single existing propagation channel for vehicle state (mirrors ImportStepConfirm's
	// already-correct post-mutation reconciliation) — every CRUD path here must reconcile it, not just
	// this component's own local list, so AppHeader/Fab/CaptureSheet/etc. see the change same-tab.
	const vehiclesContext = getContext<VehiclesContext>('vehicles');

	type ViewState = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; vehicle: Vehicle };
	type ActionState = 'idle' | 'armed' | 'loading';

	interface VehicleListManagerProps {
		activeVehicleId?: number | null;
	}

	let { activeVehicleId = null }: VehicleListManagerProps = $props();

	// Story 9.2: the active list and the archived list are loaded separately (getAllVehicles is now
	// the active-only funnel; getArchivedVehicles is its sibling). This component owns BOTH lists and
	// reconciles the shared vehicles context after every mutation (H12 dual-list discipline).
	let vehicles = $state<Vehicle[]>([]);
	let archivedVehicles = $state<Vehicle[]>([]);
	let vehicleCount = $state(0);
	let viewState = $state<ViewState>({ mode: 'list' });
	let loading = $state(true);
	let loadError = $state('');

	// Archive confirmation (default destructive action on an ACTIVE vehicle — reversible).
	let archiveTarget = $state<Vehicle | null>(null);
	let archiveState = $state<ActionState>('idle');
	let archiveError = $state('');

	// Permanent-delete confirmation (the only data-destroying path — reachable from the Archived list).
	let purgeTarget = $state<Vehicle | null>(null);
	let purgeState = $state<ActionState>('idle');
	let purgeError = $state('');

	// Restore is non-destructive → no confirmation; just a per-row busy flag.
	let restoringId = $state<number | null>(null);
	let restoreError = $state('');

	let listContainerEl = $state<HTMLElement | null>(null);
	let addButtonEl = $state<HTMLElement | null>(null);

	const archivePromptVisible = $derived(archiveState === 'armed' || archiveState === 'loading');
	const purgePromptVisible = $derived(purgeState === 'armed' || purgeState === 'loading');
	const canAddVehicle = $derived(vehicleCount < MAX_VEHICLES);

	async function loadVehicles() {
		const [activeResult, archivedResult] = await Promise.all([
			getAllVehicles(),
			getArchivedVehicles()
		]);
		if (activeResult.error || archivedResult.error) {
			loadError = m.vehiclelist_error_load();
			return;
		}
		vehicles = activeResult.data;
		vehicleCount = activeResult.data.length;
		archivedVehicles = archivedResult.data;
		loadError = '';
	}

	async function init() {
		loading = true;
		await loadVehicles();
		loading = false;
	}

	init();

	function resetActionState() {
		archiveTarget = null;
		archiveState = 'idle';
		archiveError = '';
		purgeTarget = null;
		purgeState = 'idle';
		purgeError = '';
		restoreError = '';
	}

	function handleCreateClick() {
		resetActionState();
		viewState = { mode: 'create' };
	}

	function handleEditClick(vehicle: Vehicle) {
		resetActionState();
		viewState = { mode: 'edit', vehicle };
	}

	async function handleSaveOrUpdate(vehicle: Vehicle) {
		await loadVehicles();
		// H12: reconcile the layout's shared vehicles context after the local lists reload, so
		// AppHeader/Fab/CaptureSheet (and Settings' own display) see the create/edit in the same tab.
		await vehiclesContext.refreshVehicles();
		viewState = { mode: 'list' };
		await tick();
		focusVehicleOrAddButton(vehicle.id);
	}

	function handleCancel() {
		viewState = { mode: 'list' };
	}

	// --- Archive (active row) ---------------------------------------------------------------------

	function handleArchiveRequest(vehicle: Vehicle) {
		if (archiveState === 'loading') return;
		archiveTarget = vehicle;
		archiveState = 'armed';
		archiveError = '';
	}

	function handleArchiveCancel() {
		if (archiveState === 'loading') return;
		archiveTarget = null;
		archiveState = 'idle';
		archiveError = '';
	}

	async function handleArchiveConfirm() {
		if (!archiveTarget || archiveState === 'loading') return;
		archiveState = 'loading';
		archiveError = '';

		const archivedId = archiveTarget.id;
		const archivedIndex = vehicles.findIndex((v) => v.id === archivedId);

		const result = await archiveVehicle(archivedId);
		if (result.error) {
			archiveError = m.vehiclelist_error_archive();
			archiveState = 'armed';
			return;
		}

		archiveTarget = null;
		archiveState = 'idle';

		await loadVehicles();
		// Single owner for fallback active-vehicle selection: refreshVehicles() reconciles the shared
		// context (now missing the just-archived vehicle), and the layout's S19 effect alone re-points
		// activeVehicleId if the archived vehicle was the active one (never this component — review 8.6).
		await vehiclesContext.refreshVehicles();

		await tick();
		if (vehicles.length > 0) {
			const nextIndex = Math.min(archivedIndex, vehicles.length - 1);
			focusVehicleOrAddButton(vehicles[nextIndex].id);
		} else {
			addButtonEl?.focus();
		}
	}

	// --- Restore (archived row) -------------------------------------------------------------------

	async function handleRestore(vehicle: Vehicle) {
		if (restoringId !== null) return;
		restoringId = vehicle.id;
		restoreError = '';

		const result = await restoreVehicle(vehicle.id);
		restoringId = null;
		if (result.error) {
			restoreError = m.vehiclelist_error_restore();
			return;
		}

		await loadVehicles();
		await vehiclesContext.refreshVehicles();
		await tick();
		focusVehicleOrAddButton(vehicle.id);
	}

	// --- Permanent delete / purge (archived row) --------------------------------------------------

	function handlePurgeRequest(vehicle: Vehicle) {
		if (purgeState === 'loading') return;
		purgeTarget = vehicle;
		purgeState = 'armed';
		purgeError = '';
	}

	function handlePurgeCancel() {
		if (purgeState === 'loading') return;
		purgeTarget = null;
		purgeState = 'idle';
		purgeError = '';
	}

	async function handlePurgeConfirm() {
		if (!purgeTarget || purgeState === 'loading') return;
		purgeState = 'loading';
		purgeError = '';

		const result = await deleteVehicle(purgeTarget.id);
		if (result.error) {
			purgeError = m.vehiclelist_error_delete();
			purgeState = 'armed';
			return;
		}

		purgeTarget = null;
		purgeState = 'idle';

		await loadVehicles();
		// A purged vehicle was already archived (never active), so no S19 re-point is needed — but we
		// still reconcile the shared context for consistency with the H12 discipline.
		await vehiclesContext.refreshVehicles();
		await tick();
		addButtonEl?.focus();
	}

	function focusVehicleOrAddButton(vehicleId: number) {
		const el = listContainerEl?.querySelector<HTMLElement>(
			`[data-vehicle-id="${vehicleId}"] button`
		);
		if (el) {
			el.focus();
		} else {
			addButtonEl?.focus();
		}
	}
</script>

{#if viewState.mode === 'create'}
	<VehicleForm onSave={handleSaveOrUpdate} onCancel={handleCancel} />
{:else if viewState.mode === 'edit'}
	<VehicleForm
		onSave={handleSaveOrUpdate}
		initialVehicle={viewState.vehicle}
		onUpdate={handleSaveOrUpdate}
		onCancel={handleCancel}
	/>
{:else if loading}
	<p class="text-sm text-muted-foreground">{m.vehiclelist_loading()}</p>
{:else if loadError}
	<p role="alert" class="text-sm text-destructive">{loadError}</p>
{:else}
	{#if vehicles.length === 0}
		<div class="space-y-3 text-center">
			<p class="text-sm text-muted-foreground">
				{m.vehiclelist_empty()}
			</p>
			<Button bind:ref={addButtonEl} onclick={handleCreateClick}
				>+ {m.vehiclelist_add_vehicle()}</Button
			>
		</div>
	{:else}
		<ul class="space-y-3" aria-label={m.vehiclelist_list_label()} bind:this={listContainerEl}>
			{#each vehicles as vehicle (vehicle.id)}
				{@const isActive = activeVehicleId === vehicle.id}
				{@const isArchiveTarget = archiveTarget?.id === vehicle.id && archivePromptVisible}
				{@const archiveDialogId = `archive-dialog-${vehicle.id}`}
				<li
					class="rounded-xl border p-4 {isActive ? 'border-accent' : 'border-border'}"
					aria-current={isActive ? 'true' : undefined}
					data-vehicle-id={vehicle.id}
				>
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								{#if isActive}
									<span
										class="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-accent"
										aria-hidden="true"
									></span>
								{/if}
								<span class="font-semibold text-foreground">{vehicle.name}</span>
								{#if isActive}
									<span class="text-xs text-accent">{m.vehiclelist_active()}</span>
								{/if}
							</div>
							<p class="text-sm text-muted-foreground">
								{vehicle.make}
								{vehicle.model}{vehicle.year ? ` · ${vehicle.year}` : ''}
							</p>
						</div>
						<div class="flex gap-2">
							<Button
								variant="outline"
								size="icon"
								onclick={() => handleEditClick(vehicle)}
								aria-label={m.vehiclelist_edit_label({ name: vehicle.name })}
							>
								{m.common_edit()}
							</Button>
							<Button
								variant="outline"
								size="icon"
								disabled={archivePromptVisible}
								onclick={() => handleArchiveRequest(vehicle)}
								aria-label={m.vehiclelist_archive_label({ name: vehicle.name })}
							>
								{m.vehiclelist_archive()}
							</Button>
						</div>
					</div>

					{#if isArchiveTarget}
						<div
							role="alertdialog"
							aria-labelledby={archiveDialogId}
							class="mt-4 rounded-2xl border border-border bg-muted/40 p-4"
						>
							<p id={archiveDialogId} class="text-sm font-semibold text-foreground">
								{m.vehiclelist_archive_confirm({ name: vehicle.name })}
							</p>

							{#if archiveError}
								<div
									role="alert"
									class="mt-3 rounded-xl border border-destructive/20 bg-background/80 p-3"
								>
									<p class="text-sm text-destructive">{archiveError}</p>
								</div>
							{/if}

							<div class="mt-3 flex flex-wrap justify-end gap-2">
								<Button
									variant="outline"
									disabled={archiveState === 'loading'}
									onclick={handleArchiveCancel}
								>
									{m.common_cancel()}
								</Button>
								<Button disabled={archiveState === 'loading'} onclick={handleArchiveConfirm}>
									{archiveState === 'loading'
										? m.vehiclelist_archive_confirm_busy()
										: m.vehiclelist_archive_confirm_button()}
								</Button>
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		<div class="mt-4 space-y-2">
			{#if canAddVehicle}
				<Button bind:ref={addButtonEl} onclick={handleCreateClick}
					>+ {m.vehiclelist_add_vehicle()}</Button
				>
			{:else}
				<p class="text-sm text-muted-foreground">
					{m.vehiclelist_limit_reached({ max: MAX_VEHICLES })}
				</p>
			{/if}
			<p class="text-sm text-muted-foreground">
				{m.vehiclelist_count({ count: vehicleCount, max: MAX_VEHICLES })}
			</p>
		</div>
	{/if}

	{#if archivedVehicles.length > 0}
		<section class="mt-8 space-y-3">
			<div class="space-y-1">
				<h3 class="text-sm font-semibold text-foreground">{m.vehiclelist_archived_heading()}</h3>
				<p class="text-xs text-muted-foreground">{m.vehiclelist_archived_hint()}</p>
			</div>

			{#if restoreError}
				<div role="alert" class="rounded-xl border border-destructive/20 bg-background/80 p-3">
					<p class="text-sm text-destructive">{restoreError}</p>
				</div>
			{/if}

			<ul class="space-y-3" aria-label={m.vehiclelist_archived_list_label()}>
				{#each archivedVehicles as vehicle (vehicle.id)}
					{@const isPurgeTarget = purgeTarget?.id === vehicle.id && purgePromptVisible}
					{@const purgeDialogId = `purge-dialog-${vehicle.id}`}
					<li class="rounded-xl border border-border bg-muted/20 p-4" data-vehicle-id={vehicle.id}>
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0 flex-1">
								<span class="font-semibold text-muted-foreground">{vehicle.name}</span>
								<p class="text-sm text-muted-foreground">
									{vehicle.make}
									{vehicle.model}{vehicle.year ? ` · ${vehicle.year}` : ''}
								</p>
							</div>
							<div class="flex gap-2">
								<Button
									variant="outline"
									disabled={restoringId === vehicle.id || purgePromptVisible}
									onclick={() => handleRestore(vehicle)}
									aria-label={m.vehiclelist_restore_label({ name: vehicle.name })}
								>
									{restoringId === vehicle.id
										? m.vehiclelist_restore_busy()
										: m.vehiclelist_restore()}
								</Button>
								<!-- AA contrast (Story 6.3): outline + destructive TEXT, not the /10 fill. -->
								<Button
									variant="outline"
									class="text-destructive hover:text-destructive"
									disabled={purgePromptVisible || restoringId === vehicle.id}
									onclick={() => handlePurgeRequest(vehicle)}
									aria-label={m.vehiclelist_delete_label({ name: vehicle.name })}
								>
									{m.vehiclelist_delete_permanently()}
								</Button>
							</div>
						</div>

						{#if isPurgeTarget}
							<div
								role="alertdialog"
								aria-labelledby={purgeDialogId}
								class="mt-4 rounded-2xl border border-destructive/20 bg-destructive/10 p-4"
							>
								<p id={purgeDialogId} class="text-sm font-semibold text-destructive">
									{m.vehiclelist_delete_confirm({ name: vehicle.name })}
								</p>

								{#if purgeError}
									<div
										role="alert"
										class="mt-3 rounded-xl border border-destructive/20 bg-background/80 p-3"
									>
										<p class="text-sm text-destructive">{purgeError}</p>
									</div>
								{/if}

								<div class="mt-3 flex flex-wrap justify-end gap-2">
									<Button
										variant="outline"
										disabled={purgeState === 'loading'}
										onclick={handlePurgeCancel}
									>
										{m.common_cancel()}
									</Button>
									<Button
										variant="outline"
										class="text-destructive hover:text-destructive"
										disabled={purgeState === 'loading'}
										onclick={handlePurgeConfirm}
									>
										{purgeState === 'loading'
											? m.vehiclelist_delete_confirm_busy()
											: m.vehiclelist_delete_confirm_button()}
									</Button>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}
