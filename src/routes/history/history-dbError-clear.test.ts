import 'fake-indexeddb/auto'; // MUST be first — patches global IndexedDB before db.ts opens
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { db } from '$lib/db/db';
import { saveVehicle } from '$lib/db/repositories/vehicles';
import { getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
import { err } from '$lib/utils/result';
import { createReactiveVehiclesTestContext } from './historyReactiveVehiclesTestContext.svelte';
import HistoryPage from './+page.svelte';

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

const mockToast = { success: vi.fn(), error: vi.fn(), action: vi.fn() };

function renderPage(vehiclesCtx: ReturnType<typeof createReactiveVehiclesTestContext>) {
	const context = new Map<string, unknown>([
		['vehicles', vehiclesCtx],
		['toast', mockToast],
		['settings', { settings: { fuelUnit: 'L/100km', currency: '€', theme: 'system' } }],
		['tabSync', { dataRevision: 0, restorePending: false }]
	]);
	return render(HistoryPage, { context });
}

beforeEach(async () => {
	await db.delete();
	await db.open();
});

afterEach(() => {
	cleanup();
});

describe('S29: History clears a stale dbError when the active vehicle disappears', () => {
	it('clears the DB-error card once the active vehicle goes away', async () => {
		const car = await saveVehicle({ name: 'Car', make: 'Honda', model: 'Civic' });
		const vehiclesCtx = createReactiveVehiclesTestContext([car.data!]);

		vi.spyOn(await import('$lib/db/repositories/fuelLogs'), 'getAllFuelLogs').mockResolvedValue(
			err('DB_READ_FAILED', 'boom')
		);

		renderPage(vehiclesCtx);
		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeTruthy();
		});

		vehiclesCtx.clearActiveVehicle();
		flushSync();

		await waitFor(() => {
			expect(screen.queryByRole('alert')).toBeNull();
		});

		vi.mocked(getAllFuelLogs).mockRestore();
	});
});
