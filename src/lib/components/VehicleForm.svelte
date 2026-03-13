<script lang="ts">
	import { onDestroy } from 'svelte';
	import { saveVehicle } from '$lib/db/repositories/vehicles';
	import type { Vehicle } from '$lib/db/schema';
	import type { AppError } from '$lib/utils/result';

	type AsyncState<T> =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'success'; data: T }
		| { status: 'error'; error: AppError };

	interface VehicleFormProps {
		onSave: (vehicle: Vehicle) => void;
	}

	let { onSave }: VehicleFormProps = $props();

	let displayName = $state('');
	let make = $state('');
	let model = $state('');
	let yearStr = $state('');

	let displayNameError = $state('');
	let makeError = $state('');
	let modelError = $state('');
	let yearError = $state('');

	let displayNameInput: HTMLInputElement | undefined;
	let makeInput: HTMLInputElement | undefined;
	let modelInput: HTMLInputElement | undefined;
	let yearInput: HTMLInputElement | undefined;

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
			if (displayNameError) displayNameInput?.focus();
			else if (makeError) makeInput?.focus();
			else if (modelError) modelInput?.focus();
			else if (yearError) yearInput?.focus();
			return;
		}

		saveState = { status: 'loading' };

		const yearNum = yearStr.trim() !== '' ? parseInt(yearStr.trim(), 10) : undefined;

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
	<h1 class="text-lg font-semibold text-foreground">Add Vehicle</h1>

	<div>
		<label for="displayName" class="block text-sm font-medium text-foreground">Display Name</label>
		<input
			id="displayName"
			type="text"
			bind:this={displayNameInput}
			bind:value={displayName}
			oninput={() => {
				if (displayName.trim() !== '') displayNameError = '';
			}}
			onblur={validateDisplayName}
			aria-invalid={displayNameError ? 'true' : undefined}
			aria-describedby={displayNameError ? 'displayName-error' : undefined}
			class="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
			placeholder="e.g. My Honda"
		/>
		{#if displayNameError}
			<p id="displayName-error" role="alert" class="mt-1 text-sm text-destructive">
				{displayNameError}
			</p>
		{/if}
	</div>

	<div>
		<label for="make" class="block text-sm font-medium text-foreground">Make</label>
		<input
			id="make"
			type="text"
			bind:this={makeInput}
			bind:value={make}
			oninput={() => {
				if (make.trim() !== '') makeError = '';
			}}
			onblur={validateMake}
			aria-invalid={makeError ? 'true' : undefined}
			aria-describedby={makeError ? 'make-error' : undefined}
			class="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
			placeholder="e.g. Toyota"
		/>
		{#if makeError}
			<p id="make-error" role="alert" class="mt-1 text-sm text-destructive">{makeError}</p>
		{/if}
	</div>

	<div>
		<label for="model" class="block text-sm font-medium text-foreground">Model</label>
		<input
			id="model"
			type="text"
			bind:this={modelInput}
			bind:value={model}
			oninput={() => {
				if (model.trim() !== '') modelError = '';
			}}
			onblur={validateModel}
			aria-invalid={modelError ? 'true' : undefined}
			aria-describedby={modelError ? 'model-error' : undefined}
			class="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
			placeholder="e.g. Corolla"
		/>
		{#if modelError}
			<p id="model-error" role="alert" class="mt-1 text-sm text-destructive">{modelError}</p>
		{/if}
	</div>

	<div>
		<label for="year" class="block text-sm font-medium text-foreground">
			Year <span class="text-muted-foreground">(optional)</span>
		</label>
		<input
			id="year"
			type="text"
			inputmode="numeric"
			pattern="[0-9]*"
			bind:this={yearInput}
			bind:value={yearStr}
			oninput={() => {
				const trimmed = yearStr.trim();
				if (trimmed === '') {
					yearError = '';
				} else if (!/^\d+$/.test(trimmed)) {
					yearError = `Enter a valid year (1900–${currentYear})`;
				} else {
					const n = parseInt(trimmed, 10);
					yearError =
						n >= 1900 && n <= currentYear ? '' : `Enter a valid year (1900–${currentYear})`;
				}
			}}
			onblur={validateYear}
			aria-invalid={yearError ? 'true' : undefined}
			aria-describedby={yearError ? 'year-error' : undefined}
			class="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
			placeholder="e.g. 2020"
		/>
		{#if yearError}
			<p id="year-error" role="alert" class="mt-1 text-sm text-destructive">{yearError}</p>
		{/if}
	</div>

	<button
		type="submit"
		disabled={!isFormValid || saveState.status === 'loading'}
		aria-busy={saveState.status === 'loading'}
		class="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-50"
	>
		{saveState.status === 'loading' ? 'Adding…' : 'Add Vehicle'}
	</button>
</form>
