<script lang="ts">
	import { getContext, onDestroy, onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';
	import { MAX_VEHICLES } from '$lib/config';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';

	type PointerGestureLock = 'pending' | 'horizontal' | 'vertical';

	type DismissGestureState = {
		pointerId: number;
		startX: number;
		startY: number;
		lock: PointerGestureLock;
	};

	const DISMISS_GESTURE_SLOP = 12;
	const DISMISS_GESTURE_THRESHOLD = 72;
	const DESKTOP_BREAKPOINT = 768;
	const FOCUSABLE_SELECTOR =
		'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	const vehiclesCtx = getContext<VehiclesContext>('vehicles');

	let open = $state(false);
	let isDesktop = $state(false);
	let pillButton = $state<HTMLButtonElement | undefined>(undefined);
	let sheetElement = $state<HTMLDivElement | undefined>(undefined);
	let titleElement = $state<HTMLHeadingElement | undefined>(undefined);
	let dismissGesture = $state<DismissGestureState | null>(null);
	let dragOffsetY = $state(0);

	const pillLabel = $derived(vehiclesCtx.activeVehicle?.name ?? 'No vehicle');
	const pillAriaLabel = $derived(
		vehiclesCtx.activeVehicle
			? `Switch vehicle: ${vehiclesCtx.activeVehicle.name}`
			: 'Switch vehicle: No vehicle'
	);
	const atLimit = $derived(vehiclesCtx.vehicles.length >= MAX_VEHICLES);
	const sheetStyle = $derived(
		dragOffsetY > 0 ? `transform: translateY(${dragOffsetY}px);` : undefined
	);

	function updateDesktopState() {
		isDesktop =
			typeof window !== 'undefined' &&
			typeof window.matchMedia === 'function' &&
			window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`).matches;
	}

	onMount(() => {
		updateDesktopState();
		if (typeof window.matchMedia !== 'function') return;
		const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
		const handler = (e: MediaQueryListEvent) => {
			isDesktop = e.matches;
		};
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});

	onDestroy(() => {
		if (open && !isDesktop) {
			unlockDocumentScroll();
		}
	});

	function toggle() {
		if (open) {
			closeSheet();
		} else {
			openSheet();
		}
	}

	async function openSheet() {
		open = true;
		if (!isDesktop) {
			lockDocumentScroll();
		}
		await tick();
		titleElement?.focus();
	}

	function closeSheet() {
		open = false;
		resetDismissGesture();
		unlockDocumentScroll();
		pillButton?.focus();
	}

	function selectVehicle(id: number) {
		vehiclesCtx.switchVehicle(id);
		closeSheet();
	}

	function handleAddVehicle() {
		closeSheet();
		goto(resolve('/settings'));
	}

	// Scroll lock
	let savedBodyOverflow = '';
	let savedHtmlOverflow = '';

	function lockDocumentScroll() {
		savedBodyOverflow = document.body.style.overflow;
		savedHtmlOverflow = document.documentElement.style.overflow;
		document.body.style.overflow = 'hidden';
		document.documentElement.style.overflow = 'hidden';
	}

	function unlockDocumentScroll() {
		document.body.style.overflow = savedBodyOverflow;
		document.documentElement.style.overflow = savedHtmlOverflow;
	}

	// Keyboard handling
	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;

		if (event.key === 'Escape') {
			event.preventDefault();
			closeSheet();
			return;
		}

		if (event.key === 'Tab' && !isDesktop) {
			trapSheetFocus(event);
		}
	}

	function getFocusableElements(): HTMLElement[] {
		if (!sheetElement) return [];
		return Array.from(sheetElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
			(el) => el.getAttribute('tabindex') !== '-1'
		);
	}

	function trapSheetFocus(event: KeyboardEvent) {
		const focusable = getFocusableElements();
		if (focusable.length === 0) {
			event.preventDefault();
			titleElement?.focus();
			return;
		}

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const insideSheet = active ? sheetElement?.contains(active) : false;
		const isFocusable = active ? focusable.includes(active) : false;

		if (!insideSheet || !isFocusable) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus();
			return;
		}

		if (event.shiftKey && active === first) {
			event.preventDefault();
			last.focus();
			return;
		}

		if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	}

	// Desktop: click outside to close
	function handleClickOutside(event: MouseEvent) {
		if (!open || !isDesktop) return;
		const target = event.target as Node;
		if (pillButton?.contains(target)) return;
		if (sheetElement?.contains(target)) return;
		closeSheet();
	}

	// Swipe-to-dismiss (mobile only)
	function resetDismissGesture() {
		dismissGesture = null;
		dragOffsetY = 0;
	}

	function handlePointerDown(
		event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	) {
		if (isDesktop) return;
		dismissGesture = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			lock: 'pending'
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
	}

	function handlePointerMove(
		event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	) {
		if (!dismissGesture || dismissGesture.pointerId !== event.pointerId) return;

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

		if (dismissGesture.lock !== 'vertical') return;
		event.preventDefault();
		dragOffsetY = Math.max(0, deltaY);
	}

	function handlePointerUp(
		event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	) {
		if (!dismissGesture || dismissGesture.pointerId !== event.pointerId) return;
		event.currentTarget.releasePointerCapture?.(event.pointerId);

		if (dismissGesture.lock === 'vertical' && dragOffsetY >= DISMISS_GESTURE_THRESHOLD) {
			dragOffsetY = 0;
			dismissGesture = null;
			closeSheet();
			return;
		}
		resetDismissGesture();
	}

	function handlePointerCancel(
		event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }
	) {
		if (!dismissGesture || dismissGesture.pointerId !== event.pointerId) return;
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		resetDismissGesture();
	}
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleClickOutside} />

<div class="relative">
	<!-- Pill button -->
	<button
		bind:this={pillButton}
		type="button"
		onclick={toggle}
		aria-label={pillAriaLabel}
		aria-expanded={open}
		aria-haspopup={isDesktop ? 'listbox' : 'dialog'}
		class="inline-flex h-11 min-w-[44px] items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
	>
		<span class="max-w-[120px] truncate">{pillLabel}</span>
		<ChevronDown
			size={14}
			class="shrink-0 text-muted-foreground transition-transform {open ? 'rotate-180' : ''}"
			aria-hidden="true"
		/>
	</button>

	<!-- Desktop dropdown -->
	{#if open && isDesktop}
		<div
			bind:this={sheetElement}
			class="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-border bg-card shadow-lg"
		>
			<h3
				bind:this={titleElement}
				id="desktop-vehicle-switcher-title"
				tabindex="-1"
				class="px-4 pb-2 pt-3 text-sm font-semibold text-foreground outline-none"
			>
				Choose vehicle
			</h3>

			<ul role="listbox" aria-labelledby="desktop-vehicle-switcher-title" class="px-2 pb-2">
				{#each vehiclesCtx.vehicles as vehicle (vehicle.id)}
					<li>
						<button
							type="button"
							role="option"
							aria-selected={vehicle.id === vehiclesCtx.activeVehicleId}
							onclick={() => selectVehicle(vehicle.id)}
							class="flex w-full min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50 {vehicle.id === vehiclesCtx.activeVehicleId ? 'border border-accent bg-accent/5' : ''}"
						>
							<div class="flex-1 min-w-0">
								<p class="font-semibold text-foreground truncate">{vehicle.name}</p>
								<p class="text-sm text-muted-foreground truncate">
									{vehicle.make} {vehicle.model}{#if vehicle.year} · {vehicle.year}{/if}
								</p>
							</div>
							{#if vehicle.id === vehiclesCtx.activeVehicleId}
								<Check size={16} class="shrink-0 text-accent" aria-hidden="true" />
							{/if}
						</button>
					</li>
				{/each}

				<li class="mt-1 border-t border-border pt-1">
					{#if atLimit}
						<div class="flex min-h-[44px] items-center gap-3 px-3 py-2.5 opacity-50">
							<Plus size={16} class="shrink-0 text-muted-foreground" aria-hidden="true" />
							<span class="text-sm text-muted-foreground">Maximum {MAX_VEHICLES} vehicles</span>
						</div>
					{:else}
						<button
							type="button"
							onclick={handleAddVehicle}
							class="flex w-full min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
						>
							<Plus size={16} class="shrink-0 text-accent" aria-hidden="true" />
							<span class="text-sm font-medium text-accent">Add vehicle</span>
						</button>
					{/if}
				</li>
			</ul>
		</div>
	{/if}
</div>

<!-- Mobile bottom sheet -->
{#if open && !isDesktop}
	<div class="fixed inset-0 z-50 flex items-end justify-center">
		<button
			type="button"
			aria-label="Close vehicle switcher"
			class="absolute inset-0 bg-black/45"
			onclick={closeSheet}
		></button>

		<div
			bind:this={sheetElement}
			role="dialog"
			aria-modal="true"
			aria-labelledby="vehicle-switcher-title"
			style={sheetStyle}
			class="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[2rem] border border-border/80 bg-card shadow-2xl transition-transform duration-200 ease-out motion-reduce:transition-none"
		>
			<!-- Drag handle -->
			<div
				role="presentation"
				aria-hidden="true"
				class="px-4 pb-2 pt-3"
				style="touch-action: pan-x;"
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerup={handlePointerUp}
				onpointercancel={handlePointerCancel}
			>
				<div class="mx-auto h-1.5 w-12 rounded-full bg-border/80"></div>
			</div>

			<div class="overflow-y-auto px-4 pb-6 pt-2 sm:px-6">
				<h2
					id="vehicle-switcher-title"
					bind:this={titleElement}
					tabindex="-1"
					class="text-lg font-semibold text-foreground outline-none"
				>
					Choose vehicle
				</h2>

				<ul class="mt-4 space-y-2" role="listbox" aria-label="Vehicle list">
					{#each vehiclesCtx.vehicles as vehicle (vehicle.id)}
						<li>
							<button
								type="button"
								role="option"
								aria-selected={vehicle.id === vehiclesCtx.activeVehicleId}
								aria-current={vehicle.id === vehiclesCtx.activeVehicleId ? 'true' : undefined}
								onclick={() => selectVehicle(vehicle.id)}
								class="flex w-full min-h-[44px] items-center gap-3 rounded-xl border p-4 text-left transition-colors {vehicle.id === vehiclesCtx.activeVehicleId ? 'border-accent bg-accent/5' : 'border-border'}"
							>
								<div class="flex-1 min-w-0">
									<p class="font-semibold text-foreground">{vehicle.name}</p>
									<p class="text-sm text-muted-foreground">
										{vehicle.make} {vehicle.model}{#if vehicle.year} · {vehicle.year}{/if}
									</p>
								</div>
								{#if vehicle.id === vehiclesCtx.activeVehicleId}
									<Check size={16} class="shrink-0 text-accent" aria-hidden="true" />
								{/if}
							</button>
						</li>
					{/each}
				</ul>

				<div class="mt-4 border-t border-border pt-4">
					{#if atLimit}
						<div class="flex min-h-[44px] items-center gap-3 px-1 opacity-50">
							<Plus size={16} class="shrink-0 text-muted-foreground" aria-hidden="true" />
							<span class="text-sm text-muted-foreground">Maximum {MAX_VEHICLES} vehicles</span>
						</div>
					{:else}
						<button
							type="button"
							onclick={handleAddVehicle}
							class="flex w-full min-h-[44px] items-center gap-3 rounded-xl px-1 py-2 text-left transition-colors hover:bg-muted/50"
						>
							<Plus size={16} class="shrink-0 text-accent" aria-hidden="true" />
							<span class="text-sm font-medium text-accent">Add vehicle</span>
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
