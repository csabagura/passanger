<script lang="ts">
	import { tick } from 'svelte';
	import { MAX_VEHICLES, VEHICLE_ID_STORAGE_KEY } from '$lib/config';
	import { getAllVehicles, deleteVehicle } from '$lib/db/repositories/vehicles';
	import { safeSetItem, safeRemoveItem } from '$lib/utils/vehicleStorage';
	import type { Vehicle } from '$lib/db/schema';
	import VehicleForm from './VehicleForm.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';

	type ViewState = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; vehicle: Vehicle };
	type DeleteState = 'idle' | 'armed' | 'loading';

	interface VehicleListManagerProps {
		activeVehicleId?: number | null;
		onActiveVehicleChange?: (id: number | null) => void;
	}

	let { activeVehicleId = null, onActiveVehicleChange }: VehicleListManagerProps = $props();

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

		if (wasActive) {
			if (vehicles.length > 0) {
				const newActiveId = vehicles[0].id;
				safeSetItem(VEHICLE_ID_STORAGE_KEY, String(newActiveId));
				onActiveVehicleChange?.(newActiveId);
			} else {
				safeRemoveItem(VEHICLE_ID_STORAGE_KEY);
				onActiveVehicleChange?.(null);
			}
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
						<Button
							variant="destructive"
							size="icon"
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
							<Button
								variant="destructive"
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
