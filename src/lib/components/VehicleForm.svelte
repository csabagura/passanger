<script lang="ts">
	import { onDestroy } from 'svelte';
	import { saveVehicle, updateVehicle } from '$lib/db/repositories/vehicles';
	import type { Vehicle } from '$lib/db/schema';
	import type { AppError } from '$lib/utils/result';
	import { Button } from '$lib/components/ui/button';
	import { Field } from '$lib/components/ui/field';

	type AsyncState<T> =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'success'; data: T }
		| { status: 'error'; error: AppError };

	interface VehicleFormProps {
		onSave: (vehicle: Vehicle) => void;
		initialVehicle?: Vehicle;
		onUpdate?: (vehicle: Vehicle) => void;
		onCancel?: () => void;
	}

	let { onSave, initialVehicle, onUpdate, onCancel }: VehicleFormProps = $props();

	const isEditMode = $derived(!!initialVehicle);

	let displayName = $state(initialVehicle?.name ?? '');
	let make = $state(initialVehicle?.make ?? '');
	let model = $state(initialVehicle?.model ?? '');
	let yearStr = $state(initialVehicle?.year != null ? String(initialVehicle.year) : '');

	let displayNameError = $state('');
	let makeError = $state('');
	let modelError = $state('');
	let yearError = $state('');

	// Field wraps its own input and does not forward a ref, so focus recovery targets the
	// stable ids passed to each Field.
	function focusField(id: string): void {
		document.getElementById(id)?.focus();
	}

	let saveState = $state<AsyncState<Vehicle>>({ status: 'idle' });
	let toastMessage = $state('');
	let toastTimeout: ReturnType<typeof setTimeout> | null = null;

	const currentYear = new Date().getFullYear();

	const isFormValid = $derived(
		displayName.trim() !== '' && make.trim() !== '' && model.trim() !== '' && !yearError
	);

	function validateDisplayName() {
		displayNameError = displayName.trim() === '' ? 'Enter a display name' : '';
	}

	function validateMake() {
		makeError = make.trim() === '' ? 'Enter the vehicle make (e.g. Toyota)' : '';
	}

	function validateModel() {
		modelError = model.trim() === '' ? 'Enter the vehicle model (e.g. Corolla)' : '';
	}

	function validateYear() {
		const trimmed = yearStr.trim();
		if (trimmed === '') {
			yearError = '';
			return;
		}
		if (!/^\d+$/.test(trimmed)) {
			yearError = `Enter a valid year (1900–${currentYear})`;
			return;
		}
		const n = parseInt(trimmed, 10);
		if (n < 1900 || n > currentYear) {
			yearError = `Enter a valid year (1900–${currentYear})`;
		} else {
			yearError = '';
		}
	}

	function showToast(message: string) {
		toastMessage = message;
		if (toastTimeout) clearTimeout(toastTimeout);
		toastTimeout = setTimeout(() => {
			toastMessage = '';
			toastTimeout = null;
		}, 4000);
	}

	onDestroy(() => {
		if (toastTimeout) clearTimeout(toastTimeout);
	});

	async function handleSubmit() {
		if (saveState.status === 'loading') return; // guard against re-entrant submits
		validateDisplayName();
		validateMake();
		validateModel();
		validateYear();

		if (displayNameError || makeError || modelError || yearError) {
			// Move focus to first invalid field for keyboard recovery (UX spec requirement)
			if (displayNameError) focusField('displayName');
			else if (makeError) focusField('make');
			else if (modelError) focusField('model');
			else if (yearError) focusField('year');
			return;
		}

		saveState = { status: 'loading' };

		const yearNum = yearStr.trim() !== '' ? parseInt(yearStr.trim(), 10) : undefined;

		if (isEditMode && initialVehicle) {
			const result = await updateVehicle(initialVehicle.id, {
				name: displayName.trim(),
				make: make.trim(),
				model: model.trim(),
				year: yearNum
			});

			if (result.error) {
				saveState = { status: 'error', error: result.error };
				showToast('Failed to save vehicle. Please try again.');
			} else {
				saveState = { status: 'success', data: result.data };
				onUpdate?.(result.data);
			}
		} else {
			const result = await saveVehicle({
				name: displayName.trim(),
				make: make.trim(),
				model: model.trim(),
				year: yearNum
			});

			if (result.error) {
				saveState = { status: 'error', error: result.error };
				showToast('Failed to save vehicle. Please try again.');
			} else {
				saveState = { status: 'success', data: result.data };
				onSave(result.data);
			}
		}
	}
</script>

{#if toastMessage}
	<div
		role="alert"
		class="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg bg-destructive px-4 py-2 text-sm text-white shadow-md"
	>
		{toastMessage}
	</div>
{/if}

<form
	onsubmit={(e) => {
		e.preventDefault();
		handleSubmit();
	}}
	class="flex flex-col gap-4 p-4"
>
	<h1 class="text-lg font-semibold text-foreground">
		{isEditMode ? 'Edit Vehicle' : 'Add Vehicle'}
	</h1>

	<Field
		id="displayName"
		label="Display Name"
		type="text"
		bind:value={displayName}
		error={displayNameError}
		placeholder="e.g. My Honda"
		oninput={() => {
			if (displayName.trim() !== '') displayNameError = '';
		}}
		onblur={validateDisplayName}
	/>

	<Field
		id="make"
		label="Make"
		type="text"
		bind:value={make}
		error={makeError}
		placeholder="e.g. Toyota"
		oninput={() => {
			if (make.trim() !== '') makeError = '';
		}}
		onblur={validateMake}
	/>

	<Field
		id="model"
		label="Model"
		type="text"
		bind:value={model}
		error={modelError}
		placeholder="e.g. Corolla"
		oninput={() => {
			if (model.trim() !== '') modelError = '';
		}}
		onblur={validateModel}
	/>

	<Field
		id="year"
		label="Year (optional)"
		type="text"
		inputmode="numeric"
		pattern="[0-9]*"
		bind:value={yearStr}
		error={yearError}
		placeholder="e.g. 2020"
		oninput={() => {
			const trimmed = yearStr.trim();
			if (trimmed === '') {
				yearError = '';
			} else if (!/^\d+$/.test(trimmed)) {
				yearError = `Enter a valid year (1900–${currentYear})`;
			} else {
				const n = parseInt(trimmed, 10);
				yearError = n >= 1900 && n <= currentYear ? '' : `Enter a valid year (1900–${currentYear})`;
			}
		}}
		onblur={validateYear}
	/>

	<div class="flex gap-3">
		{#if onCancel}
			<Button variant="outline" onclick={onCancel}>Cancel</Button>
		{/if}
		<Button
			type="submit"
			size="lg"
			class="flex-1"
			disabled={!isFormValid || saveState.status === 'loading'}
			aria-busy={saveState.status === 'loading'}
		>
			{#if saveState.status === 'loading'}
				Saving…
			{:else}
				{isEditMode ? 'Save changes' : 'Save vehicle'}
			{/if}
		</Button>
	</div>
</form>
