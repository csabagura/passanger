import 'fake-indexeddb/auto'; // MUST be first — the mounted dashboard uses liveQuery (needs a db)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { ok } from '$lib/utils/result';
import MaintainPage from './+page.svelte';

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

const mockGetAllFuelLogs = vi.fn();
const mockGetServiceRemindersForVehicle = vi.fn();

vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: (...args: unknown[]) => mockGetAllFuelLogs(...args)
}));

vi.mock('$lib/db/repositories/serviceReminders', () => ({
	getServiceRemindersForVehicle: (...args: unknown[]) => mockGetServiceRemindersForVehicle(...args),
	deleteServiceReminder: vi.fn(),
	saveServiceReminder: vi.fn(),
	updateServiceReminder: vi.fn()
}));

let mockActiveVehicle: { id: number; name: string } | null = null;
let mockLoaded = true;

vi.mock('svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('svelte')>();
	return {
		...actual,
		getContext: (key: string) => {
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

describe('Maintain page', () => {
	it('sets the document title', () => {
		mockActiveVehicle = null;
		render(MaintainPage);
		expect(document.title).toBe('Maintain | passanger');
	});

	it('shows the no-vehicle empty state when no vehicle is active', () => {
		mockActiveVehicle = null;
		render(MaintainPage);
		expect(screen.getByRole('region', { name: 'No vehicle selected' })).toBeTruthy();
		expect(screen.getByText('No vehicle yet')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Add a vehicle' })).toBeTruthy();
		expect(mockGetServiceRemindersForVehicle).not.toHaveBeenCalled();
	});

	it('renders nothing until the vehicles context has loaded', () => {
		mockActiveVehicle = null;
		mockLoaded = false;
		render(MaintainPage);
		expect(screen.queryByRole('region', { name: 'No vehicle selected' })).toBeNull();
	});

	it('mounts the dashboard for an active vehicle', async () => {
		mockActiveVehicle = { id: 7, name: 'Old Faithful' };
		mockGetAllFuelLogs.mockResolvedValue(ok([]));
		mockGetServiceRemindersForVehicle.mockResolvedValue(ok([]));
		render(MaintainPage);
		await settlePage();

		expect(screen.getByText('No reminders yet')).toBeTruthy();
		expect(screen.getByText(/Old Faithful/)).toBeTruthy();
		expect(mockGetServiceRemindersForVehicle).toHaveBeenCalledWith(7);
	});
});
