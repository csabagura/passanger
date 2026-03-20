<script lang="ts">
	import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
	import { getContext } from 'svelte';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';

	const vehiclesCtx = getContext<VehiclesContext>('vehicles');
	const currentVehicle = $derived(vehiclesCtx.activeVehicle);
</script>

<svelte:head>
	<title>Analytics | passanger</title>
</svelte:head>

<div
	role="region"
	aria-label="Analytics empty state"
	class="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
>
	<BarChart3 size={48} class="text-muted-foreground" aria-hidden="true" />
	<h1 class="text-xl font-semibold text-foreground">Analytics</h1>
	{#if currentVehicle}
		<p class="text-sm text-muted-foreground">{currentVehicle.name}</p>
	{/if}
	<p class="text-sm text-muted-foreground">
		Charts and trend insights are coming soon. Your fuel and maintenance data will be analysed
		here.
	</p>
</div>
