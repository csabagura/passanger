import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { SETTINGS_STORAGE_KEY } from '$lib/config';
import type { AppSettings } from '$lib/utils/settings';
import { createReactiveSettingsContext } from './settingsReactiveTestContext.svelte';
import SettingsPage from './+page.svelte';

const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		}
	};
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

function renderPage(initial: AppSettings) {
	const settingsContext = createReactiveSettingsContext(initial);
	const vehiclesContext = {
		vehicles: [],
		activeVehicle: null,
		activeVehicleId: null,
		loaded: true,
		vehiclesError: false,
		switchVehicle: vi.fn(),
		refreshVehicles: vi.fn().mockResolvedValue(undefined)
	};

	const result = render(SettingsPage, {
		context: new Map<string, unknown>([
			['settings', settingsContext],
			['vehicles', vehiclesContext]
		])
	});
	return { ...result, settingsContext };
}

beforeEach(() => {
	localStorageMock.clear();
});

afterEach(() => {
	cleanup();
});

describe('S28: settings form re-syncs on a remote change when the user has no unsaved edit', () => {
	it('reflects a remote (cross-tab) settings change live when the form is clean', async () => {
		const { settingsContext } = renderPage({
			fuelUnit: 'L/100km',
			currency: '€',
			theme: 'system'
		});

		expect((screen.getByLabelText('Currency prefix') as HTMLInputElement).value).toBe('€');

		// Simulate another tab's settings write reaching this tab (the layout's 'settings'
		// BroadcastChannel handler reassigns its $state settings, which this context mirrors).
		settingsContext.setRemote({ fuelUnit: 'L/100km', currency: '$', theme: 'system' });
		flushSync();

		await waitFor(() => {
			expect((screen.getByLabelText('Currency prefix') as HTMLInputElement).value).toBe('$');
		});
	});

	it('does NOT clobber a genuinely dirty local edit with an incoming remote change', async () => {
		const { settingsContext } = renderPage({
			fuelUnit: 'L/100km',
			currency: '€',
			theme: 'system'
		});

		const currencyInput = screen.getByLabelText('Currency prefix') as HTMLInputElement;
		await fireEvent.input(currencyInput, { target: { value: '£' } });
		expect(currencyInput.value).toBe('£');

		// A remote change arrives while the user has an unsaved edit in progress.
		settingsContext.setRemote({ fuelUnit: 'L/100km', currency: '$', theme: 'system' });
		flushSync();

		// The user's in-progress '£' edit must survive — not silently reverted to '$'.
		expect(currencyInput.value).toBe('£');
	});

	it('re-syncs cleanly again after a successful save resets the dirty flag', async () => {
		const { settingsContext } = renderPage({
			fuelUnit: 'L/100km',
			currency: '€',
			theme: 'system'
		});

		const currencyInput = screen.getByLabelText('Currency prefix') as HTMLInputElement;
		await fireEvent.input(currencyInput, { target: { value: '£' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		await waitFor(() => {
			expect(localStorageMock.getItem(SETTINGS_STORAGE_KEY)).not.toBeNull();
		});

		// Now that the save cleared `dirty`, the NEXT remote change should reach the form again.
		settingsContext.setRemote({ fuelUnit: 'L/100km', currency: '$', theme: 'system' });
		flushSync();

		await waitFor(() => {
			expect(currencyInput.value).toBe('$');
		});
	});
});
