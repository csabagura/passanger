<script lang="ts">
	import { tick, getContext } from 'svelte';
	import { MAX_VEHICLES } from '$lib/config';
	import { getAllVehicles, deleteVehicle } from '$lib/db/repositories/vehicles';
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
	type DeleteState = 'idle' | 'armed' | 'loading';

	interface VehicleListManagerProps {
		activeVehicleId?: number | null;
	}

	let { activeVehicleId = null }: VehicleListManagerProps = $props();

	let vehicles = $state<Vehicle[]>([]);
	let vehicleCount = $state(0);
	let viewState = $state<ViewState>({ mode: 'list' });
	let deleteTarget = $state<Vehicle | null>(null);
	let deleteState = $state<DeleteState>('idle');
	let deleteError = $state('');
	let loading = $state(true);
	let loadError = $state('');

	let listContainerEl = $state<HTMLElement | null>(null);
	let addButtonEl = $state<HTMLElement | null>(null);

	const deletePromptVisible = $derived(deleteState === 'armed' || deleteState === 'loading');
	const canAddVehicle = $derived(vehicleCount < MAX_VEHICLES);

	async function loadVehicles() {
		const result = await getAllVehicles();
		if (result.error) {
			loadError = m.vehiclelist_error_load();
			return;
		}
		vehicles = result.data;
		vehicleCount = result.data.length;
		loadError = '';
	}

	async function init() {
		loading = true;
		await loadVehicles();
		loading = false;
	}

	init();

	function resetDeleteState() {
		deleteTarget = null;
		deleteState = 'idle';
		deleteError = '';
	}

	function handleCreateClick() {
		resetDeleteState();
		viewState = { mode: 'create' };
	}

	function handleEditClick(vehicle: Vehicle) {
		resetDeleteState();
		viewState = { mode: 'edit', vehicle };
	}

	async function handleSaveOrUpdate(vehicle: Vehicle) {
		await loadVehicles();
		// H12: reconcile the layout's shared vehicles context after the local list reloads, so
		// AppHeader/Fab/CaptureSheet (and Settings' own display, once it reads the context directly)
		// see the create/edit in the same tab.
		await vehiclesContext.refreshVehicles();
		viewState = { mode: 'list' };
		await tick();
		focusVehicleOrAddButton(vehicle.id);
	}

	function handleCancel() {
		viewState = { mode: 'list' };
	}

	function handleDeleteRequest(vehicle: Vehicle) {
		if (deleteState === 'loading') return;
		deleteTarget = vehicle;
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
		const deletedIndex = vehicles.findIndex((v) => v.id === deletedId);

		const result = await deleteVehicle(deletedId);
		if (result.error) {
			deleteError = m.vehiclelist_error_delete();
			deleteState = 'armed';
			return;
		}

		const wasActive = activeVehicleId === deletedId;

		deleteTarget = null;
		deleteState = 'idle';

		await loadVehicles();
		// H12: reconcile the shared context BEFORE deciding the active-vehicle fallback below, so
		// switchVehicle's write goes through the layout's own vehicles array (kept in sync with this
		// component's local reload) rather than a stale one.
		await vehiclesContext.refreshVehicles();

		if (wasActive && vehicles.length > 0) {
			// Routes the write through the layout's existing switchVehicle (which owns the
			// VEHICLE_ID_STORAGE_KEY write) — this component no longer writes that key directly.
			// No vehicles left: intentionally do nothing — switchVehicle needs an id to switch to, and
			// activeVehicleId now comes from the context (via the parent), which readStoredVehicleId /
			// the layout's own load path already governs.
			vehiclesContext.switchVehicle(vehicles[0].id);
		}

		await tick();
		// Focus next vehicle in list, or previous, or add button
		if (vehicles.length > 0) {
			const nextIndex = Math.min(deletedIndex, vehicles.length - 1);
			focusVehicleOrAddButton(vehicles[nextIndex].id);
		} else {
			addButtonEl?.focus();
		}
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
{:else if vehicles.length === 0}
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
			{@const isDeleteTarget = deleteTarget?.id === vehicle.id && deletePromptVisible}
			{@const deleteDialogId = `delete-dialog-${vehicle.id}`}
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
						<!-- AA contrast (Story 6.3 / AC5): outline + destructive TEXT (~4.5:1 on card),
						     not the bg-destructive/10 fill (~3.86:1). Mirrors the Maintain delete trigger. -->
						<Button
							variant="outline"
							size="icon"
							class="text-destructive hover:text-destructive"
							disabled={deletePromptVisible}
							onclick={() => handleDeleteRequest(vehicle)}
							aria-label={m.vehiclelist_delete_label({ name: vehicle.name })}
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
							{m.vehiclelist_delete_confirm({ name: vehicle.name })}
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
							<!-- AA contrast (Story 6.3 / AC5): outline + destructive TEXT (~4.5:1 on card),
							     not the bg-destructive/10 fill (~3.86:1). -->
							<Button
								variant="outline"
								class="text-destructive hover:text-destructive"
								disabled={deleteState === 'loading'}
								onclick={handleDeleteConfirm}
							>
								{deleteState === 'loading'
									? m.vehiclelist_delete_confirm_busy()
									: m.vehiclelist_delete_confirm_button()}
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
