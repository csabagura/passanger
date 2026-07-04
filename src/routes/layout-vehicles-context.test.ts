import 'fake-indexeddb/auto'; // MUST be first — patches global IndexedDB before db.ts opens
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { db } from '$lib/db/db';
import { saveVehicle } from '$lib/db/repositories/vehicles';
import { VEHICLE_ID_STORAGE_KEY } from '$lib/config';
import LayoutShell from './LayoutShell.test.svelte';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/'), state: {} }
}));

vi.mock('$app/navigation', () => ({
	replaceState: vi.fn(),
	afterNavigate: vi.fn()
}));

vi.mock('$app/paths', () => ({
	resolve: (href: string) => href
}));

vi.mock('virtual:pwa-register', () => ({
	registerSW: vi.fn(() => vi.fn())
}));

vi.mock('$lib/utils/storagePersistence', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/utils/storagePersistence')>();
	return { ...actual, requestStoragePersistence: () => Promise.resolve('granted') };
});

beforeEach(async () => {
	await db.delete();
	await db.open();
	localStorage.clear();
});

afterEach(() => {
	cleanup();
});

async function renderLayout() {
	const result = render(LayoutShell);
	await new Promise((r) => setTimeout(r, 0));
	return result;
}

describe('layout vehicles context — S19 dangling active-vehicle id', () => {
	it('falls back to the first vehicle when the stored id matches no vehicle', async () => {
		const v1 = await saveVehicle({ name: 'Car One', make: 'Honda', model: 'Civic' });
		await saveVehicle({ name: 'Car Two', make: 'Ford', model: 'Focus' });
		// A dangling id — e.g. the previously-active vehicle was deleted elsewhere.
		localStorage.setItem(VEHICLE_ID_STORAGE_KEY, '999999');

		await renderLayout();

		await waitFor(() => {
			expect(localStorage.getItem(VEHICLE_ID_STORAGE_KEY)).toBe(String(v1.data!.id));
		});
	});

	it('does NOT fall back on genuine first-run (no stored id, empty DB)', async () => {
		await renderLayout();
		await new Promise((r) => setTimeout(r, 50));
		expect(localStorage.getItem(VEHICLE_ID_STORAGE_KEY)).toBeNull();
	});

	it('does NOT fall back while vehicles.length === 0 even with a stale stored id (genuine first-run after last vehicle removed)', async () => {
		localStorage.setItem(VEHICLE_ID_STORAGE_KEY, '42');
		await renderLayout();
		await new Promise((r) => setTimeout(r, 50));
		// No vehicles exist at all — this stays onboarding, the stored id is left untouched.
		expect(localStorage.getItem(VEHICLE_ID_STORAGE_KEY)).toBe('42');
	});
});
