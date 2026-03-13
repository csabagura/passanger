import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type { Expense, FuelLog } from '$lib/db/schema';
import EntryCard from './EntryCard.svelte';

class MockPointerEvent extends MouseEvent {
	pointerId: number;

	constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
		super(type, init);
		this.pointerId = init.pointerId ?? 1;
	}
}

function createFuelEntry(overrides: Partial<FuelLog> = {}): FuelLog {
	return {
		id: overrides.id ?? 9,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date('2026-03-10T12:00:00Z'),
		odometer: overrides.odometer ?? 87400,
		quantity: overrides.quantity ?? 42,
		unit: overrides.unit ?? 'L',
		distanceUnit: overrides.distanceUnit ?? 'km',
		totalCost: overrides.totalCost ?? 78,
		calculatedConsumption: overrides.calculatedConsumption ?? 7.2,
		notes: overrides.notes ?? ''
	};
}

function createMaintenanceEntry(overrides: Partial<Expense> = {}): Expense {
	return {
		id: overrides.id ?? 12,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date('2026-03-10T12:00:00Z'),
		type: overrides.type ?? 'Oil Change',
		odometer: overrides.odometer ?? 87400,
		cost: overrides.cost ?? 78,
		notes: overrides.notes ?? 'Changed oil filter'
	};
}

describe('EntryCard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(globalThis, 'PointerEvent', {
			value: MockPointerEvent,
			configurable: true,
			writable: true
		});
		Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
			value: vi.fn(),
			configurable: true
		});
		Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
			value: vi.fn(),
			configurable: true
		});
	});

	afterEach(() => {
		cleanup();
	});

	it('renders a fuel summary with an accessible group label', () => {
		const fuelEntry = createFuelEntry();

		render(EntryCard, {
			kind: 'fuel',
			entry: fuelEntry,
			currency: 'EUR ',
			onEdit: vi.fn()
		});

		expect(screen.getByRole('group', { name: /fuel entry/i })).toBeTruthy();
		expect(screen.getByText(/42/i)).toBeTruthy();
		expect(screen.getByText(/7.2 L\/100km/i)).toBeTruthy();
		expect(screen.getByText('EUR 78.00')).toBeTruthy();
	});

	it('renders fuel efficiency using the preferred display unit instead of the stored unit', () => {
		const fuelEntry = createFuelEntry({
			calculatedConsumption: 7.2,
			unit: 'L'
		});

		render(EntryCard, {
			kind: 'fuel',
			entry: fuelEntry,
			currency: 'EUR ',
			preferredFuelUnit: 'MPG',
			onEdit: vi.fn()
		});

		expect(screen.getByText(/32.7 MPG/i)).toBeTruthy();
		expect(screen.queryByText(/7.2 L\/100km/i)).toBeNull();
	});

	it('renders a maintenance summary with notes and an accessible edit action', () => {
		const maintenanceEntry = createMaintenanceEntry();

		render(EntryCard, {
			kind: 'maintenance',
			entry: maintenanceEntry,
			currency: 'EUR ',
			onEdit: vi.fn()
		});

		expect(screen.getByRole('group', { name: /maintenance entry/i })).toBeTruthy();
		expect(screen.getByText('Oil Change')).toBeTruthy();
		expect(screen.getByText(/Changed oil filter/i)).toBeTruthy();
		expect(screen.getByRole('button', { name: /edit maintenance entry from/i })).toBeTruthy();
	});

	it('passes the full edit payload for fuel and maintenance entries', async () => {
		const onEdit = vi.fn();
		const fuelEntry = createFuelEntry({ id: 3 });

		const { unmount } = render(EntryCard, {
			kind: 'fuel',
			entry: fuelEntry,
			currency: 'EUR ',
			onEdit
		});

		await fireEvent.click(screen.getByRole('button', { name: /edit fuel entry from/i }));
		expect(onEdit).toHaveBeenCalledWith({ kind: 'fuel', entry: fuelEntry });

		unmount();

		const maintenanceEntry = createMaintenanceEntry({
			id: 4,
			date: new Date('2026-03-11T12:00:00Z'),
			type: 'Insurance',
			odometer: undefined,
			cost: 120,
			notes: undefined
		});

		render(EntryCard, {
			kind: 'maintenance',
			entry: maintenanceEntry,
			currency: 'EUR ',
			onEdit
		});

		await fireEvent.click(screen.getByRole('button', { name: /edit maintenance entry from/i }));
		expect(onEdit).toHaveBeenLastCalledWith({
			kind: 'maintenance',
			entry: maintenanceEntry
		});
	});

	it('does not render a maintenance distance unit when provenance is unavailable', () => {
		const maintenanceEntry = createMaintenanceEntry({
			id: 14,
			type: 'Tyres',
			cost: 400,
			notes: undefined
		});

		render(EntryCard, {
			kind: 'maintenance',
			entry: maintenanceEntry,
			currency: '$',
			onEdit: vi.fn()
		});

		const card = screen.getByRole('group', { name: /maintenance entry/i });
		expect(card.textContent).toContain('87,400');
		expect(screen.queryByText(/87,400 mi/i)).toBeNull();
		expect(screen.queryByText(/87,400 km/i)).toBeNull();
	});

	it('renders delete affordances with contextual labels for fuel and maintenance entries', () => {
		render(EntryCard, {
			kind: 'fuel',
			entry: createFuelEntry(),
			currency: 'EUR ',
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn(),
			onDeleteConfirm: vi.fn(),
			onDeleteCancel: vi.fn()
		});

		expect(
			screen.getByRole('button', { name: /delete fuel entry from Mar 10, 2026/i })
		).toBeTruthy();

		cleanup();

		render(EntryCard, {
			kind: 'maintenance',
			entry: createMaintenanceEntry(),
			currency: 'EUR ',
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn(),
			onDeleteConfirm: vi.fn(),
			onDeleteCancel: vi.fn()
		});

		expect(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		).toBeTruthy();
	});

	it('renders the inline delete confirmation state and triggers confirm/cancel callbacks', async () => {
		const onDeleteConfirm = vi.fn();
		const onDeleteCancel = vi.fn();
		const fuelEntry = createFuelEntry();

		render(EntryCard, {
			kind: 'fuel',
			entry: fuelEntry,
			currency: 'EUR ',
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn(),
			onDeleteConfirm,
			onDeleteCancel,
			deleteState: 'armed'
		});

		expect(screen.getByText('Delete this entry? This cannot be undone.')).toBeTruthy();

		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete fuel entry from Mar 10, 2026/i })
		);
		expect(onDeleteConfirm).toHaveBeenCalledWith({ kind: 'fuel', entry: fuelEntry });

		await fireEvent.click(
			screen.getByRole('button', { name: /cancel deleting fuel entry from Mar 10, 2026/i })
		);
		expect(onDeleteCancel).toHaveBeenCalledWith({ kind: 'fuel', entry: fuelEntry });
	});

	it('only shows the destructive prompt on cards whose delete state is armed', () => {
		render(EntryCard, {
			kind: 'fuel',
			entry: createFuelEntry({ id: 1 }),
			currency: 'EUR ',
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn(),
			onDeleteConfirm: vi.fn(),
			onDeleteCancel: vi.fn(),
			deleteState: 'armed'
		});

		render(EntryCard, {
			kind: 'maintenance',
			entry: createMaintenanceEntry({ id: 2, type: 'Tyres' }),
			currency: 'EUR ',
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn(),
			onDeleteConfirm: vi.fn(),
			onDeleteCancel: vi.fn(),
			deleteState: 'idle'
		});

		expect(screen.getAllByText('Delete this entry? This cannot be undone.')).toHaveLength(1);
		expect(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		).toBeTruthy();
	});

	it('renders the history presentation with date, icon surface, cost, and key detail', () => {
		render(EntryCard, {
			kind: 'fuel',
			entry: createFuelEntry({ calculatedConsumption: 0 }),
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			onEdit: vi.fn()
		});

		expect(screen.getByText('Mar 10, 2026')).toBeTruthy();
		expect(screen.getByText('Fuel')).toBeTruthy();
		expect(screen.getByText('42 L · Efficiency pending')).toBeTruthy();
		expect(screen.getByText('EUR 78.00')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /edit fuel entry from/i })).toBeNull();
	});

	it('opens detail from the history card body via click and keyboard activation', async () => {
		const onOpenDetail = vi.fn();
		const fuelEntry = createFuelEntry();

		render(EntryCard, {
			kind: 'fuel',
			entry: fuelEntry,
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			onOpenDetail,
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn()
		});

		const detailButton = screen.getByRole('button', {
			name: /view details for fuel entry from Mar 10, 2026/i
		});

		await fireEvent.click(detailButton);
		expect(onOpenDetail).toHaveBeenCalledTimes(1);
		expect(onOpenDetail).toHaveBeenLastCalledWith({ kind: 'fuel', entry: fuelEntry });

		await fireEvent.keyDown(detailButton, { key: 'Enter', code: 'Enter' });
		expect(onOpenDetail).toHaveBeenCalledTimes(2);
		expect(onOpenDetail).toHaveBeenLastCalledWith({ kind: 'fuel', entry: fuelEntry });
	});

	it('does not open detail when swipe actions or delete confirmation controls are used', async () => {
		const onOpenDetail = vi.fn();
		const onEdit = vi.fn();
		const onDeleteRequest = vi.fn();
		const maintenanceEntry = createMaintenanceEntry({ id: 44, type: 'Inspection' });

		const view = render(EntryCard, {
			kind: 'maintenance',
			entry: maintenanceEntry,
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			actionsRevealed: true,
			onOpenDetail,
			onEdit,
			onDeleteRequest,
			onDeleteConfirm: vi.fn(),
			onDeleteCancel: vi.fn()
		});

		await fireEvent.click(
			screen.getByRole('button', { name: /edit maintenance entry from Mar 10, 2026/i })
		);
		expect(onEdit).toHaveBeenCalledWith({ kind: 'maintenance', entry: maintenanceEntry });
		expect(onOpenDetail).not.toHaveBeenCalled();

		await view.rerender({
			kind: 'maintenance',
			entry: maintenanceEntry,
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			actionsRevealed: true,
			onOpenDetail,
			onEdit,
			onDeleteRequest,
			onDeleteConfirm: vi.fn(),
			onDeleteCancel: vi.fn()
		});

		await fireEvent.click(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		);
		expect(onDeleteRequest).toHaveBeenCalledWith({
			kind: 'maintenance',
			entry: maintenanceEntry
		});
		expect(onOpenDetail).not.toHaveBeenCalled();

		await view.rerender({
			kind: 'maintenance',
			entry: maintenanceEntry,
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			actionsRevealed: true,
			deleteState: 'armed',
			onOpenDetail,
			onEdit,
			onDeleteRequest,
			onDeleteConfirm: vi.fn(),
			onDeleteCancel: vi.fn()
		});

		expect(screen.getByText('Delete this entry? This cannot be undone.')).toBeTruthy();
		expect(onOpenDetail).not.toHaveBeenCalled();
	});

	it('reveals swipe actions only after the history threshold is crossed', async () => {
		const onActionRevealChange = vi.fn();
		const view = render(EntryCard, {
			kind: 'fuel',
			entry: createFuelEntry(),
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			actionsRevealed: false,
			onActionRevealChange,
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn()
		});

		const card = screen.getByRole('group', { name: /fuel entry/i });

		await fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(card, { pointerId: 1, clientX: 170, clientY: 18 });
		await fireEvent.pointerUp(card, { pointerId: 1, clientX: 170, clientY: 18 });
		expect(onActionRevealChange).not.toHaveBeenCalledWith(true);

		await fireEvent.pointerDown(card, { pointerId: 2, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(card, { pointerId: 2, clientX: 120, clientY: 18 });
		await fireEvent.pointerUp(card, { pointerId: 2, clientX: 120, clientY: 18 });
		expect(onActionRevealChange).toHaveBeenLastCalledWith(true);

		await view.rerender({
			kind: 'fuel',
			entry: createFuelEntry(),
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			actionsRevealed: true,
			onActionRevealChange,
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn()
		});

		expect(screen.getByRole('button', { name: /edit fuel entry from/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /delete fuel entry from/i })).toBeTruthy();
	});

	it('allows parent-controlled history cards to keep only one swipe surface open', async () => {
		const firstRevealSpy = vi.fn();
		const secondRevealSpy = vi.fn();

		const firstView = render(EntryCard, {
			kind: 'fuel',
			entry: createFuelEntry({ id: 1 }),
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			actionsRevealed: false,
			onActionRevealChange: firstRevealSpy,
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn()
		});

		const secondView = render(EntryCard, {
			kind: 'maintenance',
			entry: createMaintenanceEntry({ id: 2, type: 'Tyres' }),
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			actionsRevealed: false,
			onActionRevealChange: secondRevealSpy,
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn()
		});

		const firstCard = within(firstView.container).getByRole('group', { name: /fuel entry/i });
		const secondCard = within(secondView.container).getByRole('group', {
			name: /maintenance entry/i
		});

		await fireEvent.pointerDown(firstCard, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(firstCard, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(firstCard, { pointerId: 1, clientX: 120, clientY: 16 });
		expect(firstRevealSpy).toHaveBeenLastCalledWith(true);

		await firstView.rerender({
			kind: 'fuel',
			entry: createFuelEntry({ id: 1 }),
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			actionsRevealed: true,
			onActionRevealChange: firstRevealSpy,
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn()
		});

		await fireEvent.pointerDown(secondCard, { pointerId: 2, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(secondCard, { pointerId: 2, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(secondCard, { pointerId: 2, clientX: 120, clientY: 16 });
		expect(secondRevealSpy).toHaveBeenLastCalledWith(true);

		await firstView.rerender({
			kind: 'fuel',
			entry: createFuelEntry({ id: 1 }),
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			actionsRevealed: false,
			onActionRevealChange: firstRevealSpy,
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn()
		});
		await secondView.rerender({
			kind: 'maintenance',
			entry: createMaintenanceEntry({ id: 2, type: 'Tyres' }),
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			actionsRevealed: true,
			onActionRevealChange: secondRevealSpy,
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn()
		});

		expect(
			within(firstView.container).queryByRole('button', { name: /edit fuel entry from/i })
		).toBeNull();
		expect(
			within(secondView.container).getByRole('button', {
				name: /edit maintenance entry from/i
			})
		).toBeTruthy();
	});

	it('keeps delete confirmation reachable in history swipe mode', async () => {
		const onDeleteConfirm = vi.fn();
		const onDeleteCancel = vi.fn();
		const maintenanceEntry = createMaintenanceEntry({ id: 55, type: 'Inspection' });

		render(EntryCard, {
			kind: 'maintenance',
			entry: maintenanceEntry,
			currency: 'EUR ',
			presentation: 'history',
			actionPresentation: 'swipe',
			actionsRevealed: true,
			deleteState: 'armed',
			onEdit: vi.fn(),
			onDeleteRequest: vi.fn(),
			onDeleteConfirm,
			onDeleteCancel
		});

		expect(screen.getByText('Delete this entry? This cannot be undone.')).toBeTruthy();

		await fireEvent.click(
			screen.getByRole('button', {
				name: /confirm delete maintenance entry from Mar 10, 2026/i
			})
		);
		expect(onDeleteConfirm).toHaveBeenCalledWith({
			kind: 'maintenance',
			entry: maintenanceEntry
		});

		await fireEvent.click(
			screen.getByRole('button', {
				name: /cancel deleting maintenance entry from Mar 10, 2026/i
			})
		);
		expect(onDeleteCancel).toHaveBeenCalledWith({
			kind: 'maintenance',
			entry: maintenanceEntry
		});
	});
});
