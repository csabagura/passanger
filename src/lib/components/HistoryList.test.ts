import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import type { Expense, FuelLog } from '$lib/db/schema';
import {
	getHistoryEntryKey,
	groupHistoryEntriesByMonth,
	mergeHistoryEntries
} from '$lib/utils/historyEntries';
import HistoryList from './HistoryList.svelte';

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

describe('HistoryList', () => {
	beforeEach(() => {
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

	it('renders mixed fuel and maintenance entries in newest-first order', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({
					id: 3,
					date: new Date('2026-03-09T12:00:00Z'),
					quantity: 38,
					totalCost: 70
				}),
				createFuelEntry({ id: 8, date: new Date('2026-03-10T12:00:00Z') })
			],
			[
				createMaintenanceEntry({
					id: 6,
					date: new Date('2026-03-10T12:00:00Z'),
					type: 'Tyres'
				}),
				createMaintenanceEntry({
					id: 1,
					date: new Date('2026-03-08T12:00:00Z'),
					type: 'Insurance'
				})
			]
		);

		render(HistoryList, {
			monthGroups: groupHistoryEntriesByMonth(entries),
			currency: 'EUR '
		});

		expect(
			screen.getAllByRole('group').map((group) => group.getAttribute('data-entry-key'))
		).toEqual(['fuel-8', 'maintenance-6', 'fuel-3', 'maintenance-1']);
		expect(screen.getByText('Tyres')).toBeTruthy();
		expect(screen.getByText(/42 L · 7.2 L\/100km/i)).toBeTruthy();
		expect(screen.getByText(/38 L · 7.2 L\/100km/i)).toBeTruthy();
	});

	it('renders history fuel rows in the preferred display unit', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({
					id: 8,
					date: new Date('2026-03-10T12:00:00Z'),
					unit: 'L',
					calculatedConsumption: 7.2
				})
			],
			[]
		);

		render(HistoryList, {
			monthGroups: groupHistoryEntriesByMonth(entries),
			currency: 'EUR ',
			preferredFuelUnit: 'MPG'
		});

		expect(screen.getByText(/42 L · 32.7 MPG/i)).toBeTruthy();
		expect(screen.queryByText(/42 L · 7.2 L\/100km/i)).toBeNull();
	});

	it('renders the story empty state copy and Fuel shortcut when no entries exist', () => {
		render(HistoryList, {
			monthGroups: [],
			currency: 'EUR '
		});

		expect(screen.getByText('No entries yet - log your first fill-up!')).toBeTruthy();
		const cta = screen.getByRole('link', { name: /go to fuel/i });
		expect(cta.getAttribute('href')).toBe('/fuel-entry');
	});

	it('preserves keyed DOM identity when entries reorder around an existing card', async () => {
		const existingFuel = createFuelEntry({ id: 3, date: new Date('2026-03-09T12:00:00Z') });
		const initialEntries = mergeHistoryEntries(
			[existingFuel],
			[createMaintenanceEntry({ id: 2, date: new Date('2026-03-08T12:00:00Z') })]
		);

		const view = render(HistoryList, {
			monthGroups: groupHistoryEntriesByMonth(initialEntries),
			currency: 'EUR '
		});

		const originalFuelCard = screen.getByRole('group', {
			name: /fuel entry, Mar 9, 2026, EUR 78.00/i
		});

		const updatedEntries = mergeHistoryEntries(
			[existingFuel],
			[
				createMaintenanceEntry({ id: 11, date: new Date('2026-03-10T12:00:00Z') }),
				createMaintenanceEntry({ id: 2, date: new Date('2026-03-08T12:00:00Z') })
			]
		);

		await view.rerender({
			monthGroups: groupHistoryEntriesByMonth(updatedEntries),
			currency: 'EUR '
		});

		const movedFuelCard = screen.getByRole('group', {
			name: /fuel entry, Mar 9, 2026, EUR 78.00/i
		});

		expect(movedFuelCard).toBe(originalFuelCard);
	});

	it('keeps only one history card revealed at a time', async () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({ id: 9, date: new Date('2026-03-10T12:00:00Z') }),
				createFuelEntry({ id: 3, date: new Date('2026-03-09T12:00:00Z') })
			],
			[]
		);

		render(HistoryList, {
			monthGroups: groupHistoryEntriesByMonth(entries),
			currency: 'EUR '
		});

		const [firstCard, secondCard] = screen.getAllByRole('group', { name: /fuel entry/i });

		await fireEvent.pointerDown(firstCard, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(firstCard, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(firstCard, { pointerId: 1, clientX: 120, clientY: 16 });

		expect(screen.getByRole('button', { name: /edit fuel entry from Mar 10, 2026/i })).toBeTruthy();
		expect(
			within(secondCard.parentElement as HTMLElement).queryByRole('button', {
				name: /edit fuel entry from Mar 9, 2026/i
			})
		).toBeNull();

		await fireEvent.pointerDown(secondCard, { pointerId: 2, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(secondCard, { pointerId: 2, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(secondCard, { pointerId: 2, clientX: 120, clientY: 16 });

		expect(screen.queryByRole('button', { name: /edit fuel entry from Mar 10, 2026/i })).toBeNull();
		expect(screen.getByRole('button', { name: /edit fuel entry from Mar 9, 2026/i })).toBeTruthy();
	});

	it('calls onEdit with the correct HistoryEntry when Edit is clicked after swipe reveal', async () => {
		const fuel = createFuelEntry({ id: 9, date: new Date('2026-03-10T12:00:00Z') });
		const entries = mergeHistoryEntries([fuel], []);
		const onEdit = vi.fn();

		render(HistoryList, {
			monthGroups: groupHistoryEntriesByMonth(entries),
			currency: 'EUR ',
			onEdit
		});

		const card = screen.getByRole('group', { name: /fuel entry/i });
		await fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(card, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(card, { pointerId: 1, clientX: 120, clientY: 16 });

		await fireEvent.click(
			screen.getByRole('button', { name: /edit fuel entry from Mar 10, 2026/i })
		);

		expect(onEdit).toHaveBeenCalledTimes(1);
		expect(onEdit).toHaveBeenCalledWith({ kind: 'fuel', entry: fuel });
	});

	it('calls onDeleteRequest with the correct HistoryEntry when Delete is clicked after swipe reveal', async () => {
		const maintenance = createMaintenanceEntry({ id: 12, date: new Date('2026-03-10T12:00:00Z') });
		const entries = mergeHistoryEntries([], [maintenance]);
		const onDeleteRequest = vi.fn();

		render(HistoryList, {
			monthGroups: groupHistoryEntriesByMonth(entries),
			currency: 'EUR ',
			onDeleteRequest
		});

		const card = screen.getByRole('group', { name: /maintenance entry/i });
		await fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(card, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(card, { pointerId: 1, clientX: 120, clientY: 16 });

		await fireEvent.click(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		);

		expect(onDeleteRequest).toHaveBeenCalledTimes(1);
		expect(onDeleteRequest).toHaveBeenCalledWith({ kind: 'maintenance', entry: maintenance });
	});

	it('shows delete confirmation and calls onDeleteConfirm when entry is armed and confirmed', async () => {
		const fuel = createFuelEntry({ id: 9, date: new Date('2026-03-10T12:00:00Z') });
		const entries = mergeHistoryEntries([fuel], []);
		const onDeleteConfirm = vi.fn();
		const onDeleteCancel = vi.fn();

		render(HistoryList, {
			monthGroups: groupHistoryEntriesByMonth(entries),
			currency: 'EUR ',
			getDeleteState: (entry) => (getHistoryEntryKey(entry) === 'fuel-9' ? 'armed' : 'idle'),
			onDeleteConfirm,
			onDeleteCancel
		});

		expect(screen.getByText('Delete this entry? This cannot be undone.')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));

		expect(onDeleteConfirm).toHaveBeenCalledTimes(1);
		expect(onDeleteConfirm).toHaveBeenCalledWith({ kind: 'fuel', entry: fuel });
		expect(onDeleteCancel).not.toHaveBeenCalled();
	});

	it('suppresses the list-side delete prompt for the entry currently shown in detail', () => {
		const fuel = createFuelEntry({ id: 9, date: new Date('2026-03-10T12:00:00Z') });
		const entries = mergeHistoryEntries([fuel], []);

		render(HistoryList, {
			monthGroups: groupHistoryEntriesByMonth(entries),
			currency: 'EUR ',
			detailOpenEntryKey: 'fuel-9',
			getDeleteState: (entry) => (getHistoryEntryKey(entry) === 'fuel-9' ? 'armed' : 'idle')
		});

		expect(screen.queryByText('Delete this entry? This cannot be undone.')).toBeNull();
	});

	it('calls onDeleteCancel when the armed delete confirmation is cancelled', async () => {
		const fuel = createFuelEntry({ id: 9, date: new Date('2026-03-10T12:00:00Z') });
		const entries = mergeHistoryEntries([fuel], []);
		const onDeleteCancel = vi.fn();
		const onDeleteConfirm = vi.fn();

		render(HistoryList, {
			monthGroups: groupHistoryEntriesByMonth(entries),
			currency: 'EUR ',
			getDeleteState: (entry) => (getHistoryEntryKey(entry) === 'fuel-9' ? 'armed' : 'idle'),
			onDeleteCancel,
			onDeleteConfirm
		});

		await fireEvent.click(screen.getByRole('button', { name: /cancel deleting/i }));

		expect(onDeleteCancel).toHaveBeenCalledTimes(1);
		expect(onDeleteCancel).toHaveBeenCalledWith({ kind: 'fuel', entry: fuel });
		expect(onDeleteConfirm).not.toHaveBeenCalled();
	});

	it('focuses the empty-state CTA on initial mount when entries is empty', () => {
		render(HistoryList, {
			monthGroups: [],
			currency: 'EUR '
		});

		flushSync();

		const cta = screen.getByRole('link', { name: /go to fuel/i });
		expect(document.activeElement).toBe(cta);
	});

	it('does NOT focus the empty-state CTA when transitioning to empty after initial mount', async () => {
		const fuel = createFuelEntry({ id: 9, date: new Date('2026-03-10T12:00:00Z') });
		const initialEntries = mergeHistoryEntries([fuel], []);

		const view = render(HistoryList, {
			monthGroups: groupHistoryEntriesByMonth(initialEntries),
			currency: 'EUR '
		});

		// Put focus elsewhere to track it
		const sentinel = document.createElement('button');
		document.body.appendChild(sentinel);
		sentinel.focus();
		expect(document.activeElement).toBe(sentinel);

		// Transition to empty (simulates last-entry delete)
		await view.rerender({ monthGroups: [], currency: 'EUR ' });
		flushSync();

		const cta = screen.getByRole('link', { name: /go to fuel/i });
		expect(document.activeElement).not.toBe(cta);

		document.body.removeChild(sentinel);
	});

	it('renders month headers with per-month subtotals above grouped entries', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({
					id: 9,
					date: new Date('2026-03-10T12:00:00Z'),
					totalCost: 78
				}),
				createFuelEntry({
					id: 3,
					date: new Date('2026-02-09T12:00:00Z'),
					totalCost: 44
				})
			],
			[
				createMaintenanceEntry({
					id: 12,
					date: new Date('2026-03-08T12:00:00Z'),
					cost: 120
				})
			]
		);

		render(HistoryList, {
			monthGroups: groupHistoryEntriesByMonth(entries),
			currency: 'EUR '
		});

		expect(screen.getByRole('heading', { name: 'March 2026' })).toBeTruthy();
		expect(
			screen.getByRole('heading', { name: 'March 2026' }).parentElement?.textContent
		).toContain('EUR 198.00');
		expect(screen.getByRole('heading', { name: 'February 2026' })).toBeTruthy();
		expect(
			screen.getByRole('heading', { name: 'February 2026' }).parentElement?.textContent
		).toContain('EUR 44.00');
	});
});
