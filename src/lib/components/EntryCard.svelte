<script lang="ts">
	import Fuel from '@lucide/svelte/icons/fuel';
	import Wrench from '@lucide/svelte/icons/wrench';
	import type { FuelUnit } from '$lib/config';
	import type { Expense, FuelLog } from '$lib/db/schema';
	import { formatConsumptionForDisplay, formatCurrency } from '$lib/utils/calculations';
	import { formatLocalCalendarDate } from '$lib/utils/date';

	const HISTORY_ACTION_WIDTH = 144;
	const HISTORY_SWIPE_REVEAL_THRESHOLD = 48;
	const HISTORY_SWIPE_SLOP = 12;

	type EntryKind = 'fuel' | 'maintenance';
	type DeleteState = 'idle' | 'armed' | 'loading';
	type ActionPresentation = 'buttons' | 'swipe';
	type EntryPresentation = 'maintenance' | 'history';
	type PointerGestureLock = 'pending' | 'horizontal' | 'vertical';

	type EntryActionRequest =
		| { kind: 'fuel'; entry: FuelLog }
		| { kind: 'maintenance'; entry: Expense };

	type PointerGestureState = {
		pointerId: number;
		startX: number;
		startY: number;
		startTranslateX: number;
		lock: PointerGestureLock;
	};

	interface Props {
		kind: EntryKind;
		entry: FuelLog | Expense;
		entryKey?: string;
		editDisabled?: boolean;
		detailDisabled?: boolean;
		onOpenDetail?: (request: EntryActionRequest) => void;
		onEdit?: (request: EntryActionRequest) => void;
		onDeleteRequest?: (request: EntryActionRequest) => void;
		onDeleteConfirm?: (request: EntryActionRequest) => void;
		onDeleteCancel?: (request: EntryActionRequest) => void;
		deleteState?: DeleteState;
		deleteDisabled?: boolean;
		currency: string;
		preferredFuelUnit?: FuelUnit;
		presentation?: EntryPresentation;
		actionPresentation?: ActionPresentation;
		actionsRevealed?: boolean;
		onActionRevealChange?: (revealed: boolean) => void;
	}

	let {
		kind,
		entry,
		entryKey = undefined,
		editDisabled = false,
		detailDisabled = false,
		onOpenDetail = () => {},
		onEdit = () => {},
		onDeleteRequest = () => {},
		onDeleteConfirm = () => {},
		onDeleteCancel = () => {},
		deleteState = 'idle',
		deleteDisabled = false,
		currency,
		preferredFuelUnit = 'L/100km',
		presentation = 'maintenance',
		actionPresentation = 'buttons',
		actionsRevealed = false,
		onActionRevealChange = () => {}
	}: Props = $props();

	let pointerGesture = $state<PointerGestureState | null>(null);
	let dragTranslateX = $state<number | null>(null);
	let suppressDetailOpen = $state(false);

	const deletePromptVisible = $derived(deleteState === 'armed' || deleteState === 'loading');
	const restingTranslateX = $derived(
		actionPresentation === 'swipe' && !deletePromptVisible && actionsRevealed
			? -HISTORY_ACTION_WIDTH
			: 0
	);
	const cardTranslateX = $derived(
		actionPresentation === 'swipe' ? (dragTranslateX ?? restingTranslateX) : 0
	);

	function isFuelEntry(value: FuelLog | Expense): value is FuelLog {
		return 'quantity' in value;
	}

	function clampTranslateX(value: number): number {
		return Math.min(0, Math.max(-HISTORY_ACTION_WIDTH, value));
	}

	function getFuelEfficiencyLabel(fuelEntry: FuelLog): string {
		return fuelEntry.calculatedConsumption > 0
			? formatConsumptionForDisplay(
					fuelEntry.calculatedConsumption,
					fuelEntry.unit,
					preferredFuelUnit
				)
			: 'Efficiency pending';
	}

	function getHistorySecondaryDetail(): string {
		if (isFuelEntry(entry)) {
			return `${entry.quantity} ${entry.unit} · ${getFuelEfficiencyLabel(entry)}`;
		}

		return entry.type;
	}

	function getEntryLabel(): string {
		if (presentation !== 'history') {
			if (isFuelEntry(entry)) {
				const efficiencyLabel =
					entry.calculatedConsumption > 0 ? getFuelEfficiencyLabel(entry) : 'efficiency pending';

				return `Fuel entry, ${formatLocalCalendarDate(entry.date)}, ${entry.quantity} ${entry.unit}, ${formatCurrency(entry.totalCost, currency)}, ${efficiencyLabel}`;
			}

			return `Maintenance entry, ${formatLocalCalendarDate(entry.date)}, ${entry.type}, ${formatCurrency(entry.cost, currency)}`;
		}

		if (isFuelEntry(entry)) {
			return `Fuel entry, ${formatLocalCalendarDate(entry.date)}, ${formatCurrency(entry.totalCost, currency)}, ${getHistorySecondaryDetail()}`;
		}

		return `Maintenance entry, ${formatLocalCalendarDate(entry.date)}, ${formatCurrency(entry.cost, currency)}, ${entry.type}`;
	}

	function getEntryContextLabel(): string {
		return `${kind} entry from ${formatLocalCalendarDate(entry.date)}`;
	}

	function getEntryActionRequest(): EntryActionRequest {
		if (isFuelEntry(entry)) {
			return { kind: 'fuel', entry };
		}

		return { kind: 'maintenance', entry };
	}

	function requestActionReveal(nextRevealed: boolean): void {
		if (actionPresentation !== 'swipe' || deletePromptVisible) {
			return;
		}

		onActionRevealChange(nextRevealed);
	}

	function suppressDetailOpenForCurrentGesture(): void {
		suppressDetailOpen = true;
		setTimeout(() => {
			suppressDetailOpen = false;
		}, 0);
	}

	function resetGestureState(): void {
		pointerGesture = null;
		dragTranslateX = null;
	}

	function handlePointerDown(
		event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		if (actionPresentation !== 'swipe' || deletePromptVisible) {
			return;
		}

		suppressDetailOpen = false;
		pointerGesture = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startTranslateX: restingTranslateX,
			lock: 'pending'
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
	}

	function handlePointerMove(
		event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) {
			return;
		}

		const deltaX = event.clientX - pointerGesture.startX;
		const deltaY = event.clientY - pointerGesture.startY;

		if (pointerGesture.lock === 'pending') {
			if (Math.abs(deltaX) < HISTORY_SWIPE_SLOP && Math.abs(deltaY) < HISTORY_SWIPE_SLOP) {
				return;
			}

			if (Math.abs(deltaY) > Math.abs(deltaX)) {
				pointerGesture = { ...pointerGesture, lock: 'vertical' };
				dragTranslateX = null;
				return;
			}

			if (deltaX > 0 && !actionsRevealed) {
				requestActionReveal(false);
				resetGestureState();
				return;
			}

			pointerGesture = { ...pointerGesture, lock: 'horizontal' };
		}

		if (pointerGesture.lock !== 'horizontal') {
			return;
		}

		event.preventDefault();
		dragTranslateX = clampTranslateX(pointerGesture.startTranslateX + deltaX);
	}

	function commitPointerGesture(): void {
		if (!pointerGesture || pointerGesture.lock !== 'horizontal') {
			resetGestureState();
			return;
		}

		const nextTranslateX = dragTranslateX ?? pointerGesture.startTranslateX;
		const shouldReveal =
			nextTranslateX <=
			(actionsRevealed
				? -(HISTORY_ACTION_WIDTH - HISTORY_SWIPE_REVEAL_THRESHOLD)
				: -HISTORY_SWIPE_REVEAL_THRESHOLD);

		suppressDetailOpenForCurrentGesture();
		requestActionReveal(shouldReveal);
		resetGestureState();
	}

	function handlePointerUp(
		event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) {
			return;
		}

		event.currentTarget.releasePointerCapture?.(event.pointerId);
		commitPointerGesture();
	}

	function handlePointerCancel(
		event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) {
			return;
		}

		event.currentTarget.releasePointerCapture?.(event.pointerId);
		suppressDetailOpenForCurrentGesture();
		requestActionReveal(false);
		resetGestureState();
	}

	function handleToggleActions(): void {
		requestActionReveal(!actionsRevealed);
	}

	function handleEdit(): void {
		if (editDisabled) {
			return;
		}

		onEdit(getEntryActionRequest());
		requestActionReveal(false);
	}

	function handleDeleteRequest(): void {
		onDeleteRequest(getEntryActionRequest());
	}

	function handleDeleteConfirm(): void {
		onDeleteConfirm(getEntryActionRequest());
		requestActionReveal(false);
	}

	function handleDeleteCancel(): void {
		onDeleteCancel(getEntryActionRequest());
		requestActionReveal(false);
	}

	function handleOpenDetail(): void {
		if (presentation !== 'history' || detailDisabled || deletePromptVisible) {
			return;
		}

		if (suppressDetailOpen) {
			suppressDetailOpen = false;
			return;
		}

		requestActionReveal(false);
		onOpenDetail(getEntryActionRequest());
	}

	function handleOpenDetailKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}

		event.preventDefault();
		handleOpenDetail();
	}
</script>

{#snippet cardSummary()}
	<div class="flex items-start justify-between gap-4">
		<div class="flex min-w-0 items-start gap-3">
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
			>
				{#if isFuelEntry(entry)}
					<Fuel size={18} aria-hidden="true" />
				{:else}
					<Wrench size={18} aria-hidden="true" />
				{/if}
			</div>

			<div class="min-w-0 space-y-1">
				{#if presentation === 'history'}
					<p class="text-sm text-muted-foreground">{formatLocalCalendarDate(entry.date)}</p>
					{#if isFuelEntry(entry)}
						<h3 class="truncate text-base font-semibold text-foreground">Fuel</h3>
					{:else}
						<h3 class="truncate text-base font-semibold text-foreground">Maintenance</h3>
					{/if}
					<p class="text-sm text-muted-foreground">{getHistorySecondaryDetail()}</p>
				{:else if isFuelEntry(entry)}
					<h3 class="truncate text-base font-semibold text-foreground">
						Fuel
						<span class="font-normal text-muted-foreground">
							{entry.quantity}
							{entry.unit}
						</span>
					</h3>
					<p class="text-sm text-muted-foreground">
						{entry.odometer.toLocaleString()}
						{entry.distanceUnit}
						{#if entry.calculatedConsumption > 0}
							·
							{getFuelEfficiencyLabel(entry)}
						{:else}
							· Efficiency pending
						{/if}
					</p>
				{:else}
					<h3 class="truncate text-base font-semibold text-foreground">{entry.type}</h3>
					<p class="text-sm text-muted-foreground">
						{#if entry.odometer !== undefined}
							{entry.odometer.toLocaleString()}
							·
						{/if}
						{formatLocalCalendarDate(entry.date)}
					</p>
				{/if}
			</div>
		</div>

		<div class="shrink-0 text-right">
			<p class="text-sm font-semibold text-foreground">
				{formatCurrency(isFuelEntry(entry) ? entry.totalCost : entry.cost, currency)}
			</p>
			{#if presentation !== 'history' && isFuelEntry(entry)}
				<p class="mt-1 text-xs text-muted-foreground">{formatLocalCalendarDate(entry.date)}</p>
			{/if}
		</div>
	</div>
{/snippet}

<div
	class:relative={actionPresentation === 'swipe'}
	class:overflow-hidden={actionPresentation === 'swipe'}
>
	{#if actionPresentation === 'swipe' && !deletePromptVisible}
		<div
			class="absolute inset-y-0 right-0 flex w-36 items-stretch justify-end overflow-hidden rounded-2xl"
			aria-hidden={!actionsRevealed}
		>
			<button
				type="button"
				onclick={handleEdit}
				disabled={editDisabled}
				tabindex={actionsRevealed ? 0 : -1}
				aria-label={`Edit ${getEntryContextLabel()}`}
				class="flex-1 bg-card px-4 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-70"
			>
				Edit
			</button>
			<button
				type="button"
				onclick={handleDeleteRequest}
				disabled={deleteDisabled}
				tabindex={actionsRevealed ? 0 : -1}
				aria-label={`Delete ${getEntryContextLabel()}`}
				class="flex-1 bg-destructive px-4 text-sm font-semibold text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-70"
			>
				Delete
			</button>
		</div>
	{/if}

	<div
		role="group"
		aria-label={getEntryLabel()}
		tabindex="-1"
		data-entry-key={entryKey}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerCancel}
		style={actionPresentation === 'swipe'
			? `transform: translateX(${cardTranslateX}px); touch-action: pan-y;`
			: undefined}
		class={`rounded-2xl border border-border bg-card p-4 shadow-sm ${
			actionPresentation === 'swipe'
				? dragTranslateX === null
					? 'relative motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out'
					: 'relative'
				: ''
		}`}
	>
		{#if presentation === 'history'}
			<button
				type="button"
				aria-haspopup="dialog"
				aria-label={`View details for ${getEntryContextLabel()}`}
				disabled={detailDisabled || deletePromptVisible}
				onclick={handleOpenDetail}
				onkeydown={handleOpenDetailKeydown}
				class="block w-full text-left disabled:cursor-not-allowed disabled:opacity-70"
			>
				{@render cardSummary()}
			</button>
		{:else}
			{@render cardSummary()}
		{/if}

		{#if presentation !== 'history' && !isFuelEntry(entry) && entry.notes?.trim()}
			<p class="mt-3 whitespace-pre-line text-sm text-muted-foreground">{entry.notes.trim()}</p>
		{/if}

		{#if deletePromptVisible}
			<div class="mt-4 rounded-2xl border border-destructive/20 bg-destructive/10 p-3">
				<p class="text-sm font-semibold text-destructive">
					Delete this entry? This cannot be undone.
				</p>
				<div class="mt-3 flex justify-end gap-2">
					<button
						type="button"
						onclick={handleDeleteCancel}
						disabled={deleteState === 'loading'}
						aria-label={`Cancel deleting ${getEntryContextLabel()}`}
						class="rounded-xl border border-destructive/20 px-3 py-2 text-sm font-semibold text-destructive disabled:cursor-not-allowed disabled:opacity-70"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={handleDeleteConfirm}
						disabled={deleteState === 'loading'}
						aria-label={`Confirm delete ${getEntryContextLabel()}`}
						class="rounded-xl bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-70"
					>
						{deleteState === 'loading' ? 'Deleting...' : 'Confirm delete'}
					</button>
				</div>
			</div>
		{:else if actionPresentation === 'buttons'}
			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					onclick={handleEdit}
					disabled={editDisabled}
					aria-label={`Edit ${getEntryContextLabel()}`}
					class="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-70"
				>
					Edit
				</button>
				<button
					type="button"
					onclick={handleDeleteRequest}
					disabled={deleteDisabled}
					aria-label={`Delete ${getEntryContextLabel()}`}
					class="rounded-xl border border-destructive/20 px-3 py-2 text-sm font-semibold text-destructive disabled:cursor-not-allowed disabled:opacity-70"
				>
					Delete
				</button>
			</div>
		{:else}
			<button
				type="button"
				onclick={handleToggleActions}
				aria-expanded={actionsRevealed}
				aria-label={`${actionsRevealed ? 'Hide' : 'Show'} actions for ${getEntryContextLabel()}`}
				class="sr-only focus:not-sr-only focus:absolute focus:right-4 focus:top-4 focus:rounded-xl focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground"
			>
				{actionsRevealed ? 'Hide actions' : 'Show actions'}
			</button>
		{/if}
	</div>
</div>
