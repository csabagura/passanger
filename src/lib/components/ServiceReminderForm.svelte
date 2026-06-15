<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		saveServiceReminder,
		updateServiceReminder
	} from '$lib/db/repositories/serviceReminders';
	import type { NewServiceReminder, ServiceReminder } from '$lib/db/schema';
	import {
		getTodayDateInputValue,
		parseDateInputValue,
		toLocalDateInputValue
	} from '$lib/utils/date';
	import { parsePositiveNumeric } from '$lib/utils/numberInput';
	import type { AppError } from '$lib/utils/result';

	type AsyncState<T> =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'success'; data: T }
		| { status: 'error'; error: AppError };

	interface Props {
		vehicleId: number;
		onSave: (reminder: ServiceReminder) => void;
		initialReminder?: ServiceReminder;
		onUpdate?: (reminder: ServiceReminder) => void;
		onCancel?: () => void;
	}

	let { vehicleId, onSave, initialReminder, onUpdate, onCancel }: Props = $props();

	const isEditMode = $derived(!!initialReminder);

	let title = $state(initialReminder?.title ?? '');
	let intervalKmStr = $state(
		initialReminder?.intervalKm != null ? String(initialReminder.intervalKm) : ''
	);
	let intervalDaysStr = $state(
		initialReminder?.intervalDays != null ? String(initialReminder.intervalDays) : ''
	);
	let lastServiceOdometerStr = $state(
		initialReminder?.lastServiceOdometer != null ? String(initialReminder.lastServiceOdometer) : ''
	);
	let lastServiceDateStr = $state(
		initialReminder?.lastServiceDate ? toLocalDateInputValue(initialReminder.lastServiceDate) : ''
	);
	let notes = $state(initialReminder?.notes ?? '');

	let titleError = $state('');
	let intervalError = $state('');
	let lastServiceOdometerError = $state('');
	let lastServiceDateError = $state('');

	let titleInput: HTMLInputElement | undefined = $state();
	let intervalKmInput: HTMLInputElement | undefined = $state();
	let lastServiceOdometerInput: HTMLInputElement | undefined = $state();
	let lastServiceDateInput: HTMLInputElement | undefined = $state();

	let saveState = $state<AsyncState<ServiceReminder>>({ status: 'idle' });
	let toastMessage = $state('');
	let toastTimeout: ReturnType<typeof setTimeout> | null = null;

	const todayValue = getTodayDateInputValue();

	const hasAnyInterval = $derived(intervalKmStr.trim() !== '' || intervalDaysStr.trim() !== '');
	const isFormValid = $derived(
		title.trim() !== '' &&
			hasAnyInterval &&
			!intervalError &&
			!lastServiceOdometerError &&
			!lastServiceDateError
	);

	function validateTitle() {
		titleError = title.trim() === '' ? 'Enter a reminder title' : '';
	}

	function validateIntervals() {
		const hasKm = intervalKmStr.trim() !== '';
		const hasDays = intervalDaysStr.trim() !== '';
		if (!hasKm && !hasDays) {
			intervalError = 'Set a distance or time interval';
			return;
		}
		if (hasKm && parsePositiveNumeric(intervalKmStr) === null) {
			intervalError = 'Enter a positive distance interval';
			return;
		}
		if (hasDays && parsePositiveNumeric(intervalDaysStr) === null) {
			intervalError = 'Enter a positive time interval (days)';
			return;
		}
		intervalError = '';
	}

	function validateLastServiceOdometer() {
		const trimmed = lastServiceOdometerStr.trim();
		if (trimmed === '') {
			lastServiceOdometerError = '';
			return;
		}
		lastServiceOdometerError =
			parsePositiveNumeric(trimmed) === null ? 'Enter a positive odometer reading' : '';
	}

	function validateLastServiceDate() {
		const trimmed = lastServiceDateStr.trim();
		if (trimmed === '') {
			lastServiceDateError = '';
			return;
		}
		lastServiceDateError = parseDateInputValue(trimmed) === null ? 'Enter a valid date' : '';
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
		validateTitle();
		validateIntervals();
		validateLastServiceOdometer();
		validateLastServiceDate();

		if (titleError || intervalError || lastServiceOdometerError || lastServiceDateError) {
			if (titleError) titleInput?.focus();
			else if (intervalError) intervalKmInput?.focus();
			else if (lastServiceOdometerError) lastServiceOdometerInput?.focus();
			else if (lastServiceDateError) lastServiceDateInput?.focus();
			return;
		}

		saveState = { status: 'loading' };

		const intervalKm =
			intervalKmStr.trim() !== '' ? (parsePositiveNumeric(intervalKmStr) ?? undefined) : undefined;
		const intervalDays =
			intervalDaysStr.trim() !== ''
				? (parsePositiveNumeric(intervalDaysStr) ?? undefined)
				: undefined;
		const lastServiceOdometer =
			lastServiceOdometerStr.trim() !== ''
				? (parsePositiveNumeric(lastServiceOdometerStr) ?? undefined)
				: undefined;
		const lastServiceDate =
			lastServiceDateStr.trim() !== ''
				? (parseDateInputValue(lastServiceDateStr) ?? undefined)
				: undefined;
		const trimmedNotes = notes.trim();

		const payload: NewServiceReminder = {
			vehicleId,
			title: title.trim(),
			intervalKm,
			intervalDays,
			lastServiceOdometer,
			lastServiceDate,
			notes: trimmedNotes !== '' ? trimmedNotes : undefined
		};

		if (isEditMode && initialReminder) {
			const result = await updateServiceReminder(initialReminder.id, payload);
			if (result.error) {
				saveState = { status: 'error', error: result.error };
				showToast('Failed to save reminder. Please try again.');
			} else {
				saveState = { status: 'success', data: result.data };
				onUpdate?.(result.data);
			}
		} else {
			const result = await saveServiceReminder(payload);
			if (result.error) {
				saveState = { status: 'error', error: result.error };
				showToast('Failed to save reminder. Please try again.');
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
	<h3 class="text-lg font-semibold text-foreground">
		{isEditMode ? 'Edit reminder' : 'Add reminder'}
	</h3>

	<div>
		<label for="reminder-title" class="block text-sm font-medium text-foreground">Title</label>
		<input
			id="reminder-title"
			type="text"
			bind:this={titleInput}
			bind:value={title}
			oninput={() => {
				if (title.trim() !== '') titleError = '';
			}}
			onblur={validateTitle}
			aria-invalid={titleError ? 'true' : undefined}
			aria-describedby={titleError ? 'reminder-title-error' : undefined}
			class="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
			placeholder="e.g. Oil change"
		/>
		{#if titleError}
			<p id="reminder-title-error" role="alert" class="mt-1 text-sm text-destructive">
				{titleError}
			</p>
		{/if}
	</div>

	<fieldset
		aria-describedby={intervalError ? 'reminder-interval-error' : 'reminder-interval-help'}
		class="space-y-2"
	>
		<legend class="text-sm font-medium text-foreground">Interval</legend>
		<p id="reminder-interval-help" class="text-sm text-muted-foreground">
			Set a distance interval, a time interval, or both.
		</p>
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<label for="reminder-interval-km" class="block text-xs font-medium text-muted-foreground">
					Every (km)
				</label>
				<input
					id="reminder-interval-km"
					type="text"
					inputmode="numeric"
					bind:this={intervalKmInput}
					bind:value={intervalKmStr}
					oninput={() => {
						if (intervalError) intervalError = '';
					}}
					onblur={validateIntervals}
					aria-invalid={intervalError ? 'true' : undefined}
					class="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
					placeholder="e.g. 10000"
				/>
			</div>
			<div>
				<label for="reminder-interval-days" class="block text-xs font-medium text-muted-foreground">
					Every (days)
				</label>
				<input
					id="reminder-interval-days"
					type="text"
					inputmode="numeric"
					bind:value={intervalDaysStr}
					oninput={() => {
						if (intervalError) intervalError = '';
					}}
					onblur={validateIntervals}
					aria-invalid={intervalError ? 'true' : undefined}
					class="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
					placeholder="e.g. 365"
				/>
			</div>
		</div>
		{#if intervalError}
			<p id="reminder-interval-error" role="alert" class="text-sm text-destructive">
				{intervalError}
			</p>
		{/if}
	</fieldset>

	<div>
		<label for="reminder-last-odometer" class="block text-sm font-medium text-foreground">
			Last service odometer <span class="text-muted-foreground">(optional)</span>
		</label>
		<input
			id="reminder-last-odometer"
			type="text"
			inputmode="numeric"
			bind:this={lastServiceOdometerInput}
			bind:value={lastServiceOdometerStr}
			oninput={() => {
				if (lastServiceOdometerError) lastServiceOdometerError = '';
			}}
			onblur={validateLastServiceOdometer}
			aria-invalid={lastServiceOdometerError ? 'true' : undefined}
			aria-describedby={lastServiceOdometerError ? 'reminder-last-odometer-error' : undefined}
			class="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
			placeholder="e.g. 50000"
		/>
		{#if lastServiceOdometerError}
			<p id="reminder-last-odometer-error" role="alert" class="mt-1 text-sm text-destructive">
				{lastServiceOdometerError}
			</p>
		{/if}
	</div>

	<div>
		<label for="reminder-last-date" class="block text-sm font-medium text-foreground">
			Last service date <span class="text-muted-foreground">(optional)</span>
		</label>
		<input
			id="reminder-last-date"
			type="date"
			max={todayValue}
			bind:this={lastServiceDateInput}
			bind:value={lastServiceDateStr}
			oninput={() => {
				if (lastServiceDateError) lastServiceDateError = '';
			}}
			onblur={validateLastServiceDate}
			aria-invalid={lastServiceDateError ? 'true' : undefined}
			aria-describedby={lastServiceDateError ? 'reminder-last-date-error' : undefined}
			class="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
		/>
		{#if lastServiceDateError}
			<p id="reminder-last-date-error" role="alert" class="mt-1 text-sm text-destructive">
				{lastServiceDateError}
			</p>
		{/if}
	</div>

	<div>
		<label for="reminder-notes" class="block text-sm font-medium text-foreground">
			Notes <span class="text-muted-foreground">(optional)</span>
		</label>
		<textarea
			id="reminder-notes"
			bind:value={notes}
			rows="2"
			class="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
			placeholder="Anything to remember"
		></textarea>
	</div>

	<div class="flex gap-3">
		{#if onCancel}
			<button
				type="button"
				onclick={onCancel}
				class="rounded-xl border border-border px-4 py-3 text-sm font-semibold text-foreground"
			>
				Cancel
			</button>
		{/if}
		<button
			type="submit"
			disabled={!isFormValid || saveState.status === 'loading'}
			aria-busy={saveState.status === 'loading'}
			class="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-50"
		>
			{#if saveState.status === 'loading'}
				Saving…
			{:else}
				{isEditMode ? 'Save changes' : 'Save reminder'}
			{/if}
		</button>
	</div>
</form>
