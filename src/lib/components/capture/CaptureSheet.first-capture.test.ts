import 'fake-indexeddb/auto'; // MUST be first — patches global IndexedDB before db.ts opens
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { db } from '$lib/db/db';
import { saveExpense } from '$lib/db/repositories/expenses';
import CaptureSheet from './CaptureSheet.svelte';
import { createCaptureSheet } from '$lib/state/captureSheet.svelte';
import type { AppSettings } from '$lib/utils/settings';
import type { VehiclesContext } from '$lib/utils/vehicleContext';

// Story 3.3 (AC-7): the first-Capture install/survey trigger must NOT be dropped when /log's inline
// forms retire. CaptureSheet forwards `onFirstCreateSave` to both forms; this drives a real first save
// through the sheet (real repositories over fake-indexeddb) and asserts the callback fires once.

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

beforeEach(async () => {
	await db.delete();
	await db.open();
});

afterEach(() => cleanup());

describe('CaptureSheet — first-Capture install/survey trigger (AC-7)', () => {
	it('forwards onFirstCreateSave to the Fuel form; it fires on the first successful save', async () => {
		const onFirstCreateSave = vi.fn();
		const capture = createCaptureSheet();
		capture.openSheet('fuel');

		render(CaptureSheet, {
			props: { onFirstCreateSave },
			context: new Map<string, unknown>([
				['captureSheet', capture],
				['vehicles', vehiclesCtx(1)],
				['settings', { settings }]
			])
		});
		flushSync();

		await fireEvent.input(screen.getByLabelText(/^Odometer/i), { target: { value: '50000' } });
		await fireEvent.input(screen.getByLabelText(/^Quantity/i), { target: { value: '40' } });
		await fireEvent.input(screen.getByLabelText(/^Total Cost/i), { target: { value: '60' } });
		await fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

		await waitFor(() => expect(onFirstCreateSave).toHaveBeenCalledTimes(1));
	});

	it('does NOT re-fire onFirstCreateSave on a second save (only the first entry triggers it)', async () => {
		const onFirstCreateSave = vi.fn();
		const capture = createCaptureSheet();
		capture.openSheet('fuel');

		render(CaptureSheet, {
			props: { onFirstCreateSave },
			context: new Map<string, unknown>([
				['captureSheet', capture],
				['vehicles', vehiclesCtx(1)],
				['settings', { settings }]
			])
		});
		flushSync();

		// First save → fires.
		await fireEvent.input(screen.getByLabelText(/^Odometer/i), { target: { value: '50000' } });
		await fireEvent.input(screen.getByLabelText(/^Quantity/i), { target: { value: '40' } });
		await fireEvent.input(screen.getByLabelText(/^Total Cost/i), { target: { value: '60' } });
		await fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
		await waitFor(() => expect(onFirstCreateSave).toHaveBeenCalledTimes(1));

		// Second save (a now-non-empty timeline) → must NOT fire again.
		await fireEvent.input(screen.getByLabelText(/^Odometer/i), { target: { value: '50500' } });
		await fireEvent.input(screen.getByLabelText(/^Quantity/i), { target: { value: '41' } });
		await fireEvent.input(screen.getByLabelText(/^Total Cost/i), { target: { value: '62' } });
		await fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

		// Give any erroneous second invocation time to land.
		await new Promise((r) => setTimeout(r, 50));
		expect(onFirstCreateSave).toHaveBeenCalledTimes(1);
	});

	it('forwards onFirstCreateSave to the Expense form; it fires on the first successful save', async () => {
		const onFirstCreateSave = vi.fn();
		const capture = createCaptureSheet();
		capture.openSheet('expense');

		render(CaptureSheet, {
			props: { onFirstCreateSave },
			context: new Map<string, unknown>([
				['captureSheet', capture],
				['vehicles', vehiclesCtx(1)],
				['settings', { settings }]
			])
		});
		flushSync();

		// Date is pre-filled to today; Type + Cost are the required fields.
		await fireEvent.input(screen.getByLabelText(/^Type/i), { target: { value: 'Service' } });
		await fireEvent.input(screen.getByLabelText(/^Cost/i), { target: { value: '120' } });
		await fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

		await waitFor(() => expect(onFirstCreateSave).toHaveBeenCalledTimes(1));
	});

	it('does NOT fire onFirstCreateSave on a fresh Expense-form mount when the vehicle already has an expense (Story 3.3 AC-7 re-fire fix)', async () => {
		// The user has captured before. The global sheet remounts the form on every open, so an
		// instance-only first-save flag would re-arm and re-fire — this is the regression the DB seed
		// closes. Pre-seed an expense, then drive a fresh mount + save and assert the gate stays quiet.
		await saveExpense({
			vehicleId: 1,
			date: new Date(),
			type: 'Insurance',
			cost: 300,
			currency: '€',
			notes: ''
		});

		const onFirstCreateSave = vi.fn();
		const capture = createCaptureSheet();
		capture.openSheet('expense');

		render(CaptureSheet, {
			props: { onFirstCreateSave },
			context: new Map<string, unknown>([
				['captureSheet', capture],
				['vehicles', vehiclesCtx(1)],
				['settings', { settings }]
			])
		});
		flushSync();

		// Let the create-mode mount seed (getAllExpenses) resolve so the first-save guard reflects the
		// pre-existing expense before we save.
		await new Promise((r) => setTimeout(r, 50));

		await fireEvent.input(screen.getByLabelText(/^Type/i), { target: { value: 'Service' } });
		await fireEvent.input(screen.getByLabelText(/^Cost/i), { target: { value: '120' } });
		await fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

		// Give any erroneous invocation time to land, then assert it never fired.
		await new Promise((r) => setTimeout(r, 50));
		expect(onFirstCreateSave).not.toHaveBeenCalled();
	});
});
