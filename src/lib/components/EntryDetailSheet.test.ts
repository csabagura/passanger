import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Expense, FuelLog } from '$lib/db/schema';
import type { HistoryEntry } from '$lib/utils/historyEntries';
import EntryDetailSheet from './EntryDetailSheet.svelte';

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
		notes: overrides.notes ?? 'Road trip fill-up'
	};
}

function createMaintenanceEntry(overrides: Partial<Expense> = {}): Expense {
	return {
		id: overrides.id ?? 12,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date('2026-03-10T12:00:00Z'),
		type: overrides.type ?? 'Oil Change',
		odometer: overrides.odometer,
		cost: overrides.cost ?? 120,
		notes: overrides.notes
	};
}

function renderSheet(
	entry: HistoryEntry,
	props: Partial<{
		currency: string;
		preferredFuelUnit: 'L/100km' | 'MPG';
		deleteState: 'idle' | 'armed' | 'loading';
		deleteDisabled: boolean;
		deleteErrorText: string;
		onClose: () => void;
		onEdit: (request: HistoryEntry) => void;
		onDeleteRequest: (request: HistoryEntry) => void;
		onDeleteConfirm: (request: HistoryEntry) => void;
		onDeleteCancel: (request: HistoryEntry) => void;
	}> = {}
) {
	return render(EntryDetailSheet, {
		entry,
		currency: props.currency ?? 'EUR ',
		preferredFuelUnit: props.preferredFuelUnit ?? 'L/100km',
		deleteState: props.deleteState ?? 'idle',
		deleteDisabled: props.deleteDisabled ?? false,
		deleteErrorText: props.deleteErrorText ?? '',
		onClose: props.onClose ?? vi.fn(),
		onEdit: props.onEdit ?? vi.fn(),
		onDeleteRequest: props.onDeleteRequest ?? vi.fn(),
		onDeleteConfirm: props.onDeleteConfirm ?? vi.fn(),
		onDeleteCancel: props.onDeleteCancel ?? vi.fn()
	});
}

describe('EntryDetailSheet', () => {
	beforeEach(() => {
		document.body.style.overflow = '';
		document.documentElement.style.overflow = '';
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

	it('renders the full fuel-entry field contract and focuses the sheet title on open', async () => {
		renderSheet({ kind: 'fuel', entry: createFuelEntry() });

		expect(screen.getByRole('dialog', { name: 'Entry details' })).toBeTruthy();
		expect(screen.getByText('Mar 10, 2026')).toBeTruthy();
		expect(screen.getByText('Fuel')).toBeTruthy();
		expect(screen.getByText('87,400 km')).toBeTruthy();
		expect(screen.getByText('42')).toBeTruthy();
		expect(screen.getByText('L')).toBeTruthy();
		expect(screen.getByText('EUR 78.00')).toBeTruthy();
		expect(screen.getByText('7.2 L/100km')).toBeTruthy();
		expect(screen.getByText('Road trip fill-up')).toBeTruthy();

		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Entry details' }));
		});
	});

	it('renders stored fuel consumption in the preferred display unit', () => {
		renderSheet(
			{
				kind: 'fuel',
				entry: createFuelEntry({ unit: 'gal', distanceUnit: 'mi', calculatedConsumption: 30 })
			},
			{ preferredFuelUnit: 'L/100km' }
		);

		expect(screen.getByText('7.8 L/100km')).toBeTruthy();
		expect(screen.queryByText('30.0 MPG')).toBeNull();
	});

	it('renders metric-stored fuel entry as MPG when preferred unit is MPG', () => {
		renderSheet(
			{
				kind: 'fuel',
				entry: createFuelEntry({ unit: 'L', distanceUnit: 'km', calculatedConsumption: 7.2 })
			},
			{ preferredFuelUnit: 'MPG' }
		);

		expect(screen.getByText('32.7 MPG')).toBeTruthy();
		expect(screen.queryByText('7.2 L/100km')).toBeNull();
	});

	it('locks background scroll while mounted and restores overflow styles on unmount', () => {
		const view = renderSheet({ kind: 'fuel', entry: createFuelEntry() });

		expect(document.body.style.overflow).toBe('hidden');
		expect(document.documentElement.style.overflow).toBe('hidden');

		view.unmount();

		expect(document.body.style.overflow).toBe('');
		expect(document.documentElement.style.overflow).toBe('');
	});

	it('renders maintenance placeholders for missing quantity, unit, odometer, consumption, and notes', () => {
		renderSheet({
			kind: 'maintenance',
			entry: createMaintenanceEntry({ odometer: undefined, notes: undefined, type: 'Tyres' })
		});

		expect(screen.getByText('Tyres')).toBeTruthy();
		expect(screen.getByText('EUR 120.00')).toBeTruthy();
		expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(5);
	});

	it('does not infer a maintenance distance unit when none is stored', () => {
		renderSheet({
			kind: 'maintenance',
			entry: createMaintenanceEntry({ odometer: 87400, notes: 'Filter' })
		});

		expect(screen.getByText('87,400')).toBeTruthy();
		expect(screen.queryByText(/87,400 km/)).toBeNull();
		expect(screen.queryByText(/87,400 mi/)).toBeNull();
	});

	it('supports close button, backdrop, Escape, and swipe-down dismissal', async () => {
		const onClose = vi.fn();

		renderSheet({ kind: 'fuel', entry: createFuelEntry() }, { onClose });
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(onClose).toHaveBeenCalledTimes(1);

		cleanup();
		renderSheet({ kind: 'fuel', entry: createFuelEntry() }, { onClose });
		await fireEvent.click(screen.getByRole('button', { name: /close entry details/i }));
		expect(onClose).toHaveBeenCalledTimes(2);

		cleanup();
		renderSheet({ kind: 'fuel', entry: createFuelEntry() }, { onClose });
		await fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(3);

		cleanup();
		renderSheet({ kind: 'fuel', entry: createFuelEntry() }, { onClose });
		const handle = document.querySelector<HTMLElement>('[data-entry-detail-handle="true"]');
		expect(handle).toBeTruthy();
		await fireEvent.pointerDown(handle as HTMLElement, { pointerId: 1, clientX: 160, clientY: 16 });
		await fireEvent.pointerMove(handle as HTMLElement, {
			pointerId: 1,
			clientX: 156,
			clientY: 120
		});
		await fireEvent.pointerUp(handle as HTMLElement, { pointerId: 1, clientX: 156, clientY: 120 });
		expect(onClose).toHaveBeenCalledTimes(4);
	});

	it('traps keyboard focus inside the sheet when tabbing forward and backward', async () => {
		renderSheet({ kind: 'fuel', entry: createFuelEntry() });

		const dialog = screen.getByRole('dialog', { name: 'Entry details' });
		const closeButton = within(dialog).getByRole('button', { name: 'Close' });
		const deleteButton = within(dialog).getByRole('button', { name: 'Delete' });

		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Entry details' }));
		});

		closeButton.focus();
		expect(document.activeElement).toBe(closeButton);

		await fireEvent.keyDown(window, { key: 'Tab', code: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(deleteButton);

		await fireEvent.keyDown(window, { key: 'Tab', code: 'Tab' });
		expect(document.activeElement).toBe(closeButton);
	});

	it('keeps delete confirmation inline and emits delete callbacks for the selected entry', async () => {
		const fuelEntry = createFuelEntry({ id: 17 });
		const onDeleteRequest = vi.fn();
		const onDeleteConfirm = vi.fn();
		const onDeleteCancel = vi.fn();
		const view = renderSheet(
			{ kind: 'fuel', entry: fuelEntry },
			{ onDeleteRequest, onDeleteConfirm, onDeleteCancel }
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		expect(onDeleteRequest).toHaveBeenCalledTimes(1);
		expect(onDeleteRequest).toHaveBeenCalledWith({ kind: 'fuel', entry: fuelEntry });

		await view.rerender({
			entry: { kind: 'fuel', entry: fuelEntry },
			currency: 'EUR ',
			deleteState: 'armed',
			deleteDisabled: false,
			onClose: vi.fn(),
			onEdit: vi.fn(),
			onDeleteRequest,
			onDeleteConfirm,
			onDeleteCancel
		});

		expect(screen.getByText('Delete this entry? This cannot be undone.')).toBeTruthy();

		await fireEvent.click(
			screen.getByRole('button', {
				name: 'Confirm delete fuel entry from Mar 10, 2026'
			})
		);
		expect(onDeleteConfirm).toHaveBeenCalledTimes(1);
		expect(onDeleteConfirm).toHaveBeenCalledWith({ kind: 'fuel', entry: fuelEntry });

		await fireEvent.click(
			screen.getByRole('button', {
				name: 'Cancel deleting fuel entry from Mar 10, 2026'
			})
		);
		expect(onDeleteCancel).toHaveBeenCalledTimes(1);
		expect(onDeleteCancel).toHaveBeenCalledWith({ kind: 'fuel', entry: fuelEntry });
	});

	it('renders delete failures inside the visible sheet alert region', () => {
		renderSheet(
			{ kind: 'fuel', entry: createFuelEntry() },
			{
				deleteState: 'armed',
				deleteErrorText: 'Could not delete fuel entry. Please try again.'
			}
		);

		const dialog = screen.getByRole('dialog', { name: 'Entry details' });
		const alert = within(dialog).getByRole('alert');

		expect(alert).toBeTruthy();
		expect(within(dialog).getByText('Could not delete fuel entry. Please try again.')).toBeTruthy();
	});
});
