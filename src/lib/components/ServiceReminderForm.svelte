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
	import { Button } from '$lib/components/ui/button';
	import { Field } from '$lib/components/ui/field';
	import { Label } from '$lib/components/ui/label';
	import { m } from '$lib/paraglide/messages';

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

	// Field wraps its own input and does not forward a ref, so focus recovery targets the
	// stable ids passed to each Field.
	function focusField(id: string): void {
		document.getElementById(id)?.focus();
	}

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
		titleError = title.trim() === '' ? m.reminderform_error_title() : '';
	}

	function validateIntervals() {
		const hasKm = intervalKmStr.trim() !== '';
		const hasDays = intervalDaysStr.trim() !== '';
		if (!hasKm && !hasDays) {
			intervalError = m.reminderform_error_interval_required();
			return;
		}
		if (hasKm && parsePositiveNumeric(intervalKmStr) === null) {
			intervalError = m.reminderform_error_interval_km();
			return;
		}
		if (hasDays && parsePositiveNumeric(intervalDaysStr) === null) {
			intervalError = m.reminderform_error_interval_days();
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
			parsePositiveNumeric(trimmed) === null ? m.reminderform_error_odometer() : '';
	}

	function validateLastServiceDate() {
		const trimmed = lastServiceDateStr.trim();
		if (trimmed === '') {
			lastServiceDateError = '';
			return;
		}
		lastServiceDateError = parseDateInputValue(trimmed) === null ? m.reminderform_error_date() : '';
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
			if (titleError) focusField('reminder-title');
			else if (intervalError) focusField('reminder-interval-km');
			else if (lastServiceOdometerError) focusField('reminder-last-odometer');
			else if (lastServiceDateError) focusField('reminder-last-date');
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
				showToast(m.reminderform_error_save());
			} else {
				saveState = { status: 'success', data: result.data };
				onUpdate?.(result.data);
			}
		} else {
			const result = await saveServiceReminder(payload);
			if (result.error) {
				saveState = { status: 'error', error: result.error };
				showToast(m.reminderform_error_save());
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
		{isEditMode ? m.reminderform_title_edit() : m.reminderform_title_add()}
	</h3>

	<Field
		id="reminder-title"
		label={m.reminderform_field_title()}
		type="text"
		bind:value={title}
		error={titleError}
		placeholder={m.reminderform_placeholder_title()}
		oninput={() => {
			if (title.trim() !== '') titleError = '';
		}}
		onblur={validateTitle}
	/>

	<fieldset
		aria-describedby={intervalError ? 'reminder-interval-error' : 'reminder-interval-help'}
		class="space-y-2"
	>
		<legend class="text-sm font-medium text-foreground">{m.reminderform_legend_interval()}</legend>
		<p id="reminder-interval-help" class="text-sm text-muted-foreground">
			{m.reminderform_interval_help()}
		</p>
		<div class="grid gap-3 sm:grid-cols-2">
			<!-- km/days share one fieldset-level error region, so the error stays below; the Fields
			     carry only the input chrome (no per-field error prop). -->
			<Field
				id="reminder-interval-km"
				label={m.reminderform_field_interval_km()}
				type="text"
				inputmode="numeric"
				bind:value={intervalKmStr}
				placeholder={m.reminderform_placeholder_interval_km()}
				oninput={() => {
					if (intervalError) intervalError = '';
				}}
				onblur={validateIntervals}
			/>
			<Field
				id="reminder-interval-days"
				label={m.reminderform_field_interval_days()}
				type="text"
				inputmode="numeric"
				bind:value={intervalDaysStr}
				placeholder={m.reminderform_placeholder_interval_days()}
				oninput={() => {
					if (intervalError) intervalError = '';
				}}
				onblur={validateIntervals}
			/>
		</div>
		{#if intervalError}
			<p id="reminder-interval-error" role="alert" class="text-sm text-destructive">
				{intervalError}
			</p>
		{/if}
	</fieldset>

	<Field
		id="reminder-last-odometer"
		label={m.reminderform_field_last_odometer()}
		type="text"
		inputmode="numeric"
		bind:value={lastServiceOdometerStr}
		error={lastServiceOdometerError}
		placeholder={m.reminderform_placeholder_last_odometer()}
		oninput={() => {
			if (lastServiceOdometerError) lastServiceOdometerError = '';
		}}
		onblur={validateLastServiceOdometer}
	/>

	<Field
		id="reminder-last-date"
		label={m.reminderform_field_last_date()}
		type="date"
		max={todayValue}
		bind:value={lastServiceDateStr}
		error={lastServiceDateError}
		oninput={() => {
			if (lastServiceDateError) lastServiceDateError = '';
		}}
		onblur={validateLastServiceDate}
	/>

	<div class="flex flex-col gap-2">
		<Label for="reminder-notes" class="text-foreground">{m.form_notes_optional()}</Label>
		<textarea
			id="reminder-notes"
			bind:value={notes}
			rows="2"
			class="w-full rounded-md border border-border bg-card px-3 py-2 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
			placeholder={m.reminderform_placeholder_notes()}
		></textarea>
	</div>

	<div class="flex gap-3">
		{#if onCancel}
			<Button variant="outline" onclick={onCancel}>{m.common_cancel()}</Button>
		{/if}
		<Button
			type="submit"
			size="lg"
			class="flex-1"
			disabled={!isFormValid || saveState.status === 'loading'}
			aria-busy={saveState.status === 'loading'}
		>
			{#if saveState.status === 'loading'}
				{m.form_saving()}
			{:else}
				{isEditMode ? m.form_save_changes() : m.reminderform_save()}
			{/if}
		</Button>
	</div>
</form>
