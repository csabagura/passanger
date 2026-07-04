import 'fake-indexeddb/auto'; // MUST be first — patches global IndexedDB before db.ts opens
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { db } from '$lib/db/db';
import HomePage from './+page.svelte';

const testVehicle = { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang', year: 2016 };

function settingsContext() {
	return {
		get settings() {
			return { fuelUnit: 'L/100km' as const, currency: '€', theme: 'system' as const };
		},
		updateSettings: vi.fn()
	};
}

function makeVehiclesContext(
	activeVehicle: typeof testVehicle | null = null,
	loaded = true,
	vehiclesError = false
) {
	return {
		get vehicles() {
			return activeVehicle ? [activeVehicle] : [];
		},
		get activeVehicle() {
			return activeVehicle;
		},
		get activeVehicleId() {
			return activeVehicle?.id ?? null;
		},
		get loaded() {
			return loaded;
		},
		get vehiclesError() {
			return vehiclesError;
		},
		switchVehicle: vi.fn(),
		refreshVehicles: vi.fn().mockResolvedValue(undefined)
	};
}

function renderHome(vehiclesCtx = makeVehiclesContext()) {
	const context = new Map<string, unknown>();
	context.set('vehicles', vehiclesCtx);
	context.set('settings', settingsContext());
	return render(HomePage, { context });
}

beforeEach(async () => {
	await db.delete();
	await db.open();
});

afterEach(() => {
	cleanup();
});

describe('Home page (Story 3.3 shell)', () => {
	it('AC3: shows the no-vehicle first-run when there is no active vehicle', async () => {
		renderHome(makeVehiclesContext(null));
		await waitFor(() => {
			expect(screen.getByText('No vehicle yet')).toBeTruthy();
		});
		expect(screen.getByRole('button', { name: /Add your vehicle to get started/i })).toBeTruthy();
	});

	it('AC3: the no-vehicle CTA never flashes before the async vehicle read resolves (gated on loaded)', () => {
		renderHome(makeVehiclesContext(null, /* loaded */ false));
		// While vehicles are still loading, neither the first-run CTA nor a dashboard should render.
		expect(screen.queryByText('No vehicle yet')).toBeNull();
		expect(screen.queryByRole('button', { name: /Add your vehicle/i })).toBeNull();
	});

	it('AC3: clicking the CTA reveals the onboarding wizard (Story 9.1)', async () => {
		renderHome(makeVehiclesContext(null));
		await waitFor(() => {
			expect(screen.getByRole('button', { name: /Add your vehicle to get started/i })).toBeTruthy();
		});
		await fireEvent.click(screen.getByRole('button', { name: /Add your vehicle to get started/i }));
		// The guided wizard opens at step 1 (replaces the plain VehicleForm first-run).
		expect(screen.getByRole('heading', { name: 'Add your car' })).toBeTruthy();
		expect(screen.getByText(/step 1 of 3/i)).toBeTruthy();
	});

	it('AC1/AC4: with an active vehicle it mounts the dashboard (cold-load skeleton first)', async () => {
		renderHome(makeVehiclesContext(testVehicle));
		// HomeDashboard renders its skeleton until the liveQuery seed resolves.
		expect(screen.getByText(/loading your dashboard/i)).toBeTruthy();
		// Then the glanceable content (no data yet → first-fill next-action) resolves.
		await waitFor(() => {
			expect(screen.getByText(/log your first fill-up to see cost per km/i)).toBeTruthy();
		});
	});

	it('H2: a vehicle-list load failure renders the DB-error card, never first-run onboarding', () => {
		renderHome(makeVehiclesContext(null, /* loaded */ true, /* vehiclesError */ true));
		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByText('Could not load your dashboard')).toBeTruthy();
		expect(screen.queryByText('No vehicle yet')).toBeNull();
	});
});
