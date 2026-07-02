<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import { PRESET_CURRENCIES } from '$lib/config';
	import { saveExpense, updateExpense, getAllExpenses } from '$lib/db/repositories/expenses';
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
	import { Field } from '$lib/components/ui/field';
	import { Label } from '$lib/components/ui/label';
	import {
		formatLocalCalendarDate,
		getTodayDateInputValue,
		parseDateInputValue,
		toLocalDateInputValue
	} from '$lib/utils/date';
	import { formatCurrency } from '$lib/utils/calculations';
	import { isGroupedOdometerValue, parseNonNegativeNumeric } from '$lib/utils/numberInput';
	import type { AppSettings } from '$lib/utils/settings';
	import type { ToastApi } from '$lib/state/toast';
	import { m } from '$lib/paraglide/messages';

	type FormMode = 'create' | 'edit';

	interface Props {
		vehicleId: number;
		onSave: (expense: Expense) => void;
		mode?: FormMode;
		initialExpense?: Expense;
		onCancel?: () => void;
		onSuccessFeedbackComplete?: () => void;
		onFirstCreateSave?: (expense: Expense) => void;
		// Story 4.6 (FR-12 loop-close): fired on EVERY create save (unlike onFirstCreateSave, which is
		// once-ever) so the layout can offer to reset a token-matching reminder. Create-only — gated to
		// the `!isEditMode` branch so editing an old expense's type never pops a reset offer.
		onCreateSave?: (expense: Expense) => void;
		// Story 3.5: "Log this service" pre-fills the Type with a reminder title. Create mode only;
		// the reminder title wins over a stale durable draft. The form mounts fresh on each Capture
		// open, so seeding via the $state initializer (NOT an $effect) is correct — see CaptureSheet.
		initialType?: string;
	}

	// Story 2.4: save failures surface on the toast channel (AC-4/7), not an inline error card, so
	// there is no 'error' display state — the form returns to 'idle' with values retained.
	type SaveState =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'success'; data: Expense };

	// i18n (6.1): UI affordance labels that prefill the free-text Type field (OQ3 default — a HU user
	// therefore stores Hungarian type names, which is their data). The 'maintenance' entity/enum is
	// unaffected; only these suggestion labels are translated.
	const TYPE_SUGGESTIONS = [
		m.maintenance_type_tyres(),
		m.maintenance_type_oil_change(),
		m.maintenance_type_service(),
		m.maintenance_type_insurance(),
		m.maintenance_type_other()
	];

	let {
		vehicleId,
		onSave,
		mode = 'create',
		initialExpense = undefined,
		onCancel = () => {},
		onSuccessFeedbackComplete = () => {},
		onFirstCreateSave = () => {},
		onCreateSave = () => {},
		initialType = undefined
	}: Props = $props();

	let hasCreatedFirstSave = $state(false);

	const settingsCtx = getContext<{ settings: AppSettings }>('settings');
	// AD-2: shared toast channel for the save-error path (AC-7). Optional — guard calls with `?.` so
	// the form still works when rendered outside the layout (isolated tests).
	const toast = getContext<ToastApi | undefined>('toast');

	const isEditMode = $derived(mode === 'edit' && initialExpense !== undefined);

	// Story 3.3 (code-review AC-7): the install/survey gate must fire only on the user's FIRST-EVER
	// expense, not once per Capture-sheet open. The global sheet remounts this form on every open, so
	// the instance flag alone re-arms each session. Seed it from the DB — mirroring the fuel form's
	// `timelineLogs.length === 0` guard — so a vehicle that already has expenses never re-fires. The
	// seed only ever SETS the flag true, so it stays FR40-safe: if the read has not resolved by save
	// time the guard is still false and the gate fires. Create mode only.
	$effect(() => {
		if (isEditMode) {
			return;
		}
		let cancelled = false;
		getAllExpenses(vehicleId).then((result) => {
			if (!cancelled && !result.error && result.data.length > 0) {
				hasCreatedFirstSave = true;
			}
		});
		return () => {
			cancelled = true;
		};
	});

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
	// Story 3.5: a "Log this service" prefill wins over a stale durable draft. Capturing only the
	// initial value is intentional — the form mounts fresh on each Capture open, so this initializer
	// re-seeds every time; an $effect would clobber the user's typing. Hence the svelte-ignore.
	// svelte-ignore state_referenced_locally
	let typeValue = $state(
		getInitialExpense()
			? getInitialExpense()!.type
			: (initialType ?? maintenanceDraft['type'] ?? '')
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

	// Field wraps its own input and forwards no element ref, so first-invalid-field focus targets
	// the stable id passed to each Field (the proven story-1-5 migration pattern). We scope the lookup
	// to THIS form (formEl), NOT document.getElementById: /history (and /log) can keep an inline form
	// mounted while the global Capture sheet mounts a SECOND instance with the SAME ids, so a
	// document-wide lookup would resolve to whichever is first in tree order and mis-target focus.
	let formEl: HTMLFormElement | undefined = $state();
	function focusField(id: string): void {
		// `[id="…"]` (not `#id`) so the lookup stays scoped to formEl in every engine — jsdom's nwsapi
		// resolves `#id` document-wide via a getElementById fast-path, which would defeat the scoping.
		formEl?.querySelector<HTMLElement>(`[id="${id}"]`)?.focus();
	}

	let saveState = $state<SaveState>({ status: 'idle' });
	// Story 2.4 (AC-7): the confirmation persists until dismissed or another action starts — NO
	// auto-dismiss timer. The calm message lives in an always-present polite live region.
	let successMessage = $state('');
	let showSuccessMessage = $state(false);
	// A11Y-1 (Story 6.3): mirror FuelEntryForm — bump an invisible zero-width-space nonce each save so
	// two byte-identical maintenance-save messages still present as a text change and re-announce to
	// screen readers (a polite region whose text looks unchanged can be suppressed). Bounded toggle.
	let announceNonce = $state(0);
	let isComponentMounted = $state(true);

	// "Start another action" dismissal (AC-7): clears the confirmation WITHOUT closing the sheet /
	// edit form. Wired to every field's oninput. Distinct from dismissSuccess().
	function clearAsyncFeedback() {
		showSuccessMessage = false;
		if (saveState.status !== 'loading') {
			saveState = { status: 'idle' };
		}
	}

	// Explicit dismiss via the "Done" control (AC-7): clears the confirmation AND fires the close
	// seam (CaptureSheet → capture.close(); history edit → clears editingEntry).
	function dismissSuccess() {
		showSuccessMessage = false;
		if (saveState.status === 'success') {
			saveState = { status: 'idle' };
			onSuccessFeedbackComplete();
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
			dateError = m.maintenance_error_date();
		}

		if (!typeValue.trim()) {
			typeError = m.maintenance_error_type();
		}

		const parsedOdometer =
			odometerValue.trim() === '' ? undefined : parseNonNegativeNumeric(odometerValue);
		if (odometerValue.trim() !== '') {
			if (parsedOdometer === null) {
				odometerError = m.form_error_odometer_invalid();
			} else if (isGroupedOdometerValue(odometerValue, parsedOdometer ?? null)) {
				odometerError = m.maintenance_error_odometer_grouping();
			}
		}

		const parsedCost = parseNonNegativeNumeric(costValue);
		if (parsedCost === null) {
			costError = m.maintenance_error_cost();
		}

		if (dateError) {
			focusField('maintenance-date');
			return;
		}
		if (typeError) {
			focusField('maintenance-type');
			return;
		}
		if (odometerError) {
			focusField('maintenance-odometer');
			return;
		}
		if (costError) {
			focusField('maintenance-cost');
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
			// AC-7: surface failures on the toast channel and RETAIN the form values (no draft clear,
			// no field reset). saveErrorMessage maps quota to its specific message, never raw text.
			toast?.error(
				saveErrorMessage(
					result.error,
					isEditMode ? m.maintenance_error_update_failed() : m.maintenance_error_save_failed()
				)
			);
			saveState = { status: 'idle' };
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
		// i18n (6.1): one complete message template per verb — `type` is the user's free text, `cost`
		// is formatCurrency output, `date` is the localized date-seam output; all passed as params so
		// Hungarian word order can differ. Never glue a translated verb onto the sentence.
		const summaryParams = {
			type: result.data.type,
			cost: formatCurrency(result.data.cost, resultCurrency),
			date: formatLocalCalendarDate(result.data.date)
		};
		successMessage = isEditMode
			? m.maintenance_updated_summary(summaryParams)
			: m.maintenance_saved_summary(summaryParams);
		announceNonce += 1; // A11Y-1: force a perceptible delta so identical repeats re-announce.
		showSuccessMessage = true;

		if (!isEditMode && !hasCreatedFirstSave) {
			hasCreatedFirstSave = true;
			onFirstCreateSave(result.data);
		}
		// Story 4.6: create-only loop-close offer. `result.data` is a plain Dexie row (not a $state
		// proxy), so the layout can build the reminder patch from its primitives safely.
		if (!isEditMode) {
			onCreateSave(result.data);
		}
		onSave(result.data);
	}

	onDestroy(() => {
		isComponentMounted = false;
	});
</script>

<form
	bind:this={formEl}
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
			{m.maintenance_stale_draft_notice()}
		</p>
	{/if}
	<Field
		id="maintenance-date"
		label={m.maintenance_field_date()}
		type="date"
		bind:value={dateValue}
		error={dateError}
		oninput={clearAsyncFeedback}
	/>

	<div>
		<Field
			id="maintenance-type"
			label={m.maintenance_field_type()}
			type="text"
			list="maintenance-type-suggestions"
			placeholder={m.maintenance_placeholder_type()}
			bind:value={typeValue}
			error={typeError}
			oninput={clearAsyncFeedback}
		/>
		<datalist id="maintenance-type-suggestions">
			{#each TYPE_SUGGESTIONS as suggestion (suggestion)}
				<option value={suggestion}></option>
			{/each}
		</datalist>
	</div>

	<div>
		<Field
			id="maintenance-odometer"
			label={m.maintenance_field_odometer()}
			type="text"
			inputmode="decimal"
			placeholder={m.maintenance_placeholder_odometer()}
			bind:value={odometerValue}
			error={odometerError}
			aria-describedby={odometerHelpId}
			oninput={clearAsyncFeedback}
		/>
		<p id={odometerHelpId} class="mt-2 text-sm text-muted-foreground">
			{m.maintenance_odometer_help()}
		</p>
	</div>

	<div>
		<div class="flex items-start gap-2">
			<div class="flex-1">
				<Field
					id="maintenance-cost"
					label={m.maintenance_field_cost()}
					type="text"
					inputmode="decimal"
					placeholder={m.maintenance_placeholder_cost()}
					bind:value={costValue}
					error={costError}
					oninput={clearAsyncFeedback}
				/>
			</div>
			<select
				bind:value={currency}
				aria-label={m.form_currency_aria()}
				class="mt-7 h-13 shrink-0 rounded-md border border-border bg-background px-2 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
			>
				{#each currencyOptions as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</div>
		<CurrencyChips recent={recentCurrencies} selected={currency} onpick={(c) => (currency = c)} />
	</div>

	<div class="flex flex-col gap-2">
		<Label for="maintenance-notes" class="text-label text-muted-foreground uppercase">
			{m.form_notes_optional()}
		</Label>
		<textarea
			bind:value={notesValue}
			id="maintenance-notes"
			rows="4"
			placeholder={m.maintenance_placeholder_notes()}
			oninput={clearAsyncFeedback}
			class="w-full rounded-md border border-border bg-card px-3 py-2 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
		></textarea>
	</div>

	<!-- Story 2.4 (AC-6/7): always-present polite live region (role="status"), empty until a save
	     fills it, so screen readers announce the change (announce-on-mount fix). Persists until the
	     user taps Done or starts another action — no auto-dismiss timer. Expenses have no consumption,
	     so there is no sparkline. role="alert" stays reserved for destructive errors (toast channel). -->
	<div
		class={showSuccessMessage && saveState.status === 'success'
			? 'rounded-xl border border-success/30 bg-success/10 p-4'
			: ''}
	>
		<p
			role="status"
			aria-live="polite"
			class={showSuccessMessage && saveState.status === 'success'
				? 'text-sm text-success'
				: 'sr-only'}
		>
			<!-- A11Y-1: trailing zero-width-space nonce toggles each save so byte-identical repeats
			     still present as a text change and re-announce. Invisible to sighted users. -->
			{showSuccessMessage ? successMessage + '\u200B'.repeat(announceNonce % 2) : ''}
		</p>
		{#if showSuccessMessage && saveState.status === 'success'}
			<button
				type="button"
				onclick={dismissSuccess}
				class="mt-3 flex h-[44px] w-full items-center justify-center rounded-lg bg-success/15 px-4 text-sm font-semibold text-success hover:bg-success/25 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
			>
				{m.form_done()}
			</button>
		{/if}
	</div>

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
				{m.common_cancel()}
			</button>
		{/if}

		<button
			type="submit"
			disabled={saveState.status === 'loading'}
			aria-busy={saveState.status === 'loading'}
			class="h-[56px] flex-1 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-70"
		>
			{#if saveState.status === 'loading'}
				{m.form_saving()}
			{:else if isEditMode}
				{m.form_save_changes()}
			{:else}
				{m.common_save()}
			{/if}
		</button>
	</div>
</form>
