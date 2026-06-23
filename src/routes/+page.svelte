<script lang="ts">
	import Car from '@lucide/svelte/icons/car';
	import { getContext } from 'svelte';
	import VehicleForm from '$lib/components/VehicleForm.svelte';
	import HomeDashboard from '$lib/components/HomeDashboard.svelte';
	import type { Vehicle } from '$lib/db/schema';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';

	// Story 3.3: Home is the default surface (`/`). It is a SHELL — the no-vehicle first-run (relocated
	// from the retired /log) plus the glanceable dashboard. Capture happens in the global sheet via the
	// FAB; the first-Capture install/survey gate is owned by the layout (AC-7). The rich Hero/Up-Next
	// content is Stories 3.4/3.5 — this renders a read-only base cost stat, recency, and the reminders
	// card slot only.
	const vehiclesCtx = getContext<VehiclesContext>('vehicles');

	const currentVehicle = $derived(vehiclesCtx.activeVehicle);
	let showVehicleForm = $state(false);
	let addVehicleButton = $state<HTMLButtonElement | undefined>(undefined);

	// Focus the add-vehicle CTA when it (re)appears, mirroring the /log first-run behavior. Gated on
	// `loaded` below so it never fires before the async vehicle read resolves.
	$effect(() => {
		if (vehiclesCtx.loaded && !showVehicleForm && !currentVehicle && addVehicleButton) {
			addVehicleButton.focus();
		}
	});

	function handleVehicleSaved(vehicle: Vehicle) {
		vehiclesCtx.switchVehicle(vehicle.id!);
		vehiclesCtx.refreshVehicles();
		showVehicleForm = false;
	}
</script>

<svelte:head>
	<title>Home | passanger</title>
</svelte:head>

{#if !vehiclesCtx.loaded}
	<!-- Vehicles loading — render nothing so the no-vehicle CTA can't flash before the async read
	     resolves (AC-3). The dashboard's own cold-load skeleton covers the post-vehicle read. -->
{:else if showVehicleForm}
	<VehicleForm onSave={handleVehicleSaved} />
{:else if currentVehicle}
	<!-- Keyed on the active vehicle id: a vehicle switch tears down the dashboard (releasing its
	     liveQuery subscriptions) and mounts a fresh one scoped to the new vehicle (AC-4). -->
	{#key currentVehicle.id}
		<HomeDashboard vehicleId={currentVehicle.id!} vehicleName={currentVehicle.name} />
	{/key}
{:else}
	<div
		role="region"
		aria-label="Vehicle setup"
		class="flex flex-col items-center gap-4 p-8 text-center"
	>
		<Car size={48} class="text-muted-foreground" aria-hidden="true" />
		<h1 class="text-xl font-semibold text-foreground">No vehicle yet</h1>
		<p class="text-sm text-muted-foreground">Your entries will be tied to this vehicle</p>
		<button
			bind:this={addVehicleButton}
			onclick={() => (showVehicleForm = true)}
			class="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
		>
			Add your vehicle to get started
		</button>
	</div>
{/if}
