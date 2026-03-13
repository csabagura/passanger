<script lang="ts">
	import { onDestroy, getContext } from 'svelte';
	import type { Snippet } from 'svelte';
	import { getAllFuelLogs, saveFuelLog, updateFuelLogsAtomic } from '$lib/db/repositories/fuelLogs';
	import type { FuelLog, NewFuelLog } from '$lib/db/schema';
	import { fuelDraft, clearFuelDraft } from '$lib/stores/draft';
	import { RESULT_CARD_DISMISS_MS } from '$lib/config';
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
		getFuelLogSuccessor
	} from '$lib/utils/fuelLogTimeline';
	import type { AppError } from '$lib/utils/result';
	import type { AppSettings } from '$lib/utils/settings';

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
	const isEditMode = $derived(mode === 'edit' && initialFuelLog !== undefined);

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

	let odometerInput: HTMLInputElement | undefined = $state();
	let quantityInput: HTMLInputElement | undefined = $state();
	let costInput: HTMLInputElement | undefined = $state();
	let retryHistoryButton: HTMLButtonElement | undefined = $state();

	let odometerError = $state('');
	let quantityError = $state('');
	let costError = $state('');

	type SaveState =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'success'; data: FuelLog }
		| { status: 'error'; error: AppError };

	let saveState: SaveState = $state({ status: 'idle' });

	let showResultCard = $state(false);
	let resultCardTimeout: ReturnType<typeof setTimeout> | null = null;
	let fadeTimeout: ReturnType<typeof setTimeout> | null = null;
	let resultCardOpacity = $state(1);
	let resultFormattedText = $state('');
	let previousOdometer = $state<number | undefined>(undefined);
	let pendingHistoryLoad: Promise<void> | null = null;
	let historyLoadRequestId = 0;
	let lastLogLoadError = $state<AppError | null>(null);
	let isRetryingLastLogLoad = $state(false);
	let suppressDraftSync = $state(false);
	let lastLogDistanceUnit: 'km' | 'mi' | undefined = $state();
	let timelineLogs = $state<FuelLog[]>([]);

	const LAST_LOG_LOAD_ERROR_MESSAGE =
		'Could not load previous fuel history. Try again before saving.';
	const GROUPING_WHITESPACE_PATTERN = /[\s\u00A0\u202F]+/g;
	const localeNumberParts = new Intl.NumberFormat().formatToParts(1000.1);
	const localeGroupSeparator = localeNumberParts.find((part) => part.type === 'group')?.value;
	const localeDecimalSeparator =
		localeNumberParts.find((part) => part.type === 'decimal')?.value ?? '.';

	function normalizeGroupingWhitespace(value: string): string {
		return value.replace(GROUPING_WHITESPACE_PATTERN, ' ').trim();
	}

	function escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function parseGroupedCandidateWithSeparator(value: string, separator: string): number | null {
		const separatorPattern = escapeRegExp(separator);
		const groupedPattern = new RegExp(`^\\d{1,3}(?:${separatorPattern}\\d{3})+$`);
		if (!groupedPattern.test(value)) {
			return null;
		}

		const candidate = Number(value.replace(new RegExp(separatorPattern, 'g'), ''));
		return Number.isFinite(candidate) ? candidate : null;
	}

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

	function hideResultCard() {
		if (resultCardTimeout) {
			clearTimeout(resultCardTimeout);
			resultCardTimeout = null;
		}
		if (fadeTimeout) {
			clearTimeout(fadeTimeout);
			fadeTimeout = null;
		}
		showResultCard = false;
		resultCardOpacity = 1;
	}

	function clearSubmissionFeedback() {
		hideResultCard();
		if (saveState.status !== 'loading') {
			saveState = { status: 'idle' };
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

	function parseGroupedOdometerCandidate(value: string): number | null {
		const trimmed = value.trim();
		if (!trimmed) {
			return null;
		}

		const normalizedWhitespace = normalizeGroupingWhitespace(trimmed);
		const candidates = [
			parseGroupedCandidateWithSeparator(normalizedWhitespace, ' '),
			parseGroupedCandidateWithSeparator(trimmed, ','),
			parseGroupedCandidateWithSeparator(trimmed, '.')
		];

		if (
			localeGroupSeparator &&
			localeGroupSeparator !== ',' &&
			localeGroupSeparator !== '.' &&
			normalizeGroupingWhitespace(localeGroupSeparator) !== ' '
		) {
			candidates.push(parseGroupedCandidateWithSeparator(trimmed, localeGroupSeparator));
		}

		return candidates.find((candidate) => candidate !== null) ?? null;
	}

	function isCollapsedFirstEntryDecimal(value: string, parsedValue: number): boolean {
		if (previousOdometer !== undefined) {
			return false;
		}

		const trimmed = value.trim();
		if (!/^\d{1,3}[,.]\d{3}$/.test(trimmed)) {
			return false;
		}

		if (!trimmed.includes(',')) {
			return false;
		}

		const normalized = trimmed.replace(',', '.');
		const fraction = normalized.match(/\.(\d{3})$/)?.[1];
		if (!fraction) {
			return false;
		}

		const parsedFractionLength = parsedValue.toString().split('.')[1]?.length ?? 0;
		return parsedFractionLength < fraction.length;
	}

	function isGroupedOdometerValue(value: string, parsedValue: number | null): boolean {
		const trimmed = value.trim();
		if (!trimmed) {
			return false;
		}

		const normalizedTrimmed = normalizeGroupingWhitespace(trimmed);
		const displayedHint = getDisplayedPreviousOdometerHint();
		if (displayedHint && normalizedTrimmed === displayedHint) {
			return true;
		}

		const groupedCandidate = parseGroupedOdometerCandidate(trimmed);
		if (groupedCandidate === null) {
			return false;
		}

		if (hasComparablePreviousOdometer(currentDistanceUnit)) {
			if (parsedValue === null) {
				return true;
			}

			return groupedCandidate > previousOdometer! && parsedValue <= previousOdometer!;
		}

		if (parsedValue === null) {
			return true;
		}

		const usesWhitespaceGrouping =
			normalizedTrimmed.includes(' ') &&
			localeGroupSeparator !== undefined &&
			normalizeGroupingWhitespace(localeGroupSeparator) === ' ';
		if (usesWhitespaceGrouping) {
			return true;
		}

		const separatorIsAmbiguousDecimal =
			trimmed.includes(localeDecimalSeparator) && trimmed.includes(localeGroupSeparator ?? '');

		return (
			groupedCandidate >= 1000 &&
			(Number.isInteger(parsedValue) ||
				isCollapsedFirstEntryDecimal(trimmed, parsedValue) ||
				separatorIsAmbiguousDecimal)
		);
	}

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
		odometerInput?.focus();
	});

	function parseNumeric(value: string): number | null {
		if (!value || !value.trim()) return null;
		let normalized = value.trim();

		const commaCount = (normalized.match(/,/g) || []).length;
		const periodCount = (normalized.match(/\./g) || []).length;

		if (commaCount + periodCount > 1) return null;

		if (commaCount === 1) {
			normalized = normalized.replace(',', '.');
		}

		if (!/^-?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;

		const parsed = parseFloat(normalized);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	}

	function parseNonNegativeNumeric(value: string): number | null {
		if (!value || !value.trim()) return null;
		let normalized = value.trim();

		const commaCount = (normalized.match(/,/g) || []).length;
		const periodCount = (normalized.match(/\./g) || []).length;

		if (commaCount + periodCount > 1) return null;

		if (commaCount === 1) {
			normalized = normalized.replace(',', '.');
		}

		if (!/^-?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;

		const parsed = parseFloat(normalized);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
	}

	function setFormValuesFromLog(log: FuelLog): void {
		odometer = String(log.odometer);
		quantity = String(log.quantity);
		cost = String(log.totalCost);
	}

	function showSuccessResult(
		log: FuelLog,
		parsedQuantity: number,
		parsedCost: number,
		prefix: string
	): void {
		if (log.calculatedConsumption === 0) {
			resultFormattedText = `✓ ${prefix} — log one more to calculate efficiency`;
		} else {
			const formatted = formatConsumptionForDisplay(
				log.calculatedConsumption,
				log.unit,
				settingsCtx.settings.fuelUnit
			);
			resultFormattedText = `✓ ${prefix} — ${formatted} | ${formatCurrency(parsedCost, settingsCtx.settings.currency)} | ${parsedQuantity.toFixed(1)} ${log.unit === 'L' ? 'L' : 'gal'}`;
		}

		saveState = { status: 'success', data: log };
		showResultCard = true;
		resultCardOpacity = 1;

		if (resultCardTimeout) clearTimeout(resultCardTimeout);
		if (fadeTimeout) clearTimeout(fadeTimeout);
		resultCardTimeout = setTimeout(() => {
			resultCardOpacity = 0;
			fadeTimeout = setTimeout(() => {
				showResultCard = false;
				resultCardOpacity = 1;
				fadeTimeout = null;
				onSuccessFeedbackComplete();
			}, 150);
		}, RESULT_CARD_DISMISS_MS);
	}

	async function handleSubmit() {
		if (saveState.status === 'loading') return;

		clearSubmissionFeedback();

		odometerError = '';
		quantityError = '';
		costError = '';

		const parsedOdometer = parseNumeric(odometer);
		const odometerTrimmed = odometer.trim();
		const hasOdometerGroupingSeparator = isGroupedOdometerValue(odometerTrimmed, parsedOdometer);
		if (parsedOdometer === null || hasOdometerGroupingSeparator) {
			odometerError = hasOdometerGroupingSeparator
				? 'Enter odometer without commas (e.g. 87400)'
				: 'Enter a valid odometer reading (e.g. 87400)';
		}

		const parsedQuantity = parseNumeric(quantity);
		if (parsedQuantity === null) {
			quantityError = 'Enter the fuel quantity (e.g. 42)';
		}

		const parsedCost = parseNonNegativeNumeric(cost);
		if (parsedCost === null) {
			costError = 'Enter the total cost (e.g. 78.00)';
		}

		if (odometerError) {
			odometerInput?.focus();
			return;
		}
		if (quantityError) {
			quantityInput?.focus();
			return;
		}
		if (costError) {
			costInput?.focus();
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

		if (isGroupedOdometerValue(odometerTrimmed, parsedOdometer)) {
			saveState = { status: 'idle' };
			odometerError = 'Enter odometer without commas (e.g. 87400)';
			odometerInput?.focus();
			return;
		}

		if (comparablePreviousOdometer !== undefined && parsedOdometer <= comparablePreviousOdometer) {
			saveState = { status: 'idle' };
			odometerError = 'Enter an odometer reading higher than the last logged value';
			odometerInput?.focus();
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
				odometerError = 'Enter an odometer reading lower than the next logged value';
				odometerInput?.focus();
				return;
			}

			const updatedLog: FuelLog = {
				...initialFuelLog,
				odometer: parsedOdometer,
				quantity: parsedQuantity,
				unit: storageUnit,
				distanceUnit,
				totalCost: parsedCost
			};

			const updatePlan = buildFuelLogUpdatePlan(timelineContextLogs, updatedLog);
			const result = await updateFuelLogsAtomic(updatePlan);
			if (!isComponentMounted) {
				return;
			}

			if (result.error) {
				saveState = {
					status: 'error',
					error: {
						code: result.error.code,
						message: 'Could not update fuel entry. Please try again.'
					}
				};
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
			showSuccessResult(completedLog, parsedQuantity, parsedCost, 'Updated');
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
			calculatedConsumption: consumption,
			notes: ''
		};

		const result = await saveFuelLog(entry);
		if (!isComponentMounted) {
			return;
		}

		if (result.error) {
			saveState = { status: 'error', error: result.error };
			return;
		}

		suppressDraftSync = true;
		clearFuelDraft();
		const isFirstCreateSave = timelineLogs.length === 0;
		setTimelineState([...timelineLogs, result.data]);
		odometer = '';
		quantity = '';
		cost = '';
		Promise.resolve().then(() => {
			suppressDraftSync = false;
		});

		showSuccessResult(result.data, parsedQuantity, parsedCost, 'Logged');
		if (isFirstCreateSave) {
			onFirstCreateSave(result.data);
		}
		onSave(result.data);
	}

	onDestroy(() => {
		isComponentMounted = false;
		hideResultCard();
	});
</script>

<form
	onsubmit={(e) => {
		e.preventDefault();
		handleSubmit();
	}}
	class="space-y-5"
>
	<div>
		<label for="odometer" class="block text-sm font-medium text-foreground">
			Odometer ({currentDistanceUnit})
		</label>
		<input
			bind:this={odometerInput}
			bind:value={odometer}
			type="text"
			inputmode="decimal"
			id="odometer"
			aria-describedby={odometerError ? 'odometer-error' : undefined}
			aria-invalid={!!odometerError}
			class="mt-1 block h-[52px] w-full rounded-lg border border-border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
		/>
		{#if previousOdometer !== undefined && previousOdometer > 0}
			<p class="mt-1 text-xs text-muted-foreground">
				Last: {previousOdometer.toLocaleString()}
				{` ${lastLogDistanceUnit || currentDistanceUnit}`}
			</p>
		{/if}
		{#if odometerError}
			<p id="odometer-error" role="alert" class="mt-1 text-sm text-destructive">
				{odometerError}
			</p>
		{/if}
	</div>

	<div>
		<label for="quantity" class="block text-sm font-medium text-foreground">
			Quantity ({currentFuelUnit})
		</label>
		<input
			bind:this={quantityInput}
			bind:value={quantity}
			type="text"
			inputmode="decimal"
			id="quantity"
			aria-describedby={quantityError ? 'quantity-error' : undefined}
			aria-invalid={!!quantityError}
			class="mt-1 block h-[52px] w-full rounded-lg border border-border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
		/>
		{#if quantityError}
			<p id="quantity-error" role="alert" class="mt-1 text-sm text-destructive">
				{quantityError}
			</p>
		{/if}
	</div>

	<div>
		<label for="cost" class="block text-sm font-medium text-foreground">
			Total Cost ({settingsCtx.settings.currency})
		</label>
		<input
			bind:this={costInput}
			bind:value={cost}
			type="text"
			inputmode="decimal"
			id="cost"
			aria-describedby={costError ? 'cost-error' : undefined}
			aria-invalid={!!costError}
			class="mt-1 block h-[52px] w-full rounded-lg border border-border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
		/>
		{#if costError}
			<p id="cost-error" role="alert" class="mt-1 text-sm text-destructive">
				{costError}
			</p>
		{/if}
	</div>

	{#if showResultCard && saveState.status === 'success'}
		<div
			role="status"
			aria-live="polite"
			style="opacity: {resultCardOpacity};"
			class="rounded-xl border border-success/30 bg-success/10 p-4 motion-safe:transition-opacity motion-safe:duration-150"
		>
			<p class="text-success">
				{resultFormattedText}
			</p>
		</div>
	{/if}

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
					Retrying...
				{:else}
					Retry loading history
				{/if}
			</button>
		</div>
	{/if}

	{#if saveState.status === 'error'}
		<div
			role="alert"
			aria-live="assertive"
			class="rounded-lg border border-destructive/20 bg-destructive/10 p-3"
		>
			<p class="text-sm text-destructive">
				{saveState.error.message}
			</p>
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
				Cancel
			</button>
		{/if}

		<button
			type="submit"
			disabled={saveState.status === 'loading' || isRetryingLastLogLoad}
			aria-busy={saveState.status === 'loading'}
			class="h-[56px] flex-1 rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
		>
			{#if saveState.status === 'loading'}
				Saving...
			{:else if isEditMode}
				Save changes
			{:else}
				Save
			{/if}
		</button>
	</div>
</form>
