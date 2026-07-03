import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { SETTINGS_STORAGE_KEY } from '$lib/config';
import type { AppSettings } from '$lib/utils/settings';
import SettingsPage from './+page.svelte';

vi.mock('$lib/db/repositories/vehicles', () => ({
	getAllVehicles: () => Promise.resolve({ data: [], error: null }),
	deleteVehicle: () => Promise.resolve({ data: undefined, error: null }),
	getVehicleCount: () => Promise.resolve({ data: 0, error: null }),
	saveVehicle: () => Promise.resolve({ data: null, error: null }),
	updateVehicle: () => Promise.resolve({ data: null, error: null })
}));

const mockUpdateSettings = vi.fn();

let settingsState: { value: AppSettings } = {
	value: {
		fuelUnit: 'L/100km' as const,
		currency: '€',
		theme: 'system'
	}
};

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

const mockSwitchVehicle = vi.fn();
const mockRefreshVehicles = vi.fn().mockResolvedValue(undefined);

function renderPage() {
	const settingsContext = {
		get settings() {
			return settingsState.value;
		},
		updateSettings(nextSettings: AppSettings) {
			settingsState.value = nextSettings;
			mockUpdateSettings(nextSettings);
		}
	};

	// H12: Settings now reads the layout's shared vehicles context directly (no more page-local
	// activeVehicleId mirror), so the page/VehicleListManager both need it present.
	const vehiclesContext = {
		vehicles: [],
		activeVehicle: null,
		activeVehicleId: null,
		loaded: true,
		vehiclesError: false,
		switchVehicle: mockSwitchVehicle,
		refreshVehicles: mockRefreshVehicles
	};

	return render(SettingsPage, {
		context: new Map<string, unknown>([
			['settings', settingsContext],
			['vehicles', vehiclesContext]
		])
	});
}

describe('Settings page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
		settingsState = {
			value: {
				fuelUnit: 'L/100km',
				currency: '€',
				theme: 'system'
			}
		};
	});

	afterEach(() => {
		cleanup();
	});

	it('renders Units & Currency section with fuel unit and currency controls', () => {
		renderPage();
		expect(screen.getByRole('heading', { name: 'Units & Currency' })).toBeTruthy();
		expect(screen.getByRole('radio', { name: 'L/100km' })).toBeTruthy();
		expect(screen.getByRole('radio', { name: 'MPG' })).toBeTruthy();
		expect(screen.getByLabelText('Currency prefix')).toBeTruthy();
		// Story 5.2: the rate fieldset uses the canonical glossary term "Display rate".
		expect(screen.getByText('Display rate')).toBeTruthy();
	});

	it('persists a typed Display rate (number-input coercion does not break the save)', async () => {
		// Regression for the pre-existing crash: the `<input type="number">` binds back a number, so
		// buildExchangeRates' `draft.trim()` threw `TypeError: n.trim is not a function` and the save
		// aborted — no rate ever persisted. Filling and saving must now persist exchangeRates.
		renderPage();

		await fireEvent.input(screen.getByLabelText('1 Ft ='), { target: { value: '0.0025' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		const raw = localStorageMock.getItem(SETTINGS_STORAGE_KEY);
		expect(raw).not.toBeNull();
		const saved = JSON.parse(raw as string);
		expect(saved.exchangeRates).toEqual({ Ft: 0.0025 });
		expect(screen.getByRole('status').textContent).toContain('Settings saved.');
	});

	it('saves fuel unit and currency correctly', async () => {
		renderPage();

		await fireEvent.click(screen.getByRole('button', { name: '$' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		expect(mockUpdateSettings).toHaveBeenCalledWith({
			fuelUnit: 'L/100km',
			currency: '$',
			theme: 'system'
		});
		expect(JSON.parse(localStorageMock.getItem(SETTINGS_STORAGE_KEY)!)).toEqual({
			fuelUnit: 'L/100km',
			currency: '$',
			theme: 'system'
		});
		expect(screen.getByRole('status').textContent).toContain('Settings saved.');
	});

	it('saves custom currency prefixes and fuel-unit changes', async () => {
		renderPage();

		await fireEvent.click(screen.getByRole('radio', { name: 'MPG' }));
		await fireEvent.input(screen.getByLabelText('Currency prefix'), {
			target: { value: 'EUR ' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		expect(mockUpdateSettings).toHaveBeenCalledWith({
			fuelUnit: 'MPG',
			currency: 'EUR ',
			theme: 'system'
		});
		expect(JSON.parse(localStorageMock.getItem(SETTINGS_STORAGE_KEY)!)).toEqual({
			fuelUnit: 'MPG',
			currency: 'EUR ',
			theme: 'system'
		});
	});

	it('preserves heroMetric when saving unit/currency changes (H15 regression)', async () => {
		settingsState.value = {
			fuelUnit: 'L/100km',
			currency: '€',
			theme: 'system',
			heroMetric: 'consumption'
		};
		renderPage();

		await fireEvent.click(screen.getByRole('button', { name: '$' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		expect(mockUpdateSettings).toHaveBeenCalledWith(
			expect.objectContaining({ currency: '$', heroMetric: 'consumption' })
		);
		const saved = JSON.parse(localStorageMock.getItem(SETTINGS_STORAGE_KEY)!);
		expect(saved.heroMetric).toBe('consumption');
	});

	it('still drops exchangeRates on a home-currency change (spread must not resurrect them)', async () => {
		settingsState.value = {
			fuelUnit: 'L/100km',
			currency: '€',
			theme: 'system',
			exchangeRates: { Ft: 0.0025 },
			heroMetric: 'consumption'
		};
		renderPage();

		await fireEvent.click(screen.getByRole('button', { name: '$' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		// Rates are relative to the home currency: after '€' → '$' they are meaningless and must be
		// ABSENT from both the persisted object and the in-memory update — not carried over.
		const saved = JSON.parse(localStorageMock.getItem(SETTINGS_STORAGE_KEY)!);
		expect('exchangeRates' in saved).toBe(false);
		expect(saved.heroMetric).toBe('consumption');

		const updated = mockUpdateSettings.mock.calls.at(-1)![0];
		expect('exchangeRates' in updated).toBe(false);
	});

	it('surfaces blocked settings persistence instead of updating runtime state', async () => {
		renderPage();

		const setItemSpy = vi.spyOn(localStorageMock, 'setItem').mockImplementationOnce(() => {
			throw new DOMException('SecurityError', 'SecurityError');
		});

		await fireEvent.click(screen.getByRole('button', { name: '$' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		expect(mockUpdateSettings).not.toHaveBeenCalled();
		expect(localStorageMock.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
		expect(screen.getByRole('alert').textContent).toContain(
			'Could not save settings on this device.'
		);
		expect(screen.queryByRole('status')).toBeNull();

		setItemSpy.mockRestore();
	});

	it('rejects blank currency input instead of saving it', async () => {
		renderPage();

		await fireEvent.input(screen.getByLabelText('Currency prefix'), {
			target: { value: '   ' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		expect(mockUpdateSettings).not.toHaveBeenCalled();
		expect(screen.getByRole('alert').textContent).toContain('Enter a currency symbol or prefix.');
		expect(localStorageMock.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
	});

	describe('Appearance section', () => {
		it('renders Appearance heading and three theme radio options', () => {
			renderPage();
			expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
			expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();

			const radios = screen.getAllByRole('radio');
			// 3 theme radios + 2 fuel unit radios = 5 total
			expect(radios.length).toBe(5);

			expect(screen.getByRole('radio', { name: /System/ })).toBeTruthy();
			expect(screen.getByRole('radio', { name: /Light/ })).toBeTruthy();
			expect(screen.getByRole('radio', { name: /Dark/ })).toBeTruthy();
		});

		it('shows System as active by default (aria-checked)', () => {
			renderPage();
			const systemRadio = screen.getByRole('radio', { name: /System/ });
			expect(systemRadio.getAttribute('aria-checked')).toBe('true');

			const lightRadio = screen.getByRole('radio', { name: /Light/ });
			expect(lightRadio.getAttribute('aria-checked')).toBe('false');

			const darkRadio = screen.getByRole('radio', { name: /Dark/ });
			expect(darkRadio.getAttribute('aria-checked')).toBe('false');
		});

		it('selects Dark theme and persists it immediately', async () => {
			renderPage();

			await fireEvent.click(screen.getByRole('radio', { name: /Dark/ }));

			expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
			expect(JSON.parse(localStorageMock.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({
				theme: 'dark'
			});
		});

		it('selects Light theme and persists it immediately', async () => {
			renderPage();

			await fireEvent.click(screen.getByRole('radio', { name: /Light/ }));

			expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light' }));
		});

		it('renders helper text for each theme option', () => {
			renderPage();
			expect(screen.getByText('Follows your device setting')).toBeTruthy();
			expect(screen.getByText('Always light')).toBeTruthy();
			expect(screen.getByText('Always dark')).toBeTruthy();
		});

		it('cycles through themes with ArrowRight and wraps around with ArrowLeft', async () => {
			renderPage();

			const radiogroup = screen.getByRole('radiogroup', { name: 'Theme' });

			// Default is System → ArrowRight → Light
			await fireEvent.keyDown(radiogroup, { key: 'ArrowRight' });
			expect(mockUpdateSettings).toHaveBeenLastCalledWith(
				expect.objectContaining({ theme: 'light' })
			);

			// Light → ArrowRight → Dark
			await fireEvent.keyDown(radiogroup, { key: 'ArrowRight' });
			expect(mockUpdateSettings).toHaveBeenLastCalledWith(
				expect.objectContaining({ theme: 'dark' })
			);

			// Dark → ArrowRight → System (wraparound)
			await fireEvent.keyDown(radiogroup, { key: 'ArrowRight' });
			expect(mockUpdateSettings).toHaveBeenLastCalledWith(
				expect.objectContaining({ theme: 'system' })
			);

			// System → ArrowLeft → Dark (reverse wraparound)
			await fireEvent.keyDown(radiogroup, { key: 'ArrowLeft' });
			expect(mockUpdateSettings).toHaveBeenLastCalledWith(
				expect.objectContaining({ theme: 'dark' })
			);
		});
	});
});
