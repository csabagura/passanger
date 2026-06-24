<script lang="ts">
	import { resolve } from '$app/paths';
	import { getContext } from 'svelte';
	import Wrench from '@lucide/svelte/icons/wrench';
	import MaintainDashboard from '$lib/components/MaintainDashboard.svelte';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';

	// Story 4.5: the Maintain surface (AD-3). A thin SHELL — exactly the Understand `+page.svelte` →
	// dashboard pattern: read the vehicles context, render the no-vehicle empty state, and on an active
	// vehicle `{#key id}`-mount the flat MaintainDashboard, which owns the liveQuery reads (reminders +
	// fuel logs) + the all-reminders list with predicted dates + CRUD. Reminders moved here out of
	// Settings (DEC-16). No first-run create flow here (Home owns that) — no vehicle points back to add one.
	const vehiclesCtx = getContext<VehiclesContext>('vehicles');

	const currentVehicle = $derived(vehiclesCtx.activeVehicle);
</script>

<svelte:head>
	<title>Maintain | passanger</title>
</svelte:head>

{#if !vehiclesCtx.loaded}
	<!-- Vehicles loading — render nothing so the no-vehicle empty state can't flash before the async
	     read resolves. The dashboard's own cold-load skeleton covers the post-vehicle read. -->
{:else if currentVehicle}
	<!-- Keyed on the active vehicle id: a vehicle switch tears down the dashboard (releasing its
	     liveQuery subscriptions) and mounts a fresh one scoped to the new vehicle (AD-4). -->
	{#key currentVehicle.id}
		<MaintainDashboard vehicleId={currentVehicle.id!} vehicleName={currentVehicle.name} />
	{/key}
{:else}
	<div class="px-4 pt-4">
		<div
			role="region"
			aria-label="No vehicle selected"
			class="rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center"
		>
			<Wrench size={40} class="mx-auto text-muted-foreground" aria-hidden="true" />
			<p class="mt-3 text-base font-semibold text-foreground">No vehicle yet</p>
			<p class="mt-1 text-sm text-muted-foreground">
				Add a vehicle to start tracking service reminders, and they'll appear here.
			</p>
			<a
				href={resolve('/')}
				class="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
			>
				Add a vehicle
			</a>
		</div>
	</div>
{/if}
