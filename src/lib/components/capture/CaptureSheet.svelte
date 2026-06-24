<script lang="ts">
	import { getContext } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import FuelEntryForm from '$lib/components/FuelEntryForm.svelte';
	import MaintenanceForm from '$lib/components/MaintenanceForm.svelte';
	import CaptureSegmented from './CaptureSegmented.svelte';
	import type { CaptureMode, CaptureSheetContext } from '$lib/state/captureSheet.svelte';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';
	import type { Expense } from '$lib/db/schema';

	// The global Capture sheet (AD-3): a controlled bottom Sheet driven by the captureSheet context as
	// the single source of truth. bits-ui Dialog provides focus-trap, scroll-lock, Escape-to-close and
	// focus-return on close for free (AC-4) — we only sync close-from-UI back into the context.
	const capture = getContext<CaptureSheetContext>('captureSheet');
	const vehicles = getContext<VehiclesContext>('vehicles');

	interface Props {
		// Story 3.3 (AC-7): forwarded to both capture forms so the first successful Capture still fires
		// the install-prompt / onboarding-survey gate (FR40). Pre-3.3 this fired on the now-retired /log
		// inline forms' `onFirstCreateSave`; the layout owns the gate and renders the prompt/survey.
		onFirstCreateSave?: () => void;
		// Story 4.6 (FR-12 loop-close): fired on every Expense CREATE save so the layout can offer to
		// reset a token-matching reminder. Forwarded to the Expense form only (fuel saves never match a
		// service reminder).
		onCreateSave?: (expense: Expense) => void;
	}

	let { onFirstCreateSave = () => {}, onCreateSave = () => {} }: Props = $props();

	// User-facing label is "Expense" (DEC-5) but it renders the existing MaintenanceForm writing to the
	// expenses repository — the internal entity stays "maintenance" (renaming is out of scope).
</script>

<Sheet.Root
	open={capture.open}
	onOpenChange={(o) => {
		if (!o) capture.close();
	}}
>
	<!-- The generated default close button is `size="icon-sm"` (28px) — below the AC-4 44px floor. Opt
	     out of it and supply our own 44px `size="icon"` close instead. -->
	<Sheet.Content side="bottom" showCloseButton={false}>
		<Sheet.Close>
			{#snippet child({ props })}
				<Button variant="ghost" size="icon" class="absolute top-3 right-3" {...props}>
					<X />
					<span class="sr-only">Close</span>
				</Button>
			{/snippet}
		</Sheet.Close>

		<Sheet.Header>
			<Sheet.Title>Log an entry</Sheet.Title>
		</Sheet.Header>

		{#if vehicles.loaded && vehicles.activeVehicleId !== null}
			<Tabs.Root
				value={capture.mode}
				onValueChange={(v) => capture.setMode(v as CaptureMode)}
				class="px-4 pb-4"
			>
				<CaptureSegmented />
				<!-- Only the active form is mounted. bits-ui Tabs.Content keeps both panels in the DOM
				     (toggling `hidden`), so without this guard the inactive form would also mount — running
				     its on-mount work (FuelEntryForm's timeline DB read) and, after a save, leaving its
				     success-dismiss timer alive across a segment switch (it would slam the sheet shut while
				     the user is mid-typing in the other tab). Gating on capture.mode unmounts the inactive
				     form so its onDestroy clears that timer. Draft state survives via the module-level draft. -->
				<Tabs.Content value="fuel">
					{#if capture.mode === 'fuel'}
						<FuelEntryForm
							vehicleId={vehicles.activeVehicleId}
							onSave={() => {}}
							{onFirstCreateSave}
							onSuccessFeedbackComplete={() => capture.close()}
						/>
					{/if}
				</Tabs.Content>
				<Tabs.Content value="expense">
					{#if capture.mode === 'expense'}
						<MaintenanceForm
							vehicleId={vehicles.activeVehicleId}
							onSave={() => {}}
							{onFirstCreateSave}
							{onCreateSave}
							onSuccessFeedbackComplete={() => capture.close()}
							initialType={capture.prefill?.expenseType}
						/>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		{:else if vehicles.loaded}
			<!-- No vehicle yet: the FAB is always present, so opening with no car must degrade to a calm
			     CTA rather than a broken form. The full first-run flow lands in Epic 3. -->
			<p class="px-4 pb-6 text-sm text-muted-foreground">Add your car to get started.</p>
		{/if}
		<!-- vehicles not loaded yet: render nothing inside the sheet so the no-vehicle CTA can't flash
		     before the async vehicle read resolves (mirrors /log's `{#if !vehiclesCtx.loaded}` guard). -->
	</Sheet.Content>
</Sheet.Root>
