<!--
	AC4: Draft state for this page is preserved via `src/lib/stores/draft.ts` (fuelDraft).
	Module-level plain objects survive all tab-navigation patterns (forward, backward, repeated)
	because the module is never re-evaluated between navigations.
	Story 1.6 will bind form fields to `fuelDraft` and call `clearFuelDraft()` on submit.
	No snapshot export is needed — SvelteKit snapshots only restore on browser-back (popstate),
	not on forward tab revisits, so they cannot reliably preserve cross-tab form state here.
-->

<script lang="ts">
	import Car from '@lucide/svelte/icons/car';
	import { getContext } from 'svelte';
	import VehicleForm from '$lib/components/VehicleForm.svelte';
	import FuelEntryForm from '$lib/components/FuelEntryForm.svelte';
	import InstallPrompt from '$lib/components/InstallPrompt.svelte';
	import { getVehicleById, getAllVehicles } from '$lib/db/repositories/vehicles';
	import { VEHICLE_ID_STORAGE_KEY } from '$lib/config';
	import { resolve } from '$app/paths';
	import type { Vehicle } from '$lib/db/schema';
	import type { InstallPromptContext } from '$lib/utils/installPrompt';
	import { readStoredVehicleId, safeRemoveItem, safeSetItem } from '$lib/utils/vehicleStorage';

	let currentVehicle = $state<Vehicle | null>(null);
	let showVehicleForm = $state(false);
	let dbError = $state(false);
	let recoveryAttempted = $state(false);
	let addVehicleButton = $state<HTMLButtonElement | undefined>(undefined);
	let firstSuccessfulCreateSave = $state(false);
	let installPromptHiddenByInteraction = $state(false);

	const installPromptCtx = getContext<InstallPromptContext>('installPrompt');
	const showInstallPrompt = $derived(
		firstSuccessfulCreateSave && !installPromptHiddenByInteraction && installPromptCtx.canShowPrompt
	);

	const storedVehicleId = readStoredVehicleId();

	// Start in loading state (either fetching stored vehicle or attempting recovery)
	let loading = $state(true);

	$effect(() => {
		if (storedVehicleId !== null) {
			// Path 1: We have a stored ID — fetch it
			getVehicleById(storedVehicleId).then((result) => {
				if (!result.error) {
					currentVehicle = result.data;
				} else if (result.error.code === 'NOT_FOUND') {
					// Vehicle truly doesn't exist — clear stale ID to prevent future retries
					safeRemoveItem(VEHICLE_ID_STORAGE_KEY);
				} else {
					// GET_FAILED (transient DB error): keep stored ID for next launch retry,
					// but show an error state — NOT the empty onboarding CTA (prevents duplicate vehicles)
					dbError = true;
				}
				loading = false;
			});
		} else if (!recoveryAttempted) {
			// Path 2: No stored ID — try recovery by fetching any vehicle from IndexedDB
			// (Story 1.5 supports only a single vehicle, so first vehicle is "the" vehicle)
			getAllVehicles().then((result) => {
				if (!result.error && result.data && result.data.length > 0) {
					// Found existing vehicle(s) — use the first one and persist its ID
					const recoveredVehicle = result.data[0];
					currentVehicle = recoveredVehicle;
					safeSetItem(VEHICLE_ID_STORAGE_KEY, String(recoveredVehicle.id));
				} else if (result.error) {
					// Any repository error on recovery should show the DB-unavailable state,
					// not silently fall through to the onboarding empty state.
					dbError = true;
				}
				// If no vehicles found and no error, stay in empty state
				loading = false;
				recoveryAttempted = true;
			});
		}
	});

	// Move focus to empty-state CTA button when empty state is shown (accessibility requirement)
	$effect(() => {
		if (!loading && !dbError && !showVehicleForm && !currentVehicle && addVehicleButton) {
			addVehicleButton.focus();
		}
	});

	function handleVehicleSaved(vehicle: Vehicle) {
		safeSetItem(VEHICLE_ID_STORAGE_KEY, String(vehicle.id));
		currentVehicle = vehicle;
		showVehicleForm = false;
	}

	function handleFirstFuelSave() {
		firstSuccessfulCreateSave = true;
		installPromptHiddenByInteraction = false;
	}

	function handleInstallPromptDismiss() {
		installPromptHiddenByInteraction = true;
		installPromptCtx.dismissPrompt();
	}

	async function handleInstallPromptInstall() {
		installPromptHiddenByInteraction = true;
		await installPromptCtx.requestInstall();
	}
</script>

{#if loading}
	<!-- Loading: prevents empty-state flash when persisted vehicle exists (AC6) -->
	<div class="flex min-h-[60vh] items-center justify-center">
		<p class="text-sm text-muted-foreground">Loading…</p>
	</div>
{:else if dbError}
	<!-- Full-screen DB-unavailable recovery state (architecture requirement) — no Add Vehicle CTA to prevent duplicate vehicle creation (AC6) -->
	<div
		role="alert"
		class="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8 text-center"
	>
		<div class="flex flex-col items-center gap-2">
			<p class="text-lg font-semibold text-foreground">Could not load your vehicle</p>
			<p class="text-sm text-muted-foreground">
				There was a problem reaching the database. Please restart the app to try again.
			</p>
			<p class="text-sm text-muted-foreground">
				If the problem persists, export your data before clearing app storage.
			</p>
		</div>
		<a
			href={resolve('/export')}
			class="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
		>
			Export My Data
		</a>
	</div>
{:else if showVehicleForm}
	<!-- Vehicle creation form (AC #2) -->
	<VehicleForm onSave={handleVehicleSaved} />
{:else if currentVehicle}
	<!-- Fuel entry view with vehicle header (AC #5) -->
	<div class="px-4 pt-4">
		<h1 class="text-xl font-semibold text-foreground">{currentVehicle.name}</h1>
		<p class="text-sm text-muted-foreground">
			{currentVehicle.make}
			{currentVehicle.model}{currentVehicle.year ? ` · ${currentVehicle.year}` : ''}
		</p>
		<!-- Fuel entry form (Story 1.6) -->
		<div class="mt-6 space-y-4">
			<FuelEntryForm
				vehicleId={currentVehicle.id}
				onSave={() => {}}
				onFirstCreateSave={handleFirstFuelSave}
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
				{/snippet}
			</FuelEntryForm>
		</div>
	</div>
{:else}
	<!-- Empty state (AC #1) -->
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
