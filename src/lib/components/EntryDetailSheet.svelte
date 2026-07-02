<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { FuelUnit } from '$lib/config';
	import type { HistoryEntry } from '$lib/utils/historyEntries';
	import { formatConsumptionForDisplay, formatCurrency } from '$lib/utils/calculations';
	import { formatLocalCalendarDate } from '$lib/utils/date';
	import { m } from '$lib/paraglide/messages';

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
		vehicleName?: string;
		/**
		 * True while an optimistic delete of THIS entry is in flight (Story 6.3 / A11Y-4). History
		 * owns the delete + post-delete focus (`focusPostDeleteTarget`) and closes the sheet itself
		 * via `closeDetailSheetWithoutFocus`; if the user also closes here mid-delete, the two close
		 * paths race and focus can land on `<body>`. While `deleting`, all user close paths are no-ops.
		 */
		deleting?: boolean;
		onClose: () => void;
		onEdit?: (request: HistoryEntry) => void;
		onDelete?: (request: HistoryEntry) => void;
	}

	const DISMISS_GESTURE_SLOP = 12;
	const DISMISS_GESTURE_THRESHOLD = 72;

	let {
		entry,
		currency,
		preferredFuelUnit = 'L/100km',
		vehicleName,
		deleting = false,
		onClose,
		onEdit = () => {},
		onDelete = () => {}
	}: Props = $props();

	const FOCUSABLE_SELECTOR =
		'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
	let titleElement = $state<HTMLHeadingElement | undefined>(undefined);
	let sheetElement = $state<HTMLDivElement | undefined>(undefined);
	let dismissGesture = $state<DismissGestureState | null>(null);
	let dragOffsetY = $state(0);

	const sheetStyle = $derived(
		dragOffsetY > 0 ? `transform: translateY(${dragOffsetY}px);` : undefined
	);
	const detailRows = $derived<DetailRow[]>([
		{ label: m.entry_detail_date_label(), value: formatLocalCalendarDate(entry.entry.date) },
		{
			label: m.entry_detail_type_label(),
			value: entry.kind === 'fuel' ? m.common_fuel() : entry.entry.type
		},
		...(vehicleName ? [{ label: m.entry_detail_vehicle_label(), value: vehicleName }] : []),
		{ label: m.entry_detail_odometer_label(), value: getOdometerValue(entry) },
		{ label: m.entry_detail_quantity_label(), value: getQuantityValue(entry) },
		{ label: m.entry_detail_unit_label(), value: getUnitValue(entry) },
		{
			label: m.entry_detail_cost_label(),
			value: formatCurrency(
				entry.kind === 'fuel' ? entry.entry.totalCost : entry.entry.cost,
				entry.entry.currency ?? currency
			)
		},
		{ label: m.entry_detail_consumption_label(), value: getConsumptionValue(entry) },
		{ label: m.entry_detail_notes_label(), value: getNotesValue(entry) }
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
			: m.entry_efficiency_pending();
	}

	function getNotesValue(item: HistoryEntry): string {
		const notes = item.entry.notes?.trim();
		return notes ? notes : '-';
	}

	function getEntryContextLabel(): string {
		const type = entry.kind === 'fuel' ? m.entry_type_fuel_lc() : m.entry_type_maintenance_lc();
		return m.entry_context_label({ type, date: formatLocalCalendarDate(entry.entry.date) });
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
		// A11Y-4: single chokepoint for every user close path (Close button, backdrop, Escape,
		// swipe-dismiss). While an optimistic delete of this entry is in flight, History is already
		// tearing the sheet down and moving focus — a concurrent user close would race that and strand
		// focus on <body>, so we no-op until History finishes and unmounts us.
		if (deleting) {
			return;
		}
		onClose();
	}

	function handleBackdropClick(): void {
		handleClose();
	}

	function handleEdit(): void {
		onEdit(entry);
	}

	// Single-action delete. The sheet is closed by History on delete; the global Undo toast remains
	// visible after close (it renders from the layout Toaster, not this sheet).
	function handleDelete(): void {
		onDelete(entry);
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
		aria-label={m.entry_detail_close_backdrop_aria()}
		class="absolute inset-0 bg-black/45"
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
						{m.entry_detail_title()}
					</h2>
					<p class="text-sm text-muted-foreground">
						{m.entry_detail_subtitle()}
					</p>
				</div>

				<button
					type="button"
					onclick={handleClose}
					class="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground"
				>
					{m.common_close()}
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
					onclick={handleEdit}
					class="min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground"
				>
					{m.common_edit()}
				</button>
				<button
					type="button"
					aria-label={m.entry_delete_aria({ context: getEntryContextLabel() })}
					onclick={handleDelete}
					class="min-h-11 rounded-xl border border-destructive/20 px-4 py-2 text-sm font-semibold text-destructive"
				>
					{m.common_delete()}
				</button>
			</div>
		</div>
	</div>
</div>
