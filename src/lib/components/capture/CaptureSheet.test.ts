import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import CaptureSheet from './CaptureSheet.svelte';
import { createCaptureSheet } from '$lib/state/captureSheet.svelte';
import type { AppSettings } from '$lib/utils/settings';
import type { VehiclesContext } from '$lib/utils/vehicleContext';

// FuelEntryForm reads the timeline on mount; stub the repository so the sheet mounts cleanly.
vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: vi.fn().mockResolvedValue({ data: [], error: null }),
	saveFuelLog: vi.fn(),
	updateFuelLog: vi.fn(),
	updateFuelLogsAtomic: vi.fn()
}));

const settings: AppSettings = { fuelUnit: 'L/100km', currency: '€', theme: 'system' };

function vehiclesCtx(activeVehicleId: number | null): VehiclesContext {
	return {
		vehicles: [],
		activeVehicle: null,
		activeVehicleId,
		loaded: true,
		switchVehicle: vi.fn(),
		refreshVehicles: vi.fn()
	} as unknown as VehiclesContext;
}

function renderSheet(opts: { open: boolean; vehicleId?: number | null } = { open: false }) {
	const capture = createCaptureSheet();
	if (opts.open) capture.openSheet('fuel');
	const vehicleId = opts.vehicleId === undefined ? 1 : opts.vehicleId;
	render(CaptureSheet, {
		context: new Map<string, unknown>([
			['captureSheet', capture],
			['vehicles', vehiclesCtx(vehicleId)],
			['settings', { settings }]
		])
	});
	flushSync();
	return { capture };
}

describe('CaptureSheet', () => {
	beforeEach(() => cleanup());

	it('is hidden when the context is closed', () => {
		renderSheet({ open: false });
		// bits-ui Dialog renders no content while closed
		expect(screen.queryByText('Log an entry')).toBeNull();
	});

	it('is visible and defaults to the Fuel segment when opened', () => {
		renderSheet({ open: true });
		// title proves the sheet is mounted (portalled to document.body)
		expect(screen.getByText('Log an entry')).toBeTruthy();
		// both segments present, Fuel selected by default (AC-1)…
		expect(screen.getByRole('tab', { name: 'Fuel', selected: true })).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'Expense', selected: false })).toBeTruthy();
		// …and the Fuel form is mounted in the sheet (its "Total Cost" label is unique to it)
		expect(screen.getByText(/Total Cost/i)).toBeTruthy();
	});

	it('swaps to the Expense segment when the mode changes', () => {
		const { capture } = renderSheet({ open: true });
		capture.setMode('expense');
		flushSync();
		// the segmented control follows the context (controlled value) — Expense is now selected
		expect(screen.getByRole('tab', { name: 'Expense', selected: true })).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'Fuel', selected: false })).toBeTruthy();
		// the Expense form (MaintenanceForm "Type" field) is present in the sheet
		expect(screen.getByText(/^Type$/)).toBeTruthy();
	});

	it('renders a calm CTA instead of a broken form when no vehicle exists', () => {
		renderSheet({ open: true, vehicleId: null });
		expect(screen.getByText(/add your car to get started/i)).toBeTruthy();
		expect(screen.queryByText(/Total Cost/i)).toBeNull();
	});

	it('closing the sheet drives capture.close()', async () => {
		const { capture } = renderSheet({ open: true });
		expect(capture.open).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: /close/i }));
		expect(capture.open).toBe(false);
	});
});
