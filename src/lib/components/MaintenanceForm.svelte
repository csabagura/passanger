<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import { RESULT_CARD_DISMISS_MS, PRESET_CURRENCIES } from '$lib/config';
	import { saveExpense, updateExpense } from '$lib/db/repositories/expenses';
	import { saveErrorMessage } from '$lib/utils/saveErrorMessage';
	import type { Expense, NewExpense } from '$lib/db/schema';
	import {
		clearMaintenanceDraft,
		maintenanceDraft,
		consumeMaintenanceDraftStale,
		getLastUsedCurrency,
		setLastUsedCurrency,
		getRecentCurrencies
	} from '$lib/state/draftStore';
	import CurrencyChips from '$lib/components/capture/CurrencyChips.svelte';
	import {
		formatLocalCalendarDate,
		getTodayDateInputValue,
		parseDateInputValue,
		toLocalDateInputValue
	} from '$lib/utils/date';
	import { formatCurrency } from '$lib/utils/calculations';
	import { isGroupedOdometerValue, parseNonNegativeNumeric } from '$lib/utils/numberInput';
	import type { AppError } from '$lib/utils/result';
	import type { AppSettings } from '$lib/utils/settings';

	type FormMode = 'create' | 'edit';

	interface Props {
		vehicleId: number;
		onSave: (expense: Expense) => void;
		mode?: FormMode;
		initialExpense?: Expense;
		onCancel?: () => void;
		onSuccessFeedbackComplete?: () => void;
		onFirstCreateSave?: (expense: Expense) => void;
	}

	type SaveState =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'success'; data: Expense }
		| { status: 'error'; error: AppError };

	const TYPE_SUGGESTIONS = ['Tyres', 'Oil Change', 'Service', 'Insurance', 'Other'];

	let {
		vehicleId,
		onSave,
		mode = 'create',
		initialExpense = undefined,
		onCancel = () => {},
		onSuccessFeedbackComplete = () => {},
		onFirstCreateSave = () => {}
	}: Props = $props();

	let hasCreatedFirstSave = $state(false);

	const settingsCtx = getContext<{ settings: AppSettings }>('settings');

	const isEditMode = $derived(mode === 'edit' && initialExpense !== undefined);

	// Story 2.3 (AC-4): a draft restored after DRAFT_STALE_DAYS had its odometer + date dropped
	// and re-validated (date → today). Show a calm, non-blocking notice ONCE per stale restore,
	// create path only — consume() resets the flag so it does not re-fire on remount.
	const showStaleDraftNotice = getInitialExpense() ? false : consumeMaintenanceDraftStale();
	const odometerHelpId = 'maintenance-odometer-help';

	function getInitialExpense(): Expense | undefined {
		return mode === 'edit' ? initialExpense : undefined;
	}

	let dateValue = $state(
		getInitialExpense()
			? toLocalDateInputValue(getInitialExpense()!.date)
			: (maintenanceDraft['date'] ?? getTodayDateInputValue())
	);
	let typeValue = $state(
		getInitialExpense() ? getInitialExpense()!.type : (maintenanceDraft['type'] ?? '')
	);
	let odometerValue = $state(
		getInitialExpense() && getInitialExpense()!.odometer !== undefined
			? String(getInitialExpense()!.odometer)
			: (maintenanceDraft['odometer'] ?? '')
	);
	let costValue = $state(
		getInitialExpense() ? String(getInitialExpense()!.cost) : (maintenanceDraft['cost'] ?? '')
	);
	// Currency the cost is entered in. Edit: the entry's own currency; create: the last
	// currency picked this session (so a trip stays consistent), else home.
	let currency = $state(
		getInitialExpense()
			? (getInitialExpense()!.currency ?? settingsCtx.settings.currency)
			: (getLastUsedCurrency() ?? settingsCtx.settings.currency)
	);
	const currencyOptions = $derived.by(() => {
		const presets = PRESET_CURRENCIES as readonly string[];
		return presets.includes(currency) ? [...presets] : [currency, ...presets];
	});
	// Story 2.2: recent-currency chips. The module store isn't a Svelte store, so a version
	// counter (bumped after each save) makes the read reactive. CurrencyChips filters out the
	// currently-selected value and renders nothing when the remainder is empty.
	let recentCurrenciesVersion = $state(0);
	const recentCurrencies = $derived(recentCurrenciesVersion >= 0 ? getRecentCurrencies() : []);
	let notesValue = $state(
		getInitialExpense() ? (getInitialExpense()!.notes ?? '') : (maintenanceDraft['notes'] ?? '')
	);

	let dateError = $state('');
	let typeError = $state('');
	let odometerError = $state('');
	let costError = $state('');

	let dateInput: HTMLInputElement | undefined = $state();
	let typeInput: HTMLInputElement | undefined = $state();
	let odometerInput: HTMLInputElement | undefined = $state();
	let costInput: HTMLInputElement | undefined = $state();

	let saveState = $state<SaveState>({ status: 'idle' });
	let successMessage = $state('');
	let showSuccessMessage = $state(false);
	let successMessageTimeout: ReturnType<typeof setTimeout> | null = null;
	let isComponentMounted = $state(true);

	function clearAsyncFeedback() {
		if (successMessageTimeout) {
			clearTimeout(successMessageTimeout);
			successMessageTimeout = null;
		}

		showSuccessMessage = false;
		if (saveState.status !== 'loading') {
			saveState = { status: 'idle' };
		}
	}

	function syncDraftField(key: string, value: string, options?: { skipIf?: boolean }) {
		if (!value || options?.skipIf) {
			delete maintenanceDraft[key];
			return;
		}

		maintenanceDraft[key] = value;
	}

	$effect(() => {
		if (isEditMode) {
			return;
		}

		syncDraftField('date', dateValue, { skipIf: dateValue === getTodayDateInputValue() });
		syncDraftField('type', typeValue);
		syncDraftField('odometer', odometerValue);
		syncDraftField('cost', costValue);
		syncDraftField('notes', notesValue);
	});

	function setFormValuesFromExpense(expense: Expense): void {
		dateValue = toLocalDateInputValue(expense.date);
		typeValue = expense.type;
		odometerValue = expense.odometer !== undefined ? String(expense.odometer) : '';
		costValue = String(expense.cost);
		notesValue = expense.notes ?? '';
	}

	async function handleSubmit() {
		if (saveState.status === 'loading') {
			return;
		}

		clearAsyncFeedback();

		dateError = '';
		typeError = '';
		odometerError = '';
		costError = '';

		const parsedDate = parseDateInputValue(dateValue);
		if (parsedDate === null) {
			dateError = 'Choose a valid date';
		}

		if (!typeValue.trim()) {
			typeError = 'Enter a maintenance type';
		}

		const parsedOdometer =
			odometerValue.trim() === '' ? undefined : parseNonNegativeNumeric(odometerValue);
		if (odometerValue.trim() !== '') {
			if (parsedOdometer === null) {
				odometerError = 'Enter a valid odometer reading (e.g. 87400)';
			} else if (isGroupedOdometerValue(odometerValue, parsedOdometer ?? null)) {
				odometerError = 'Enter odometer without grouping separators (e.g. 87400)';
			}
		}

		const parsedCost = parseNonNegativeNumeric(costValue);
		if (parsedCost === null) {
			costError = 'Enter the cost (e.g. 78.00)';
		}

		if (dateError) {
			dateInput?.focus();
			return;
		}
		if (typeError) {
			typeInput?.focus();
			return;
		}
		if (odometerError) {
			odometerInput?.focus();
			return;
		}
		if (costError) {
			costInput?.focus();
			return;
		}

		if (parsedDate === null || parsedCost === null) {
			return;
		}

		const entry: NewExpense = {
			vehicleId,
			date: parsedDate,
			type: typeValue.trim(),
			odometer: parsedOdometer ?? undefined,
			cost: parsedCost,
			currency,
			notes: notesValue
		};

		saveState = { status: 'loading' };

		const result =
			isEditMode && initialExpense
				? await updateExpense(initialExpense.id, entry)
				: await saveExpense(entry);

		if (!isComponentMounted) {
			return;
		}

		if (result.error) {
			saveState = {
				status: 'error',
				error: {
					code: result.error.code,
					message: saveErrorMessage(
						result.error,
						isEditMode
							? 'Could not update maintenance entry. Please try again.'
							: 'Could not save maintenance entry. Please try again.'
					)
				}
			};
			return;
		}

		if (isEditMode) {
			setFormValuesFromExpense(result.data);
		} else {
			clearMaintenanceDraft();
			dateValue = getTodayDateInputValue();
			typeValue = '';
			odometerValue = '';
			costValue = '';
			notesValue = '';
		}

		setLastUsedCurrency(currency);
		recentCurrenciesVersion += 1;

		saveState = { status: 'success', data: result.data };
		const resultCurrency = result.data.currency ?? settingsCtx.settings.currency;
		successMessage = isEditMode
			? `Updated ${result.data.type} for ${formatCurrency(result.data.cost, resultCurrency)} on ${formatLocalCalendarDate(result.data.date)}.`
			: `Saved ${result.data.type} for ${formatCurrency(result.data.cost, resultCurrency)} on ${formatLocalCalendarDate(result.data.date)}.`;
		showSuccessMessage = true;
		successMessageTimeout = setTimeout(() => {
			showSuccessMessage = false;
			successMessageTimeout = null;
			onSuccessFeedbackComplete();
		}, RESULT_CARD_DISMISS_MS);

		if (!isEditMode && !hasCreatedFirstSave) {
			hasCreatedFirstSave = true;
			onFirstCreateSave(result.data);
		}
		onSave(result.data);
	}

	onDestroy(() => {
		isComponentMounted = false;
		if (successMessageTimeout) {
			clearTimeout(successMessageTimeout);
		}
	});
</script>

<form
	onsubmit={(event) => {
		event.preventDefault();
		handleSubmit();
	}}
	class="space-y-5"
>
	{#if showStaleDraftNotice}
		<!-- Story 2.3 (AC-4): calm, non-blocking stale-restore notice. Polite live region, NO
		     role="alert"; neutral text-muted-foreground (informational, not the amber warning). -->
		<p aria-live="polite" class="text-sm text-muted-foreground">
			We kept your earlier draft — double-check the odometer and date.
		</p>
	{/if}
	<div>
		<label for="maintenance-date" class="block text-sm font-medium text-foreground">Date</label>
		<input
			bind:this={dateInput}
			bind:value={dateValue}
			id="maintenance-date"
			type="date"
			aria-invalid={dateError ? 'true' : undefined}
			aria-describedby={dateError ? 'maintenance-date-error' : undefined}
			oninput={clearAsyncFeedback}
			class="mt-1 block h-[52px] w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
		/>
		{#if dateError}
			<p id="maintenance-date-error" role="alert" class="mt-1 text-sm text-destructive">
				{dateError}
			</p>
		{/if}
	</div>

	<div>
		<label for="maintenance-type" class="block text-sm font-medium text-foreground">Type</label>
		<input
			bind:this={typeInput}
			bind:value={typeValue}
			id="maintenance-type"
			type="text"
			list="maintenance-type-suggestions"
			placeholder="e.g. Oil Change"
			aria-invalid={typeError ? 'true' : undefined}
			aria-describedby={typeError ? 'maintenance-type-error' : undefined}
			oninput={clearAsyncFeedback}
			class="mt-1 block h-[52px] w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
		/>
		<datalist id="maintenance-type-suggestions">
			{#each TYPE_SUGGESTIONS as suggestion (suggestion)}
				<option value={suggestion}></option>
			{/each}
		</datalist>
		{#if typeError}
			<p id="maintenance-type-error" role="alert" class="mt-1 text-sm text-destructive">
				{typeError}
			</p>
		{/if}
	</div>

	<div>
		<label for="maintenance-odometer" class="block text-sm font-medium text-foreground">
			Odometer <span class="text-muted-foreground">(optional)</span>
		</label>
		<input
			bind:this={odometerInput}
			bind:value={odometerValue}
			id="maintenance-odometer"
			type="text"
			inputmode="decimal"
			placeholder="e.g. 87400"
			aria-invalid={odometerError ? 'true' : undefined}
			aria-describedby={odometerError
				? `${odometerHelpId} maintenance-odometer-error`
				: odometerHelpId}
			oninput={clearAsyncFeedback}
			class="mt-1 block h-[52px] w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
		/>
		<p id={odometerHelpId} class="mt-1 text-sm text-muted-foreground">
			Maintenance entries keep the odometer value exactly as entered. Settings do not relabel it.
		</p>
		{#if odometerError}
			<p id="maintenance-odometer-error" role="alert" class="mt-1 text-sm text-destructive">
				{odometerError}
			</p>
		{/if}
	</div>

	<div>
		<label for="maintenance-cost" class="block text-sm font-medium text-foreground"> Cost </label>
		<div class="mt-1 flex gap-2">
			<input
				bind:this={costInput}
				bind:value={costValue}
				id="maintenance-cost"
				type="text"
				inputmode="decimal"
				placeholder="e.g. 78.00"
				aria-invalid={costError ? 'true' : undefined}
				aria-describedby={costError ? 'maintenance-cost-error' : undefined}
				oninput={clearAsyncFeedback}
				class="block h-[52px] w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
			/>
			<select
				bind:value={currency}
				aria-label="Currency"
				class="h-[52px] shrink-0 rounded-lg border border-border bg-card px-2 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
			>
				{#each currencyOptions as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</div>
		<CurrencyChips recent={recentCurrencies} selected={currency} onpick={(c) => (currency = c)} />
		{#if costError}
			<p id="maintenance-cost-error" role="alert" class="mt-1 text-sm text-destructive">
				{costError}
			</p>
		{/if}
	</div>

	<div>
		<label for="maintenance-notes" class="block text-sm font-medium text-foreground">
			Notes <span class="text-muted-foreground">(optional)</span>
		</label>
		<textarea
			bind:value={notesValue}
			id="maintenance-notes"
			rows="4"
			placeholder="Add any details worth remembering"
			oninput={clearAsyncFeedback}
			class="mt-1 block w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
		></textarea>
	</div>

	{#if showSuccessMessage && saveState.status === 'success'}
		<div
			role="status"
			aria-live="polite"
			class="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success"
		>
			{successMessage}
		</div>
	{/if}

	{#if saveState.status === 'error'}
		<div
			role="alert"
			aria-live="assertive"
			class="rounded-xl border border-destructive/20 bg-destructive/10 p-4"
		>
			<p class="text-sm text-destructive">{saveState.error.message}</p>
		</div>
	{/if}

	<div class="flex gap-3">
		{#if isEditMode}
			<button
				type="button"
				onclick={() => {
					clearAsyncFeedback();
					onCancel();
				}}
				class="h-[56px] flex-1 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground"
			>
				Cancel
			</button>
		{/if}

		<button
			type="submit"
			disabled={saveState.status === 'loading'}
			aria-busy={saveState.status === 'loading'}
			class="h-[56px] flex-1 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-70"
		>
			{#if saveState.status === 'loading'}
				Saving…
			{:else if isEditMode}
				Save changes
			{:else}
				Save
			{/if}
		</button>
	</div>
</form>
