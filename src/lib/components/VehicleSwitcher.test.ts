import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import VehicleSwitcher from './VehicleSwitcher.svelte';
import type { VehiclesContext } from '$lib/utils/vehicleContext';

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

const testVehicle1 = { id: 1, name: 'My Car', make: 'Honda', model: 'Civic', year: 2020 };
const testVehicle2 = { id: 2, name: 'Work Truck', make: 'Ford', model: 'F-150', year: 2022 };

function makeContext(
	vehicles = [testVehicle1],
	activeId: number | null = 1
): VehiclesContext {
	return {
		get vehicles() {
			return vehicles;
		},
		get activeVehicle() {
			return activeId !== null ? (vehicles.find((v) => v.id === activeId) ?? null) : null;
		},
		get activeVehicleId() {
			return activeId;
		},
		get loaded() {
			return true;
		},
		switchVehicle: vi.fn(),
		refreshVehicles: vi.fn().mockResolvedValue(undefined)
	};
}

function renderSwitcher(ctx = makeContext()) {
	const contextMap = new Map<string, unknown>();
	contextMap.set('vehicles', ctx);
	return { ctx, ...render(VehicleSwitcher, { context: contextMap }) };
}

describe('VehicleSwitcher', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it('renders pill with active vehicle name', () => {
		renderSwitcher();
		expect(screen.getByText('My Car')).toBeTruthy();
	});

	it('renders pill with "No vehicle" fallback when no vehicles', () => {
		renderSwitcher(makeContext([], null));
		expect(screen.getByText('No vehicle')).toBeTruthy();
	});

	it('pill has correct aria attributes', () => {
		renderSwitcher();
		const pill = screen.getByRole('button', { name: /switch vehicle/i });
		expect(pill.getAttribute('aria-expanded')).toBe('false');
	});

	it('opens sheet on pill click', async () => {
		renderSwitcher();
		const pill = screen.getByRole('button', { name: /switch vehicle/i });
		await fireEvent.click(pill);
		expect(pill.getAttribute('aria-expanded')).toBe('true');
		expect(screen.getByText('Choose vehicle')).toBeTruthy();
	});

	it('lists all vehicles with active highlighted', async () => {
		const ctx = makeContext([testVehicle1, testVehicle2], 1);
		renderSwitcher(ctx);

		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));

		const options = screen.getAllByRole('option');
		expect(options).toHaveLength(2);
		expect(options[0].getAttribute('aria-selected')).toBe('true');
		expect(options[1].getAttribute('aria-selected')).toBe('false');
	});

	it('vehicle selection calls switchVehicle and closes sheet', async () => {
		const ctx = makeContext([testVehicle1, testVehicle2], 1);
		renderSwitcher(ctx);

		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		await fireEvent.click(screen.getByRole('option', { name: /Work Truck/i }));

		expect(ctx.switchVehicle).toHaveBeenCalledWith(2);
		expect(screen.queryByText('Choose vehicle')).toBeNull();
	});

	it('closes sheet on Escape key', async () => {
		renderSwitcher();
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		expect(screen.getByText('Choose vehicle')).toBeTruthy();

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByText('Choose vehicle')).toBeNull();
	});

	it('closes sheet on backdrop click', async () => {
		renderSwitcher();
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		expect(screen.getByText('Choose vehicle')).toBeTruthy();

		const backdrop = screen.getByRole('button', { name: /close vehicle switcher/i });
		await fireEvent.click(backdrop);
		expect(screen.queryByText('Choose vehicle')).toBeNull();
	});

	it('shows Add vehicle action', async () => {
		renderSwitcher();
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		expect(screen.getByText('Add vehicle')).toBeTruthy();
	});

	it('Add vehicle navigates to settings', async () => {
		const { goto } = await import('$app/navigation');
		renderSwitcher();
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		await fireEvent.click(screen.getByText('Add vehicle'));
		expect(goto).toHaveBeenCalledWith('/settings');
	});

	it('shows MAX_VEHICLES limit message when at limit', async () => {
		const fiveVehicles = Array.from({ length: 5 }, (_, i) => ({
			id: i + 1,
			name: `Car ${i + 1}`,
			make: 'Honda',
			model: 'Civic',
			year: 2020 + i
		}));
		renderSwitcher(makeContext(fiveVehicles, 1));
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		expect(screen.getByText('Maximum 5 vehicles')).toBeTruthy();
	});

	it('single-vehicle behavior: shows vehicle and add action', async () => {
		renderSwitcher(makeContext([testVehicle1], 1));
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		expect(screen.getAllByText('My Car').length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText('Add vehicle')).toBeTruthy();
	});

	it('no-vehicle fallback: shows only add action', async () => {
		renderSwitcher(makeContext([], null));
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		expect(screen.getByText('Add vehicle')).toBeTruthy();
		expect(screen.queryAllByRole('option')).toHaveLength(0);
	});
});

describe('VehicleSwitcher (focus management)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it('auto-focuses title element when sheet opens', async () => {
		renderSwitcher();
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));

		const title = screen.getByText('Choose vehicle');
		expect(document.activeElement).toBe(title);
	});

	it('returns focus to pill button when sheet closes via Escape', async () => {
		renderSwitcher();
		const pill = screen.getByRole('button', { name: /switch vehicle/i });
		await fireEvent.click(pill);
		expect(screen.getByText('Choose vehicle')).toBeTruthy();

		await fireEvent.keyDown(window, { key: 'Escape' });

		expect(document.activeElement).toBe(pill);
	});

	it('returns focus to pill button when sheet closes via backdrop click', async () => {
		renderSwitcher();
		const pill = screen.getByRole('button', { name: /switch vehicle/i });
		await fireEvent.click(pill);

		const backdrop = screen.getByRole('button', { name: /close vehicle switcher/i });
		await fireEvent.click(backdrop);

		expect(document.activeElement).toBe(pill);
	});

	it('traps Tab focus within mobile sheet', async () => {
		const ctx = makeContext([testVehicle1, testVehicle2], 1);
		renderSwitcher(ctx);
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));

		// Get all focusable elements within the sheet
		const dialog = screen.getByRole('dialog');
		const focusableElements = Array.from(
			dialog.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
			)
		);

		expect(focusableElements.length).toBeGreaterThan(0);

		// Focus the last focusable element
		const lastFocusable = focusableElements[focusableElements.length - 1];
		lastFocusable.focus();
		expect(document.activeElement).toBe(lastFocusable);

		// Tab from last should cycle to first
		await fireEvent.keyDown(window, { key: 'Tab' });
		expect(document.activeElement).toBe(focusableElements[0]);
	});

	it('traps Shift+Tab focus within mobile sheet', async () => {
		const ctx = makeContext([testVehicle1, testVehicle2], 1);
		renderSwitcher(ctx);
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));

		const dialog = screen.getByRole('dialog');
		const focusableElements = Array.from(
			dialog.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
			)
		);

		// Focus the first focusable element
		const firstFocusable = focusableElements[0];
		firstFocusable.focus();
		expect(document.activeElement).toBe(firstFocusable);

		// Shift+Tab from first should cycle to last
		await fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(focusableElements[focusableElements.length - 1]);
	});
});

describe('VehicleSwitcher (swipe-to-dismiss)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	function getDragHandle(): HTMLElement {
		// The drag handle area has role="presentation"
		return screen.getByRole('presentation', { hidden: true });
	}

	it('dismisses sheet when swiped down past threshold', async () => {
		renderSwitcher();
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		expect(screen.getByText('Choose vehicle')).toBeTruthy();

		const handle = getDragHandle();

		await fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
		// Move past slop (12px) to lock vertical
		await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 115 });
		// Move past threshold (72px)
		await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 180 });
		await fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100, clientY: 180 });

		expect(screen.queryByText('Choose vehicle')).toBeNull();
	});

	it('does not dismiss sheet when swipe does not reach threshold', async () => {
		renderSwitcher();
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		expect(screen.getByText('Choose vehicle')).toBeTruthy();

		const handle = getDragHandle();

		await fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
		await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 115 });
		// Only move 50px — under 72px threshold
		await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 150 });
		await fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100, clientY: 150 });

		expect(screen.getByText('Choose vehicle')).toBeTruthy();
	});

	it('ignores horizontal swipe gesture', async () => {
		renderSwitcher();
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		expect(screen.getByText('Choose vehicle')).toBeTruthy();

		const handle = getDragHandle();

		await fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
		// Horizontal movement past slop locks to horizontal
		await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 115, clientY: 100 });
		await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200, clientY: 100 });
		await fireEvent.pointerUp(handle, { pointerId: 1, clientX: 200, clientY: 100 });

		expect(screen.getByText('Choose vehicle')).toBeTruthy();
	});

	it('resets gesture on pointer cancel', async () => {
		renderSwitcher();
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		expect(screen.getByText('Choose vehicle')).toBeTruthy();

		const handle = getDragHandle();

		await fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
		await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 115 });
		await fireEvent.pointerCancel(handle, { pointerId: 1 });

		// Sheet should still be open after cancel
		expect(screen.getByText('Choose vehicle')).toBeTruthy();
	});
});

describe('VehicleSwitcher (desktop dropdown)', () => {
	let originalMatchMedia: typeof window.matchMedia;
	let changeHandler: ((e: MediaQueryListEvent) => void) | null = null;

	beforeEach(() => {
		vi.clearAllMocks();
		originalMatchMedia = window.matchMedia;
		window.matchMedia = vi.fn().mockImplementation((query: string) => ({
			matches: query.includes('min-width: 768px'),
			media: query,
			addEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
				changeHandler = handler;
			},
			removeEventListener: () => {
				changeHandler = null;
			},
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn()
		}));
	});

	afterEach(() => {
		cleanup();
		window.matchMedia = originalMatchMedia;
		changeHandler = null;
	});

	it('renders dropdown instead of bottom sheet on desktop', async () => {
		const ctx = makeContext([testVehicle1, testVehicle2], 1);
		renderSwitcher(ctx);

		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));

		// Desktop dropdown has listbox on the ul, not a dialog
		expect(screen.getByRole('listbox')).toBeTruthy();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('pill has aria-haspopup="listbox" on desktop', () => {
		renderSwitcher();
		const pill = screen.getByRole('button', { name: /switch vehicle/i });
		expect(pill.getAttribute('aria-haspopup')).toBe('listbox');
	});

	it('closes dropdown on Escape key', async () => {
		renderSwitcher();
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		expect(screen.getByText('Choose vehicle')).toBeTruthy();

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByText('Choose vehicle')).toBeNull();
	});

	it('closes dropdown on click outside', async () => {
		renderSwitcher();
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		expect(screen.getByText('Choose vehicle')).toBeTruthy();

		// Click on the document body (outside the dropdown and pill)
		await fireEvent.click(document.body);
		expect(screen.queryByText('Choose vehicle')).toBeNull();
	});

	it('does not apply focus trap on desktop', async () => {
		renderSwitcher(makeContext([testVehicle1, testVehicle2], 1));
		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));

		// Tab key should not be trapped (no focus cycling behavior on desktop)
		// The keydown handler only traps Tab when !isDesktop
		const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
		const preventDefaultSpy = vi.spyOn(tabEvent, 'preventDefault');
		window.dispatchEvent(tabEvent);

		expect(preventDefaultSpy).not.toHaveBeenCalled();
	});

	it('vehicle selection works on desktop dropdown', async () => {
		const ctx = makeContext([testVehicle1, testVehicle2], 1);
		renderSwitcher(ctx);

		await fireEvent.click(screen.getByRole('button', { name: /switch vehicle/i }));
		await fireEvent.click(screen.getByRole('option', { name: /Work Truck/i }));

		expect(ctx.switchVehicle).toHaveBeenCalledWith(2);
		expect(screen.queryByText('Choose vehicle')).toBeNull();
	});
});
