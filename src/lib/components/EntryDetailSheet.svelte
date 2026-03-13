<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { FuelUnit } from '$lib/config';
	import type { HistoryEntry } from '$lib/utils/historyEntries';
	import { formatConsumptionForDisplay, formatCurrency } from '$lib/utils/calculations';
	import { formatLocalCalendarDate } from '$lib/utils/date';

	type DeleteState = 'idle' | 'armed' | 'loading';
	type PointerGestureLock = 'pending' | 'horizontal' | 'vertical';

	type DismissGestureState = {
		pointerId: number;
		startX: number;
		startY: number;
		lock: PointerGestureLock;
	};

	interface DetailRow {
		label: string;
		value: string;
	}

	interface Props {
		entry: HistoryEntry;
		currency: string;
		preferredFuelUnit?: FuelUnit;
		deleteState?: DeleteState;
		deleteDisabled?: boolean;
		deleteErrorText?: string;
		onClose: () => void;
		onEdit?: (request: HistoryEntry) => void;
		onDeleteRequest?: (request: HistoryEntry) => void;
		onDeleteConfirm?: (request: HistoryEntry) => void;
		onDeleteCancel?: (request: HistoryEntry) => void;
	}

	const DISMISS_GESTURE_SLOP = 12;
	const DISMISS_GESTURE_THRESHOLD = 72;

	let {
		entry,
		currency,
		preferredFuelUnit = 'L/100km',
		deleteState = 'idle',
		deleteDisabled = false,
		deleteErrorText = '',
		onClose,
		onEdit = () => {},
		onDeleteRequest = () => {},
		onDeleteConfirm = () => {},
		onDeleteCancel = () => {}
	}: Props = $props();

	const FOCUSABLE_SELECTOR =
		'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
	let titleElement = $state<HTMLHeadingElement | undefined>(undefined);
	let sheetElement = $state<HTMLDivElement | undefined>(undefined);
	let dismissGesture = $state<DismissGestureState | null>(null);
	let dragOffsetY = $state(0);

	const deletePromptVisible = $derived(deleteState === 'armed' || deleteState === 'loading');
	const closeDisabled = $derived(deleteState === 'loading');
	const sheetStyle = $derived(
		dragOffsetY > 0 ? `transform: translateY(${dragOffsetY}px);` : undefined
	);
	const detailRows = $derived<DetailRow[]>([
		{ label: 'Date', value: formatLocalCalendarDate(entry.entry.date) },
		{ label: 'Entry type', value: entry.kind === 'fuel' ? 'Fuel' : entry.entry.type },
		{ label: 'Odometer', value: getOdometerValue(entry) },
		{ label: 'Quantity', value: getQuantityValue(entry) },
		{ label: 'Unit', value: getUnitValue(entry) },
		{
			label: 'Cost',
			value: formatCurrency(
				entry.kind === 'fuel' ? entry.entry.totalCost : entry.entry.cost,
				currency
			)
		},
		{ label: 'Calculated consumption', value: getConsumptionValue(entry) },
		{ label: 'Notes', value: getNotesValue(entry) }
	]);

	function getOdometerValue(item: HistoryEntry): string {
		if (item.kind === 'fuel') {
			return `${item.entry.odometer.toLocaleString()} ${item.entry.distanceUnit}`;
		}

		if (item.entry.odometer === undefined) {
			return '-';
		}

		return item.entry.odometer.toLocaleString();
	}

	function getQuantityValue(item: HistoryEntry): string {
		return item.kind === 'fuel' ? item.entry.quantity.toLocaleString() : '-';
	}

	function getUnitValue(item: HistoryEntry): string {
		return item.kind === 'fuel' ? item.entry.unit : '-';
	}

	function getConsumptionValue(item: HistoryEntry): string {
		if (item.kind !== 'fuel') {
			return '-';
		}

		return item.entry.calculatedConsumption > 0
			? formatConsumptionForDisplay(
					item.entry.calculatedConsumption,
					item.entry.unit,
					preferredFuelUnit
				)
			: 'Efficiency pending';
	}

	function getNotesValue(item: HistoryEntry): string {
		const notes = item.entry.notes?.trim();
		return notes ? notes : '-';
	}

	function getEntryContextLabel(): string {
		return `${entry.kind} entry from ${formatLocalCalendarDate(entry.entry.date)}`;
	}

	async function focusTitle(): Promise<void> {
		await tick();
		titleElement?.focus();
	}

	function lockDocumentScroll(): () => void {
		const previousBodyOverflow = document.body.style.overflow;
		const previousHtmlOverflow = document.documentElement.style.overflow;

		document.body.style.overflow = 'hidden';
		document.documentElement.style.overflow = 'hidden';

		return () => {
			document.body.style.overflow = previousBodyOverflow;
			document.documentElement.style.overflow = previousHtmlOverflow;
		};
	}

	function resetDismissGesture(): void {
		dismissGesture = null;
		dragOffsetY = 0;
	}

	function handleClose(): void {
		if (closeDisabled) {
			return;
		}

		onClose();
	}

	function handleBackdropClick(): void {
		handleClose();
	}

	function handleEdit(): void {
		if (closeDisabled || deletePromptVisible) {
			return;
		}

		onEdit(entry);
	}

	function handleDeleteRequest(): void {
		if (closeDisabled || deletePromptVisible || deleteDisabled) {
			return;
		}

		onDeleteRequest(entry);
	}

	function handleDeleteConfirm(): void {
		if (deleteState === 'loading') {
			return;
		}

		onDeleteConfirm(entry);
	}

	function handleDeleteCancel(): void {
		if (deleteState === 'loading') {
			return;
		}

		onDeleteCancel(entry);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			handleClose();
			return;
		}

		if (event.key === 'Tab') {
			trapSheetFocus(event);
		}
	}

	function getFocusableElements(): HTMLElement[] {
		if (!sheetElement) {
			return [];
		}

		return Array.from(sheetElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
			(element) => element.getAttribute('tabindex') !== '-1'
		);
	}

	function trapSheetFocus(event: KeyboardEvent): void {
		const focusableElements = getFocusableElements();
		if (focusableElements.length === 0) {
			event.preventDefault();
			titleElement?.focus();
			return;
		}

		const firstFocusable = focusableElements[0];
		const lastFocusable = focusableElements[focusableElements.length - 1];
		const activeElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const activeInsideSheet = activeElement ? sheetElement?.contains(activeElement) : false;
		const activeIsFocusable = activeElement ? focusableElements.includes(activeElement) : false;

		if (!activeInsideSheet || !activeIsFocusable) {
			event.preventDefault();
			(event.shiftKey ? lastFocusable : firstFocusable).focus();
			return;
		}

		if (event.shiftKey && activeElement === firstFocusable) {
			event.preventDefault();
			lastFocusable.focus();
			return;
		}

		if (!event.shiftKey && activeElement === lastFocusable) {
			event.preventDefault();
			firstFocusable.focus();
		}
	}

	function handleDismissHandlePointerDown(
		event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		if (closeDisabled) {
			return;
		}

		dismissGesture = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			lock: 'pending'
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
	}

	function handleDismissHandlePointerMove(
		event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		if (!dismissGesture || dismissGesture.pointerId !== event.pointerId) {
			return;
		}

		const deltaX = event.clientX - dismissGesture.startX;
		const deltaY = event.clientY - dismissGesture.startY;

		if (dismissGesture.lock === 'pending') {
			if (Math.abs(deltaX) < DISMISS_GESTURE_SLOP && Math.abs(deltaY) < DISMISS_GESTURE_SLOP) {
				return;
			}

			dismissGesture = {
				...dismissGesture,
				lock: Math.abs(deltaY) >= Math.abs(deltaX) ? 'vertical' : 'horizontal'
			};
		}

		if (dismissGesture.lock !== 'vertical') {
			return;
		}

		event.preventDefault();
		dragOffsetY = Math.max(0, deltaY);
	}

	function commitDismissGesture(): void {
		if (dismissGesture?.lock === 'vertical' && dragOffsetY >= DISMISS_GESTURE_THRESHOLD) {
			dragOffsetY = 0;
			dismissGesture = null;
			handleClose();
			return;
		}

		resetDismissGesture();
	}

	function handleDismissHandlePointerUp(
		event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		if (!dismissGesture || dismissGesture.pointerId !== event.pointerId) {
			return;
		}

		event.currentTarget.releasePointerCapture?.(event.pointerId);
		commitDismissGesture();
	}

	function handleDismissHandlePointerCancel(
		event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	): void {
		if (!dismissGesture || dismissGesture.pointerId !== event.pointerId) {
			return;
		}

		event.currentTarget.releasePointerCapture?.(event.pointerId);
		resetDismissGesture();
	}

	onMount(() => {
		void focusTitle();
		return lockDocumentScroll();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fixed inset-0 z-50 flex items-end justify-center">
	<button
		type="button"
		aria-label="Close entry details"
		class="absolute inset-0 bg-black/45"
		disabled={closeDisabled}
		onclick={handleBackdropClick}
	></button>

	<div
		bind:this={sheetElement}
		role="dialog"
		aria-modal="true"
		aria-labelledby="entry-detail-title"
		data-entry-detail-sheet="true"
		style={sheetStyle}
		class="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[2rem] border border-border/80 bg-card shadow-2xl transition-transform duration-200 ease-out motion-reduce:transition-none"
	>
		<div
			data-entry-detail-handle="true"
			role="presentation"
			aria-hidden="true"
			class="px-4 pb-2 pt-3"
			style="touch-action: pan-x;"
			onpointerdown={handleDismissHandlePointerDown}
			onpointermove={handleDismissHandlePointerMove}
			onpointerup={handleDismissHandlePointerUp}
			onpointercancel={handleDismissHandlePointerCancel}
		>
			<div class="mx-auto h-1.5 w-12 rounded-full bg-border/80"></div>
		</div>

		<div class="overflow-y-auto px-4 pb-6 pt-2 sm:px-6">
			<div class="flex items-start justify-between gap-4">
				<div class="space-y-1">
					<h2
						id="entry-detail-title"
						bind:this={titleElement}
						tabindex="-1"
						class="text-lg font-semibold text-foreground outline-none"
					>
						Entry details
					</h2>
					<p class="text-sm text-muted-foreground">
						Review the full record, then edit or delete it without leaving History.
					</p>
				</div>

				<button
					type="button"
					disabled={closeDisabled}
					onclick={handleClose}
					class="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-70"
				>
					Close
				</button>
			</div>

			<dl class="mt-6 grid gap-3 sm:grid-cols-2">
				{#each detailRows as row (row.label)}
					<div class="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3">
						<dt class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
							{row.label}
						</dt>
						<dd class="mt-2 whitespace-pre-line text-sm font-medium text-foreground">
							{row.value}
						</dd>
					</div>
				{/each}
			</dl>

			<div class="mt-6 flex flex-wrap items-center gap-3">
				<button
					type="button"
					disabled={closeDisabled || deletePromptVisible}
					onclick={handleEdit}
					class="min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-70"
				>
					Edit
				</button>
				<button
					type="button"
					disabled={closeDisabled || deletePromptVisible || deleteDisabled}
					onclick={handleDeleteRequest}
					class="min-h-11 rounded-xl border border-destructive/20 px-4 py-2 text-sm font-semibold text-destructive disabled:cursor-not-allowed disabled:opacity-70"
				>
					Delete
				</button>
			</div>

			{#if deletePromptVisible}
				<div class="mt-4 rounded-2xl border border-destructive/20 bg-destructive/10 p-4">
					<p class="text-sm font-semibold text-destructive">
						Delete this entry? This cannot be undone.
					</p>
					{#if deleteErrorText}
						<div
							role="alert"
							class="mt-3 rounded-xl border border-destructive/20 bg-background/80 p-3"
						>
							<p class="text-sm text-destructive">{deleteErrorText}</p>
						</div>
					{/if}
					<div class="mt-3 flex flex-wrap justify-end gap-2">
						<button
							type="button"
							disabled={deleteState === 'loading'}
							aria-label={`Cancel deleting ${getEntryContextLabel()}`}
							onclick={handleDeleteCancel}
							class="rounded-xl border border-destructive/20 px-3 py-2 text-sm font-semibold text-destructive disabled:cursor-not-allowed disabled:opacity-70"
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={deleteState === 'loading'}
							aria-label={`Confirm delete ${getEntryContextLabel()}`}
							onclick={handleDeleteConfirm}
							class="rounded-xl bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-70"
						>
							{deleteState === 'loading' ? 'Deleting...' : 'Confirm delete'}
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
