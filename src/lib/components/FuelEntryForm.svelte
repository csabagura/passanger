<script lang="ts">
	import { onDestroy, getContext } from 'svelte';
	import type { Snippet } from 'svelte';
	import { getAllFuelLogs, saveFuelLog, updateFuelLogsAtomic } from '$lib/db/repositories/fuelLogs';
	import { saveErrorMessage } from '$lib/utils/saveErrorMessage';
	import type { FuelLog, NewFuelLog } from '$lib/db/schema';
	import {
		fuelDraft,
		clearFuelDraft,
		consumeFuelDraftStale,
		getLastUsedCurrency,
		setLastUsedCurrency,
		getRecentCurrencies
	} from '$lib/state/draftStore';
	import { PRESET_CURRENCIES } from '$lib/config';
	import CurrencyChips from '$lib/components/capture/CurrencyChips.svelte';
	import ConsumptionSparkline from '$lib/components/ConsumptionSparkline.svelte';
	import { Field } from '$lib/components/ui/field';
	import {
		classifyOdometer,
		medianDelta,
		suggestNextOdometer
	} from '$lib/utils/odometerSuggestion';
	import {
		calculateConsumption,
		formatConsumptionForDisplay,
		formatCurrency,
		getDistanceUnitForFuelUnit,
		getVolumeUnitForFuelUnit
	} from '$lib/utils/calculations';
	import {
		buildFuelLogUpdatePlan,
		getFuelLogPredecessor,
		getFuelLogSuccessor,
		sortFuelLogsForTimeline
	} from '$lib/utils/fuelLogTimeline';
	import { consumptionTrend } from '$lib/utils/analytics';
	import type { ToastApi } from '$lib/state/toast';
	import {
		getLocaleNumberSeparators,
		isGroupedOdometerValue,
		normalizeGroupingWhitespace,
		parseNonNegativeNumeric,
		parsePositiveNumeric
	} from '$lib/utils/numberInput';
	import type { AppError } from '$lib/utils/result';
	import type { AppSettings } from '$lib/utils/settings';
	import { m } from '$lib/paraglide/messages';

	type FormMode = 'create' | 'edit';
	type FuelEntrySaveResult = FuelLog | FuelLog[];

	interface Props {
		vehicleId: number;
		onSave: (result: FuelEntrySaveResult) => void;
		mode?: FormMode;
		initialFuelLog?: FuelLog;
		timelineContextVersion?: number;
		onCancel?: () => void;
		onSuccessFeedbackComplete?: () => void;
		onFirstCreateSave?: (log: FuelLog) => void;
		successRegionAddon?: Snippet;
	}

	let {
		vehicleId,
		onSave,
		mode = 'create',
		initialFuelLog = undefined,
		timelineContextVersion = 0,
		onCancel = () => {},
		onSuccessFeedbackComplete = () => {},
		onFirstCreateSave = () => {},
		successRegionAddon
	}: Props = $props();

	const settingsCtx = getContext<{ settings: AppSettings }>('settings');
	// AD-2: the single toast channel (Story 2.4 is its first production emitter — the save error path).
	// Optional: the form can render outside the layout in isolated tests; guard every call with `?.`.
	const toast = getContext<ToastApi | undefined>('toast');
	const isEditMode = $derived(mode === 'edit' && initialFuelLog !== undefined);

	// Story 2.3 (AC-4): a draft restored after DRAFT_STALE_DAYS had its odometer dropped and
	// re-suggested. Show a calm, non-blocking notice ONCE per stale restore, create path only —
	// consume() resets the flag so it does not re-fire on remount / Fuel↔Expense segment toggle.
	const showStaleDraftNotice = getInitialLog() ? false : consumeFuelDraftStale();

	function getInitialLog(): FuelLog | undefined {
		return mode === 'edit' ? initialFuelLog : undefined;
	}

	const currentFuelUnit = $derived(
		isEditMode && initialFuelLog
			? initialFuelLog.unit
			: getVolumeUnitForFuelUnit(settingsCtx.settings.fuelUnit)
	);
	const currentDistanceUnit = $derived(
		isEditMode && initialFuelLog
			? initialFuelLog.distanceUnit
			: getDistanceUnitForFuelUnit(settingsCtx.settings.fuelUnit)
	);

	let odometer = $state(
		getInitialLog() ? String(getInitialLog()!.odometer) : (fuelDraft['odometer'] ?? '')
	);
	let quantity = $state(
		getInitialLog() ? String(getInitialLog()!.quantity) : (fuelDraft['quantity'] ?? '')
	);
	let cost = $state(
		getInitialLog() ? String(getInitialLog()!.totalCost) : (fuelDraft['cost'] ?? '')
	);
	// Currency the cost is entered in. Edit: the entry's own currency; create: the last
	// currency the user picked this session (so a trip stays consistent), else home.
	let currency = $state(
		getInitialLog()
			? (getInitialLog()!.currency ?? settingsCtx.settings.currency)
			: (getLastUsedCurrency() ?? settingsCtx.settings.currency)
	);
	const currencyOptions = $derived.by(() => {
		const presets = PRESET_CURRENCIES as readonly string[];
		return presets.includes(currency) ? [...presets] : [currency, ...presets];
	});

	// Field forwards no element ref, so focus recovery (mount auto-focus + first-invalid-field)
	// targets the stable id passed to each Field — the proven story-1-5 migration pattern. We scope
	// the lookup to THIS form (formEl), NOT document.getElementById: /log keeps an inline form mounted
	// while the global Capture sheet mounts a SECOND instance with the SAME ids, so a document-wide
	// lookup would resolve to whichever is first in tree order (the page form) and mis-target the
	// sheet form's focus. The history-retry button is NOT a Field, so it keeps its bind:this ref.
	let formEl: HTMLFormElement | undefined = $state();
	function focusField(id: string): void {
		// `[id="…"]` (not `#id`) so the lookup stays scoped to formEl in every engine — jsdom's nwsapi
		// resolves `#id` document-wide via a getElementById fast-path, which would defeat the scoping.
		formEl?.querySelector<HTMLElement>(`[id="${id}"]`)?.focus();
	}
	let retryHistoryButton: HTMLButtonElement | undefined = $state();

	let odometerError = $state('');
	let quantityError = $state('');
	let costError = $state('');

	// Story 2.4: save failures now surface on the toast channel (AC-4), not an inline error card, so
	// there is no 'error' display state — the form simply returns to 'idle' (values retained).
	type SaveState =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'success'; data: FuelLog };

	let saveState: SaveState = $state({ status: 'idle' });

	// Story 2.4 (AC-1/2/6): the value-revealing confirmation persists until the user dismisses it or
	// starts another action — NO auto-dismiss timer. The calm status sentence lives in an
	// always-present polite live region (filled here on save), so screen readers announce the change.
	let successText = $state('');
	let previousOdometer = $state<number | undefined>(undefined);
	let pendingHistoryLoad: Promise<void> | null = null;
	let historyLoadRequestId = 0;
	let lastLogLoadError = $state<AppError | null>(null);
	let isRetryingLastLogLoad = $state(false);
	let suppressDraftSync = $state(false);
	let lastLogDistanceUnit: 'km' | 'mi' | undefined = $state();
	let timelineLogs = $state<FuelLog[]>([]);

	const LAST_LOG_LOAD_ERROR_MESSAGE = m.fuel_error_load_history();
	const { group: localeGroupSeparator, decimal: localeDecimalSeparator } =
		getLocaleNumberSeparators();

	function setTimelineState(logs: FuelLog[]) {
		timelineLogs = logs;

		if (isEditMode && initialFuelLog) {
			const logsWithCurrentEntry = logs.some((log) => log.id === initialFuelLog.id)
				? logs
				: [...logs, initialFuelLog];
			const predecessor = getFuelLogPredecessor(logsWithCurrentEntry, initialFuelLog.id);

			previousOdometer = predecessor?.odometer;
			lastLogDistanceUnit = predecessor?.distanceUnit;
			return;
		}

		if (logs.length === 0) {
			previousOdometer = undefined;
			lastLogDistanceUnit = undefined;
			return;
		}

		const lastLog = [...logs].sort((a, b) => b.date.getTime() - a.date.getTime() || b.id - a.id)[0];
		previousOdometer = lastLog.odometer;
		lastLogDistanceUnit = lastLog.distanceUnit;
	}

	// "Start another action" dismissal (AC-2): clears the confirmation WITHOUT closing the sheet /
	// edit form — editing a field or submitting again calls this. Distinct from dismissSuccess().
	function clearSubmissionFeedback() {
		successText = '';
		if (saveState.status !== 'loading') {
			saveState = { status: 'idle' };
		}
	}

	// Explicit dismiss via the "Done" control (AC-2): clears the confirmation AND fires the close
	// seam (CaptureSheet → capture.close(); history edit → clears editingEntry).
	function dismissSuccess() {
		successText = '';
		if (saveState.status === 'success') {
			saveState = { status: 'idle' };
			onSuccessFeedbackComplete();
		}
	}

	function getDisplayedPreviousOdometerHint(): string | null {
		if (previousOdometer === undefined || previousOdometer <= 0) {
			return null;
		}

		return normalizeGroupingWhitespace(previousOdometer.toLocaleString());
	}

	function hasComparablePreviousOdometer(distanceUnit: 'km' | 'mi'): boolean {
		return (
			previousOdometer !== undefined &&
			previousOdometer > 0 &&
			(!lastLogDistanceUnit || lastLogDistanceUnit === distanceUnit)
		);
	}

	// Wraps the shared grouped-odometer detector with this form's timeline context:
	// the previous-odometer hint, a unit-comparable baseline, and the locale-aware
	// whitespace/ambiguous-decimal rules. Defaults in the util reproduce the simpler
	// maintenance-form behavior; here we opt into the fuller fuel-form behavior.
	function odometerLooksGrouped(value: string, parsedValue: number | null): boolean {
		return isGroupedOdometerValue(value, parsedValue, {
			localeGroupSeparator,
			localeDecimalSeparator,
			displayedPreviousOdometerHint: getDisplayedPreviousOdometerHint(),
			comparablePreviousOdometer: hasComparablePreviousOdometer(currentDistanceUnit)
				? (previousOdometer ?? null)
				: null,
			requireLocaleSpaceForWhitespaceGrouping: true,
			checkAmbiguousDecimalSeparator: true,
			hasPreviousOdometer: previousOdometer !== undefined
		});
	}

	// --- Story 2.2: smart defaults (suggestion + non-blocking sanity warning) ---

	// Unit-comparable historical inter-fill deltas: walk consecutive timeline pairs whose
	// distanceUnit both match the current entry's unit, collecting positive odometer jumps.
	// Never mixes km/mi (same rule the form applies via hasComparablePreviousOdometer).
	const comparableDeltas = $derived.by(() => {
		const sorted = sortFuelLogsForTimeline(timelineLogs);
		const deltas: number[] = [];
		for (let index = 1; index < sorted.length; index += 1) {
			const previous = sorted[index - 1];
			const next = sorted[index];
			if (
				previous.distanceUnit !== currentDistanceUnit ||
				next.distanceUnit !== currentDistanceUnit
			) {
				continue;
			}
			const delta = next.odometer - previous.odometer;
			if (delta > 0) {
				deltas.push(delta);
			}
		}
		return deltas;
	});

	const comparablePreviousForSuggestion = $derived(
		hasComparablePreviousOdometer(currentDistanceUnit) ? previousOdometer : undefined
	);

	// The typical inter-fill delta — used both to suggest the next reading and to decide when
	// a reading is implausibly far above the last one.
	const typicalDelta = $derived(medianDelta(comparableDeltas));

	let hasSeededSuggestion = $state(false);

	// Pre-fill the odometer with `last + median delta` exactly once per open, create-mode only,
	// and only when the field (and any in-progress draft) is empty — so it never clobbers a
	// typed/draft value and stands down the moment the user edits. The odometer $state is
	// initialised at component construction BEFORE history loads, so this lives in an $effect
	// keyed on the timeline; it waits (returns without latching) until a suggestion is
	// computable, then seeds once. 0/1 prior logs ⇒ no suggestion ever ⇒ field stays empty.
	$effect(() => {
		if (isEditMode || hasSeededSuggestion) {
			return;
		}
		if (odometer || fuelDraft['odometer']) {
			// A user/draft value already occupies the field — never seed this open.
			hasSeededSuggestion = true;
			return;
		}
		const suggestion = suggestNextOdometer(comparablePreviousForSuggestion, comparableDeltas);
		if (suggestion === undefined) {
			// History not loaded yet, or too few logs — try again when the timeline updates.
			return;
		}
		odometer = String(suggestion);
		hasSeededSuggestion = true;
	});

	// Live, NON-blocking sanity classification of the entered odometer. Create-mode only — the
	// edit path keeps its hard predecessor/successor bounds. Drives the amber warning text.
	const odometerWarning = $derived.by(() => {
		if (isEditMode) {
			return '';
		}
		const parsed = parsePositiveNumeric(odometer);
		if (parsed === null) {
			return '';
		}
		// A thousands-grouped value (e.g. "88,500") parses to a misleading small number
		// (88.5) and would flash a spurious below-previous warning while typing. The save
		// path rejects grouped input with a hard error, so stay silent here until then.
		if (odometerLooksGrouped(odometer, parsed)) {
			return '';
		}
		const anomaly = classifyOdometer(parsed, comparablePreviousForSuggestion, typicalDelta);
		if (anomaly === 'below-previous') {
			return m.fuel_warning_below_previous();
		}
		if (anomaly === 'implausibly-high') {
			return m.fuel_warning_implausible_high();
		}
		return '';
	});

	// Field owns the error id (`odometer-error`); we only thread the amber warning's id when it is
	// the visible advisory (no error). Field merges it with its own error id via aria-describedby.
	const odometerWarningId = $derived(
		!odometerError && odometerWarning ? 'odometer-warning' : undefined
	);

	// Recent-currency chips: re-read the session list after each save (the module store isn't a
	// Svelte store, so a version counter makes the read reactive). CurrencyChips filters out the
	// currently-selected value and renders nothing when the remainder is empty.
	let recentCurrenciesVersion = $state(0);
	const recentCurrencies = $derived(recentCurrenciesVersion >= 0 ? getRecentCurrencies() : []);

	// Story 2.4 (AC-3): consumption series for the confirmation sparkline. `timelineLogs` already
	// includes the just-saved fill (handleSubmit calls setTimelineState([...timelineLogs, saved])
	// before showing the confirmation), so the last point IS the new fill. Reuses the existing
	// analytics helper for data; the SVG itself is rendered by ConsumptionSparkline. Empty for the
	// first/insufficient-data fill (consumption 0 is filtered out) — the card then shows no chart.
	const sparklineValues = $derived(
		consumptionTrend(timelineLogs, settingsCtx.settings.fuelUnit).map((point) => point.consumption)
	);

	function normalizeLastLogLoadError(error?: AppError | null): AppError {
		return {
			code: error?.code ?? 'GET_FAILED',
			message: LAST_LOG_LOAD_ERROR_MESSAGE
		};
	}

	function loadTimelineContext(vehicleIdToLoad: number, options?: { isRetry?: boolean }) {
		const requestId = ++historyLoadRequestId;
		previousOdometer = undefined;
		lastLogDistanceUnit = undefined;
		lastLogLoadError = null;
		isRetryingLastLogLoad = options?.isRetry ?? false;

		const load = (async () => {
			try {
				const logsResult = await getAllFuelLogs(vehicleIdToLoad);
				if (!isComponentMounted || requestId !== historyLoadRequestId) {
					return;
				}

				if (logsResult.error) {
					lastLogLoadError = normalizeLastLogLoadError(logsResult.error);
					return;
				}

				lastLogLoadError = null;
				setTimelineState(logsResult.data ?? []);
			} catch {
				if (!isComponentMounted || requestId !== historyLoadRequestId) {
					return;
				}

				lastLogLoadError = normalizeLastLogLoadError();
			}
		})();

		pendingHistoryLoad = load.finally(() => {
			if (requestId === historyLoadRequestId) {
				pendingHistoryLoad = null;
				isRetryingLastLogLoad = false;
			}
		});
	}

	function retryLastLogLoad() {
		if (pendingHistoryLoad) {
			return;
		}

		loadTimelineContext(vehicleId, { isRetry: true });
	}

	function focusRetryHistoryButton() {
		retryHistoryButton?.focus();
	}

	async function ensureHistoryLoaded() {
		if (!pendingHistoryLoad) {
			return;
		}

		await pendingHistoryLoad;
	}

	let isComponentMounted = $state(true);

	$effect(() => {
		isComponentMounted = true;
		loadTimelineContext(vehicleId);

		return () => {
			isComponentMounted = false;
			historyLoadRequestId += 1;
			pendingHistoryLoad = null;
		};
	});

	$effect(() => {
		if (!isEditMode || initialFuelLog === undefined || timelineContextVersion === 0) {
			return;
		}

		loadTimelineContext(vehicleId);
	});

	$effect(() => {
		if (!isEditMode && !suppressDraftSync) {
			if (odometer) fuelDraft['odometer'] = odometer;
			else delete fuelDraft['odometer'];
			if (quantity) fuelDraft['quantity'] = quantity;
			else delete fuelDraft['quantity'];
			if (cost) fuelDraft['cost'] = cost;
			else delete fuelDraft['cost'];
		}
	});

	$effect(() => {
		focusField('odometer');
	});

	function setFormValuesFromLog(log: FuelLog): void {
		odometer = String(log.odometer);
		quantity = String(log.quantity);
		cost = String(log.totalCost);
	}

	// Story 2.4 (AC-1/5): calm, plain-voice confirmation that reveals the computed consumption + the
	// formatted cost — never the old "✓ Logged — … | … | …" glyph/pipe form. When consumption can't
	// be computed (first fill / unit mismatch / odometer ≤ previous), show an honest, non-alarmist
	// state and still show the cost — never a bare "0".
	function showSuccessResult(log: FuelLog, parsedCost: number, verb: 'Saved' | 'Updated'): void {
		const cost = formatCurrency(parsedCost, log.currency ?? settingsCtx.settings.currency);
		// Treat 0 / negative / non-finite consumption alike as "cannot compute" (an edited or corrupt
		// stored value can be < 0 or NaN) so we never fall through to a bare "0.0 … this tank".
		// i18n (6.1): one complete message template per verb — never glue a translated verb fragment
		// onto the sentence (HU word order differs). `cost`/`consumption` are formatted values, params.
		if (log.calculatedConsumption <= 0 || !Number.isFinite(log.calculatedConsumption)) {
			successText =
				verb === 'Saved'
					? m.fuel_saved_no_consumption({ cost })
					: m.fuel_updated_no_consumption({ cost });
		} else {
			const consumption = formatConsumptionForDisplay(
				log.calculatedConsumption,
				log.unit,
				settingsCtx.settings.fuelUnit
			);
			successText =
				verb === 'Saved'
					? m.fuel_saved_with_consumption({ consumption, cost })
					: m.fuel_updated_with_consumption({ consumption, cost });
		}

		// Remember the chosen currency for the next new entry (travel convenience) and refresh
		// the recent-currency chip list.
		setLastUsedCurrency(currency);
		recentCurrenciesVersion += 1;

		saveState = { status: 'success', data: log };
	}

	async function handleSubmit() {
		if (saveState.status === 'loading') return;

		clearSubmissionFeedback();

		odometerError = '';
		quantityError = '';
		costError = '';

		const parsedOdometer = parsePositiveNumeric(odometer);
		const odometerTrimmed = odometer.trim();
		const hasOdometerGroupingSeparator = odometerLooksGrouped(odometerTrimmed, parsedOdometer);
		if (parsedOdometer === null || hasOdometerGroupingSeparator) {
			odometerError = hasOdometerGroupingSeparator
				? m.fuel_error_odometer_commas()
				: m.form_error_odometer_invalid();
		}

		const parsedQuantity = parsePositiveNumeric(quantity);
		if (parsedQuantity === null) {
			quantityError = m.fuel_error_quantity();
		}

		const parsedCost = parseNonNegativeNumeric(cost);
		if (parsedCost === null) {
			costError = m.fuel_error_cost();
		}

		if (odometerError) {
			focusField('odometer');
			return;
		}
		if (quantityError) {
			focusField('quantity');
			return;
		}
		if (costError) {
			focusField('cost');
			return;
		}

		if (lastLogLoadError) {
			focusRetryHistoryButton();
			return;
		}

		if (parsedOdometer === null || parsedQuantity === null || parsedCost === null) {
			return;
		}

		saveState = { status: 'loading' };
		await ensureHistoryLoaded();
		if (!isComponentMounted) {
			return;
		}
		if (lastLogLoadError) {
			saveState = { status: 'idle' };
			focusRetryHistoryButton();
			return;
		}

		const storageUnit = currentFuelUnit;
		const distanceUnit = currentDistanceUnit;
		const comparablePreviousOdometer = hasComparablePreviousOdometer(distanceUnit)
			? previousOdometer
			: undefined;

		if (odometerLooksGrouped(odometerTrimmed, parsedOdometer)) {
			saveState = { status: 'idle' };
			odometerError = m.fuel_error_odometer_commas();
			focusField('odometer');
			return;
		}

		// Story 2.2: the create path no longer HARD-BLOCKS a below-previous reading — it shows a
		// non-blocking amber warning (odometerWarning) and falls through to Save. Integrity is
		// preserved because calculateConsumption returns 0 for a non-positive distance
		// (calculations.ts) — the same honest "can't compute" sentinel used for first entries.
		// The EDIT path keeps its hard predecessor bound unchanged.
		if (
			isEditMode &&
			comparablePreviousOdometer !== undefined &&
			parsedOdometer <= comparablePreviousOdometer
		) {
			saveState = { status: 'idle' };
			odometerError = m.fuel_error_odometer_too_low();
			focusField('odometer');
			return;
		}

		if (isEditMode && initialFuelLog) {
			const timelineContextLogs = timelineLogs.some((log) => log.id === initialFuelLog.id)
				? timelineLogs
				: [...timelineLogs, initialFuelLog];
			const successor = getFuelLogSuccessor(timelineContextLogs, initialFuelLog.id);
			if (
				successor &&
				successor.distanceUnit === distanceUnit &&
				parsedOdometer >= successor.odometer
			) {
				saveState = { status: 'idle' };
				odometerError = m.fuel_error_odometer_too_high();
				focusField('odometer');
				return;
			}

			const updatedLog: FuelLog = {
				...initialFuelLog,
				odometer: parsedOdometer,
				quantity: parsedQuantity,
				unit: storageUnit,
				distanceUnit,
				totalCost: parsedCost,
				currency
			};

			const updatePlan = buildFuelLogUpdatePlan(timelineContextLogs, updatedLog);
			const result = await updateFuelLogsAtomic(updatePlan);
			if (!isComponentMounted) {
				return;
			}

			if (result.error) {
				// AC-4: surface the failure on the toast channel and RETAIN the form values (no draft
				// clear, no field reset) so the user can fix and retry. saveErrorMessage maps quota to
				// the specific actionable message and never leaks raw exception text.
				toast?.error(saveErrorMessage(result.error, m.fuel_error_update_failed()));
				saveState = { status: 'idle' };
				return;
			}

			const savedEditedLog = result.data.find((log) => log.id === initialFuelLog.id) ?? null;

			const completedLog = savedEditedLog ?? {
				...updatedLog,
				calculatedConsumption:
					updatePlan.find((patch) => patch.id === initialFuelLog.id)?.changes
						.calculatedConsumption ?? updatedLog.calculatedConsumption
			};

			setFormValuesFromLog(completedLog);
			showSuccessResult(completedLog, parsedCost, 'Updated');
			onSave(result.data.length > 0 ? result.data : [completedLog]);
			return;
		}

		let consumption: number;
		if (
			previousOdometer !== undefined &&
			lastLogDistanceUnit &&
			lastLogDistanceUnit !== distanceUnit
		) {
			consumption = 0;
		} else {
			consumption = calculateConsumption(
				parsedOdometer,
				previousOdometer,
				parsedQuantity,
				storageUnit
			);
		}

		const entry: NewFuelLog = {
			vehicleId,
			date: new Date(),
			odometer: parsedOdometer,
			quantity: parsedQuantity,
			unit: storageUnit,
			distanceUnit,
			totalCost: parsedCost,
			currency,
			calculatedConsumption: consumption,
			notes: ''
		};

		const result = await saveFuelLog(entry);
		if (!isComponentMounted) {
			return;
		}

		if (result.error) {
			// AC-4: error → toast, and the draft is RETAINED (clearFuelDraft is only called on success
			// below). Routing through saveErrorMessage closes the deferred "fuel ADD path shows raw
			// exception text" item — quota gets its specific message, everything else a friendly one.
			toast?.error(saveErrorMessage(result.error, m.fuel_error_save_failed()));
			saveState = { status: 'idle' };
			return;
		}

		suppressDraftSync = true;
		clearFuelDraft();
		const isFirstCreateSave = timelineLogs.length === 0;
		setTimelineState([...timelineLogs, result.data]);
		odometer = '';
		quantity = '';
		cost = '';
		// Allow the next entry in a long session to re-seed its odometer suggestion from the
		// freshly-updated timeline (the field was just cleared).
		hasSeededSuggestion = false;
		Promise.resolve().then(() => {
			suppressDraftSync = false;
		});

		showSuccessResult(result.data, parsedCost, 'Saved');
		if (isFirstCreateSave) {
			onFirstCreateSave(result.data);
		}
		onSave(result.data);
	}

	onDestroy(() => {
		isComponentMounted = false;
	});
</script>

<form
	bind:this={formEl}
	onsubmit={(e) => {
		e.preventDefault();
		handleSubmit();
	}}
	class="space-y-5"
>
	{#if showStaleDraftNotice}
		<!-- Story 2.3 (AC-4): calm, non-blocking stale-restore notice. Polite live region, NO
		     role="alert"; neutral text-muted-foreground (informational, not the amber warning). -->
		<p aria-live="polite" class="text-sm text-muted-foreground">
			{m.fuel_stale_draft_notice()}
		</p>
	{/if}
	<div>
		<Field
			id="odometer"
			label={m.fuel_field_odometer({ unit: currentDistanceUnit })}
			type="text"
			inputmode="decimal"
			bind:value={odometer}
			error={odometerError}
			aria-describedby={odometerWarningId}
			oninput={clearSubmissionFeedback}
		/>
		{#if previousOdometer !== undefined && previousOdometer > 0}
			<p class="mt-2 text-xs text-muted-foreground">
				{m.fuel_previous_odometer({
					value: previousOdometer.toLocaleString(),
					unit: lastLogDistanceUnit || currentDistanceUnit
				})}
			</p>
		{/if}
		{#if !odometerError && odometerWarning}
			<!-- Story 2.2: non-blocking sanity warning. Soft amber (text-due-soon, DEC-15), polite
			     live region, NO role="alert" — distinct from the destructive Field error. Threaded
			     into the odometer Field via aria-describedby (odometerWarningId). -->
			<p id="odometer-warning" aria-live="polite" class="mt-2 text-sm text-due-soon">
				{odometerWarning}
			</p>
		{/if}
	</div>

	<Field
		id="quantity"
		label={m.fuel_field_quantity({ unit: currentFuelUnit })}
		type="text"
		inputmode="decimal"
		bind:value={quantity}
		error={quantityError}
		oninput={clearSubmissionFeedback}
	/>

	<div>
		<div class="flex items-start gap-2">
			<div class="flex-1">
				<Field
					id="cost"
					label={m.fuel_field_cost()}
					type="text"
					inputmode="decimal"
					bind:value={cost}
					error={costError}
					oninput={clearSubmissionFeedback}
				/>
			</div>
			<select
				bind:value={currency}
				onchange={clearSubmissionFeedback}
				aria-label={m.form_currency_aria()}
				class="mt-7 h-13 shrink-0 rounded-md border border-border bg-background px-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
			>
				{#each currencyOptions as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</div>
		<CurrencyChips recent={recentCurrencies} selected={currency} onpick={(c) => (currency = c)} />
	</div>

	<!-- Story 2.4 (AC-1/2/3/6): the value-revealing save confirmation. The outer wrapper carries the
	     always-present polite live region (role="status") — its text is EMPTY until a save fills it,
	     so screen readers announce the change on save (fixes the inherited announce-on-mount pitfall).
	     The sparkline + Done control mount only on success. Persists until the user dismisses it or
	     starts another action; there is NO auto-dismiss timer. role="alert" stays reserved for
	     destructive errors (handled via the toast channel). -->
	<div
		class={saveState.status === 'success'
			? 'rounded-xl border border-success/30 bg-success/10 p-4'
			: ''}
	>
		<p
			role="status"
			aria-live="polite"
			class={saveState.status === 'success' ? 'text-success' : 'sr-only'}
		>
			{saveState.status === 'success' ? successText : ''}
		</p>
		{#if saveState.status === 'success'}
			{#if !isEditMode && sparklineValues.length > 0}
				<!-- Decorative + create-flow only: the signature point-onto-trend animation is the
				     value-reveal reward for a NEW fill; suppressed in edit mode (no "new tank"
				     semantic, and the timeline isn't re-derived for an edit). The accessible
				     equivalent is the status text above. -->
				<div aria-hidden="true" class="mt-3 text-success">
					<ConsumptionSparkline values={sparklineValues} />
				</div>
			{/if}
			<button
				type="button"
				onclick={dismissSuccess}
				class="mt-3 flex h-[44px] w-full items-center justify-center rounded-lg bg-success/15 px-4 font-medium text-success hover:bg-success/25 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
			>
				{m.form_done()}
			</button>
		{/if}
	</div>

	{@render successRegionAddon?.()}

	{#if lastLogLoadError}
		<div
			role="alert"
			aria-live="assertive"
			class="rounded-lg border border-destructive/20 bg-destructive/10 p-3"
		>
			<p class="text-sm text-destructive">
				{lastLogLoadError.message}
			</p>
			<button
				type="button"
				bind:this={retryHistoryButton}
				onclick={retryLastLogLoad}
				disabled={isRetryingLastLogLoad}
				aria-busy={isRetryingLastLogLoad}
				class="mt-3 rounded-md border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-70"
			>
				{#if isRetryingLastLogLoad}
					{m.fuel_retrying()}
				{:else}
					{m.fuel_retry_load_history()}
				{/if}
			</button>
		</div>
	{/if}

	<div class="flex gap-3">
		{#if isEditMode}
			<button
				type="button"
				onclick={() => {
					clearSubmissionFeedback();
					onCancel();
				}}
				class="h-[56px] flex-1 rounded-lg border border-border px-4 py-2 font-medium text-foreground"
			>
				{m.common_cancel()}
			</button>
		{/if}

		<button
			type="submit"
			disabled={saveState.status === 'loading' || isRetryingLastLogLoad}
			aria-busy={saveState.status === 'loading'}
			class="h-[56px] flex-1 rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
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
