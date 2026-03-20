<script lang="ts">
	import Car from '@lucide/svelte/icons/car';
	import { getContext } from 'svelte';
	import VehicleForm from '$lib/components/VehicleForm.svelte';
	import FuelEntryForm from '$lib/components/FuelEntryForm.svelte';
	import MaintenanceForm from '$lib/components/MaintenanceForm.svelte';
	import InstallPrompt from '$lib/components/InstallPrompt.svelte';
	import OnboardingSurvey from '$lib/components/OnboardingSurvey.svelte';
	import { resolve } from '$app/paths';
	import type { Vehicle } from '$lib/db/schema';
	import type { InstallPromptContext } from '$lib/utils/installPrompt';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';
	import {
		shouldShowOnboardingSurvey,
		saveOnboardingSurveyResponse,
		dismissOnboardingSurvey
	} from '$lib/utils/onboardingSurvey';
	import type { OnboardingSurveyResponse } from '$lib/utils/onboardingSurvey';

	type LogMode = 'fuel' | 'service';

	const vehiclesCtx = getContext<VehiclesContext>('vehicles');

	let currentVehicle = $derived(vehiclesCtx.activeVehicle);
	let showVehicleForm = $state(false);
	let addVehicleButton = $state<HTMLButtonElement | undefined>(undefined);
	let firstSuccessfulCreateSave = $state(false);
	let installPromptHiddenByInteraction = $state(false);
	let activeMode = $state<LogMode>('fuel');
	let onboardingSurveyEligible = $state(shouldShowOnboardingSurvey());

	const installPromptCtx = getContext<InstallPromptContext>('installPrompt');
	const showInstallPrompt = $derived(
		firstSuccessfulCreateSave && !installPromptHiddenByInteraction && installPromptCtx.canShowPrompt
	);
	const showOnboardingSurvey = $derived(
		firstSuccessfulCreateSave && !showInstallPrompt && onboardingSurveyEligible
	);

	$effect(() => {
		if (!showVehicleForm && !currentVehicle && addVehicleButton) {
			addVehicleButton.focus();
		}
	});

	function handleVehicleSaved(vehicle: Vehicle) {
		vehiclesCtx.switchVehicle(vehicle.id!);
		vehiclesCtx.refreshVehicles();
		showVehicleForm = false;
	}

	function handleFirstCreateSave() {
		firstSuccessfulCreateSave = true;
		installPromptHiddenByInteraction = false;
	}

	function handleSurveySubmit(response: OnboardingSurveyResponse) {
		saveOnboardingSurveyResponse(response);
		onboardingSurveyEligible = false;
	}

	function handleSurveyDismiss() {
		dismissOnboardingSurvey();
		onboardingSurveyEligible = false;
	}

	function handleInstallPromptDismiss() {
		installPromptHiddenByInteraction = true;
		firstSuccessfulCreateSave = false;
		installPromptCtx.dismissPrompt();
	}

	async function handleInstallPromptInstall() {
		installPromptHiddenByInteraction = true;
		firstSuccessfulCreateSave = false;
		await installPromptCtx.requestInstall();
	}

	function handleModeKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
			event.preventDefault();
			activeMode = activeMode === 'fuel' ? 'service' : 'fuel';
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
			event.preventDefault();
			activeMode = activeMode === 'service' ? 'fuel' : 'service';
		}
	}
</script>

<svelte:head>
	<title>Log | passanger</title>
</svelte:head>

{#if !vehiclesCtx.loaded}
	<!-- Vehicles loading — show nothing to avoid flash -->
{:else if showVehicleForm}
	<VehicleForm onSave={handleVehicleSaved} />
{:else if currentVehicle}
	<div class="px-4 pt-4">
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			role="radiogroup"
			aria-label="Log mode"
			class="mb-4 flex rounded-xl border border-border bg-muted/40 p-1"
			onkeydown={handleModeKeydown}
		>
			<button
				type="button"
				role="radio"
				aria-checked={activeMode === 'fuel'}
				tabindex={activeMode === 'fuel' ? 0 : -1}
				onclick={() => (activeMode = 'fuel')}
				class="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors {activeMode === 'fuel'
					? 'bg-card text-foreground shadow-sm'
					: 'text-muted-foreground'}"
			>
				Fuel
			</button>
			<button
				type="button"
				role="radio"
				aria-checked={activeMode === 'service'}
				tabindex={activeMode === 'service' ? 0 : -1}
				onclick={() => (activeMode = 'service')}
				class="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors {activeMode === 'service'
					? 'bg-card text-foreground shadow-sm'
					: 'text-muted-foreground'}"
			>
				Service
			</button>
		</div>

		<div class="space-y-4">
			{#if activeMode === 'fuel'}
				<FuelEntryForm
					vehicleId={currentVehicle.id}
					onSave={() => {}}
					onFirstCreateSave={handleFirstCreateSave}
				>
					{#snippet successRegionAddon()}
						{#if showInstallPrompt}
							<InstallPrompt
								platform={installPromptCtx.platform}
								canTriggerNativeInstall={installPromptCtx.canTriggerNativeInstall}
								onInstall={handleInstallPromptInstall}
								onDismiss={handleInstallPromptDismiss}
							/>
						{/if}
						{#if showOnboardingSurvey}
							<OnboardingSurvey
								onSubmit={handleSurveySubmit}
								onDismiss={handleSurveyDismiss}
							/>
						{/if}
					{/snippet}
				</FuelEntryForm>
			{:else}
				<MaintenanceForm
					vehicleId={currentVehicle.id}
					onSave={() => {}}
					onFirstCreateSave={handleFirstCreateSave}
				/>
				{#if showInstallPrompt}
					<InstallPrompt
						platform={installPromptCtx.platform}
						canTriggerNativeInstall={installPromptCtx.canTriggerNativeInstall}
						onInstall={handleInstallPromptInstall}
						onDismiss={handleInstallPromptDismiss}
					/>
				{/if}
				{#if showOnboardingSurvey}
					<OnboardingSurvey
						onSubmit={handleSurveySubmit}
						onDismiss={handleSurveyDismiss}
					/>
				{/if}
			{/if}
		</div>
	</div>
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
