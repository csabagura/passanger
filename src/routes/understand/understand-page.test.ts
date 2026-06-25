import 'fake-indexeddb/auto'; // MUST be first — the mounted dashboard uses liveQuery (needs a db)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { ok } from '$lib/utils/result';
import { m } from '$lib/paraglide/messages';
import UnderstandPage from './+page.svelte';

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

const mockGetAllFuelLogs = vi.fn();
const mockGetAllExpenses = vi.fn();

vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: (...args: unknown[]) => mockGetAllFuelLogs(...args)
}));

vi.mock('$lib/db/repositories/expenses', () => ({
	getAllExpenses: (...args: unknown[]) => mockGetAllExpenses(...args)
}));

let mockActiveVehicle: { id: number; name: string } | null = null;
let mockLoaded = true;

vi.mock('svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('svelte')>();
	return {
		...actual,
		getContext: (key: string) => {
			if (key === 'settings') {
				return { settings: { fuelUnit: 'L/100km', currency: '€', theme: 'system' } };
			}
			if (key === 'vehicles') {
				return {
					get activeVehicle() {
						return mockActiveVehicle;
					},
					get loaded() {
						return mockLoaded;
					}
				};
			}
			return undefined;
		}
	};
});

async function settlePage() {
	await waitFor(
		async () => {
			await new Promise<void>((r) => setTimeout(r, 0));
			flushSync();
		},
		{ timeout: 2000 }
	);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mockActiveVehicle = null;
	mockLoaded = true;
});

describe('Understand page', () => {
	it('sets the document title', () => {
		mockActiveVehicle = null;
		render(UnderstandPage);
		expect(document.title).toBe(m.understand_page_title());
	});

	it('shows the no-vehicle empty state when no vehicle is active', () => {
		mockActiveVehicle = null;
		render(UnderstandPage);
		expect(screen.getByRole('region', { name: m.understand_no_vehicle_region() })).toBeTruthy();
		expect(screen.getByText(m.understand_no_vehicle_title())).toBeTruthy();
		expect(screen.getByRole('link', { name: m.common_add_vehicle() })).toBeTruthy();
		expect(mockGetAllFuelLogs).not.toHaveBeenCalled();
	});

	it('renders nothing until the vehicles context has loaded', () => {
		mockActiveVehicle = null;
		mockLoaded = false;
		render(UnderstandPage);
		expect(screen.queryByRole('region', { name: m.understand_no_vehicle_region() })).toBeNull();
	});

	it('mounts the dashboard for an active vehicle', async () => {
		mockActiveVehicle = { id: 7, name: 'Old Faithful' };
		mockGetAllFuelLogs.mockResolvedValue(ok([]));
		mockGetAllExpenses.mockResolvedValue(ok([]));
		render(UnderstandPage);
		await settlePage();

		expect(screen.getByText(m.understand_no_data_title())).toBeTruthy();
		expect(screen.getByText(/Old Faithful/)).toBeTruthy();
		expect(mockGetAllFuelLogs).toHaveBeenCalledWith(7);
	});
});
