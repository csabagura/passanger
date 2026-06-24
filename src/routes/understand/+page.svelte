<script lang="ts">
	import { resolve } from '$app/paths';
	import { getContext } from 'svelte';
	import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
	import UnderstandDashboard from '$lib/components/UnderstandDashboard.svelte';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';

	// Story 4.4: the Understand surface (FR-13/FR-14). A thin SHELL — exactly the Home `+page.svelte` →
	// `HomeDashboard` pattern (Story 3.3): read the vehicles context, render the no-vehicle empty state,
	// and on an active vehicle `{#key id}`-mount the flat UnderstandDashboard, which owns the liveQuery
	// reads + the four interactive charts + the ≤3 plain-language insights. There is no first-run create
	// flow here (Home owns that) — no vehicle just points the driver back to add one.
	const vehiclesCtx = getContext<VehiclesContext>('vehicles');

	const currentVehicle = $derived(vehiclesCtx.activeVehicle);
</script>

<svelte:head>
	<title>Understand | passanger</title>
</svelte:head>

{#if !vehiclesCtx.loaded}
	<!-- Vehicles loading — render nothing so the no-vehicle empty state can't flash before the async
	     read resolves. The dashboard's own cold-load skeleton covers the post-vehicle read. -->
{:else if currentVehicle}
	<!-- Keyed on the active vehicle id: a vehicle switch tears down the dashboard (releasing its
	     liveQuery subscriptions) and mounts a fresh one scoped to the new vehicle (AD-4). -->
	{#key currentVehicle.id}
		<UnderstandDashboard vehicleId={currentVehicle.id!} vehicleName={currentVehicle.name} />
	{/key}
{:else}
	<div class="px-4 pt-4">
		<div
			role="region"
			aria-label="No vehicle selected"
			class="rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center"
		>
			<BarChart3 size={40} class="mx-auto text-muted-foreground" aria-hidden="true" />
			<p class="mt-3 text-base font-semibold text-foreground">No vehicle yet</p>
			<p class="mt-1 text-sm text-muted-foreground">
				Add a vehicle to start tracking fuel and maintenance, and your trends will appear here.
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
