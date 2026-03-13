import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import FuelEntryPage from './+page.svelte';
import type { InstallPromptContext, InstallPromptPlatform } from '$lib/utils/installPrompt';

const mockGetVehicleById = vi.fn();
const mockSaveVehicle = vi.fn();
const mockGetAllVehicles = vi.fn();

vi.mock('$lib/db/repositories/vehicles', () => ({
	getVehicleById: (...args: unknown[]) => mockGetVehicleById(...args),
	saveVehicle: (...args: unknown[]) => mockSaveVehicle(...args),
	getAllVehicles: (...args: unknown[]) => mockGetAllVehicles(...args)
}));

// Isolate FuelEntryForm's fuelLogs calls from real Dexie in JSDOM (finding #3)
const mockGetAllFuelLogs = vi.fn();
const mockSaveFuelLog = vi.fn();
const mockUpdateFuelLogsAtomic = vi.fn();
const mockDismissInstallPrompt = vi.fn();
const mockRequestInstall = vi.fn<() => Promise<'accepted' | 'dismissed' | 'unavailable'>>();
const installPromptState = {
	platform: 'unsupported' as InstallPromptPlatform,
	isStandalone: false,
	isDismissed: false,
	canShowPrompt: false,
	canTriggerNativeInstall: false
};
const mockInstallPromptContext: InstallPromptContext = {
	get platform() {
		return installPromptState.platform;
	},
	get isStandalone() {
		return installPromptState.isStandalone;
	},
	get isDismissed() {
		return installPromptState.isDismissed;
	},
	get canShowPrompt() {
		return installPromptState.canShowPrompt;
	},
	get canTriggerNativeInstall() {
		return installPromptState.canTriggerNativeInstall;
	},
	dismissPrompt() {
		mockDismissInstallPrompt();
		installPromptState.isDismissed = true;
		installPromptState.canShowPrompt = false;
	},
	requestInstall() {
		installPromptState.isDismissed = true;
		installPromptState.canShowPrompt = false;
		return mockRequestInstall();
	}
};

vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: (...args: unknown[]) => mockGetAllFuelLogs(...args),
	saveFuelLog: (...args: unknown[]) => mockSaveFuelLog(...args),
	updateFuelLogsAtomic: (...args: unknown[]) => mockUpdateFuelLogsAtomic(...args)
}));

vi.mock('$lib/config', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/config')>();
	return { ...actual };
});

// Mock svelte's getContext to provide settings context for FuelEntryForm
vi.mock('svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('svelte')>();
	return {
		...actual,
		getContext: (key: string) => {
			if (key === 'settings') {
				return {
					settings: {
						fuelUnit: 'L/100km' as const,
						currency: '€'
					}
				};
			}
			if (key === 'installPrompt') {
				return mockInstallPromptContext;
			}
			return undefined;
		}
	};
});

// Mock localStorage
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

describe('FuelEntry page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
		installPromptState.platform = 'unsupported';
		installPromptState.isStandalone = false;
		installPromptState.isDismissed = false;
		installPromptState.canShowPrompt = false;
		installPromptState.canTriggerNativeInstall = false;
		mockRequestInstall.mockResolvedValue('accepted');
		// Default mock: recovery path returns no vehicles (empty state)
		mockGetAllVehicles.mockResolvedValue({
			data: [],
			error: null
		});
		// Default mock: FuelEntryForm history load returns empty list (isolated from real Dexie)
		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockSaveFuelLog.mockResolvedValue({ data: null, error: null });
		mockUpdateFuelLogsAtomic.mockResolvedValue({ data: [], error: null });
	});

	afterEach(() => {
		cleanup();
	});

	describe('AC #1 — empty state when no vehicle', () => {
		it('shows the empty-state heading and CTA when no vehicle is saved', async () => {
			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			expect(screen.getByRole('heading', { level: 1, name: 'No vehicle yet' })).toBeTruthy();
			expect(screen.getByRole('button', { name: 'Add your vehicle to get started' })).toBeTruthy();
		});

		it('shows CTA button to add a vehicle', async () => {
			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			expect(screen.getByRole('button', { name: 'Add your vehicle to get started' })).toBeTruthy();
		});

		it('does NOT show a tutorial modal or onboarding tour', async () => {
			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			// No dialog/modal role should appear
			expect(screen.queryByRole('dialog')).toBeNull();
		});

		it('receives focus on mount in empty state (accessibility requirement)', async () => {
			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			// The empty-state CTA button should receive focus
			const ctaButton = screen.getByRole('button', { name: 'Add your vehicle to get started' });
			expect(document.activeElement).toBe(ctaButton);
		});
	});

	describe('AC #2 — CTA opens vehicle form', () => {
		it('shows VehicleForm when CTA is tapped', async () => {
			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			await fireEvent.click(
				screen.getByRole('button', { name: 'Add your vehicle to get started' })
			);
			// Vehicle form fields should appear
			expect(screen.getByLabelText(/display name/i)).toBeTruthy();
			expect(screen.getByLabelText(/^make$/i)).toBeTruthy();
			expect(screen.getByLabelText(/^model$/i)).toBeTruthy();
			expect(screen.getByLabelText(/year/i)).toBeTruthy();
		});
	});

	describe('AC #3 — form save transitions to fuel entry view', () => {
		it('shows vehicle name after form submission', async () => {
			const savedVehicle = { id: 1, name: 'My Honda', make: 'Honda', model: 'Civic' };
			mockSaveVehicle.mockResolvedValue({ data: savedVehicle, error: null });

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Open form
			await fireEvent.click(
				screen.getByRole('button', { name: 'Add your vehicle to get started' })
			);

			// Fill form
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Honda' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Honda' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Civic' } });
			await fireEvent.submit(document.querySelector('form')!);

			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Vehicle name should appear in header
			expect(screen.getByText('My Honda')).toBeTruthy();
		});

		it('hides the vehicle form after successful save', async () => {
			const savedVehicle = { id: 1, name: 'My Honda', make: 'Honda', model: 'Civic' };
			mockSaveVehicle.mockResolvedValue({ data: savedVehicle, error: null });

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			await fireEvent.click(
				screen.getByRole('button', { name: 'Add your vehicle to get started' })
			);
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Honda' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Honda' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Civic' } });
			await fireEvent.submit(document.querySelector('form')!);

			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Form fields should be gone
			expect(screen.queryByLabelText(/display name/i)).toBeNull();
		});
	});

	describe('AC #5 — vehicle ID persisted to localStorage', () => {
		it('saves vehicle ID to localStorage under VEHICLE_ID_STORAGE_KEY after save', async () => {
			const savedVehicle = { id: 42, name: 'My Honda', make: 'Honda', model: 'Civic' };
			mockSaveVehicle.mockResolvedValue({ data: savedVehicle, error: null });

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			await fireEvent.click(
				screen.getByRole('button', { name: 'Add your vehicle to get started' })
			);
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Honda' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Honda' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Civic' } });
			await fireEvent.submit(document.querySelector('form')!);

			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(localStorageMock.getItem('passanger_vehicle_id')).toBe('42');
		});

		it('shows vehicle display name in a heading element (AC #5)', async () => {
			const savedVehicle = { id: 1, name: 'Red Panda', make: 'Toyota', model: 'GR86' };
			mockSaveVehicle.mockResolvedValue({ data: savedVehicle, error: null });

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			await fireEvent.click(
				screen.getByRole('button', { name: 'Add your vehicle to get started' })
			);
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'Red Panda' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Toyota' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'GR86' } });
			await fireEvent.submit(document.querySelector('form')!);

			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const heading = screen.getByRole('heading', { name: 'Red Panda' });
			expect(heading).toBeTruthy();
		});
	});

	describe('AC #6 — reopen loads persisted vehicle', () => {
		it('loads existing vehicle from localStorage on mount and shows fuel entry view', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({
				data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
				error: null
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByText('Old Faithful')).toBeTruthy();
			// Empty state CTA should NOT be visible
			expect(screen.queryByRole('button', { name: 'Add your vehicle to get started' })).toBeNull();
		});

		it('calls getVehicleById with the stored ID on mount', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({
				data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
				error: null
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));

			expect(mockGetVehicleById).toHaveBeenCalledWith(7);
		});

		it('shows empty state if stored vehicle ID resolves to NOT_FOUND error', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '99');
			mockGetVehicleById.mockResolvedValue({
				data: null,
				error: { code: 'NOT_FOUND', message: 'Vehicle not found' }
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByRole('button', { name: 'Add your vehicle to get started' })).toBeTruthy();
		});

		it('does NOT flash empty state while loading a persisted vehicle', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			let resolveFetch!: (v: unknown) => void;
			mockGetVehicleById.mockReturnValue(new Promise((r) => (resolveFetch = r)));

			render(FuelEntryPage);
			// Before fetch resolves, empty state must NOT appear
			expect(screen.queryByRole('button', { name: 'Add your vehicle to get started' })).toBeNull();
			expect(screen.queryByRole('button', { name: 'Add your vehicle to get started' })).toBeNull();

			resolveFetch({
				data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
				error: null
			});
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByText('Old Faithful')).toBeTruthy();
		});

		it('clears stale ID from localStorage when vehicle not found', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '99');
			mockGetVehicleById.mockResolvedValue({
				data: null,
				error: { code: 'NOT_FOUND', message: 'Vehicle not found' }
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(localStorageMock.getItem('passanger_vehicle_id')).toBeNull();
		});
	});

	describe('malformed persisted IDs', () => {
		it('shows empty state when stored ID is NaN (e.g. "abc")', async () => {
			localStorageMock.setItem('passanger_vehicle_id', 'abc');

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByRole('button', { name: 'Add your vehicle to get started' })).toBeTruthy();
			expect(mockGetVehicleById).not.toHaveBeenCalled();
		});

		it('clears malformed ID from localStorage', async () => {
			localStorageMock.setItem('passanger_vehicle_id', 'abc');

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(localStorageMock.getItem('passanger_vehicle_id')).toBeNull();
		});

		it('rejects numeric-prefix malformed ID "7abc" — does not call getVehicleById', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7abc');

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByRole('button', { name: 'Add your vehicle to get started' })).toBeTruthy();
			expect(mockGetVehicleById).not.toHaveBeenCalled();
			expect(localStorageMock.getItem('passanger_vehicle_id')).toBeNull();
		});

		it('rejects decimal-format stored ID "7.5" — does not call getVehicleById', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7.5');

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByRole('button', { name: 'Add your vehicle to get started' })).toBeTruthy();
			expect(mockGetVehicleById).not.toHaveBeenCalled();
			expect(localStorageMock.getItem('passanger_vehicle_id')).toBeNull();
		});

		it('rejects zero stored ID "0" — does not call getVehicleById', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '0');

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByRole('button', { name: 'Add your vehicle to get started' })).toBeTruthy();
			expect(mockGetVehicleById).not.toHaveBeenCalled();
			expect(localStorageMock.getItem('passanger_vehicle_id')).toBeNull();
		});
	});

	describe('transient DB error handling', () => {
		it('keeps stored vehicle ID when getVehicleById returns GET_FAILED (transient error)', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({
				data: null,
				error: { code: 'GET_FAILED', message: 'IndexedDB unavailable' }
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Stored ID must be preserved for next launch
			expect(localStorageMock.getItem('passanger_vehicle_id')).toBe('7');
		});

		it('shows error state (not empty state) on GET_FAILED without crashing', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({
				data: null,
				error: { code: 'GET_FAILED', message: 'IndexedDB unavailable' }
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Must show an error alert, not the empty onboarding CTA
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/could not load your vehicle/i)).toBeTruthy();
		});

		it('does not show Add Vehicle CTA on GET_FAILED (prevents duplicate vehicle creation)', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({
				data: null,
				error: { code: 'GET_FAILED', message: 'IndexedDB unavailable' }
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Must NOT show the onboarding empty state CTA
			expect(screen.queryByRole('button', { name: 'Add your vehicle to get started' })).toBeNull();
			expect(screen.queryByRole('button', { name: 'Add your vehicle to get started' })).toBeNull();
		});

		it('shows Export My Data CTA link to /export on GET_FAILED (architecture requirement)', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({
				data: null,
				error: { code: 'GET_FAILED', message: 'IndexedDB unavailable' }
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			const exportLink = screen.getByRole('link', { name: /export my data/i });
			expect(exportLink).toBeTruthy();
			expect(exportLink.getAttribute('href')).toBe('/export');
		});
	});

	describe('localStorage SecurityError handling', () => {
		it('shows empty state when localStorage.getItem throws', async () => {
			// Temporarily override localStorage to throw
			const origGetItem = localStorageMock.getItem;
			localStorageMock.getItem = () => {
				throw new DOMException('Blocked', 'SecurityError');
			};

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Should show empty state (not try recovery)
			expect(screen.getByText('No vehicle yet')).toBeTruthy();
			expect(mockGetVehicleById).not.toHaveBeenCalled();

			// Restore
			localStorageMock.getItem = origGetItem;
		});

		it('still saves vehicle in UI even if localStorage.setItem throws', async () => {
			const origSetItem = localStorageMock.setItem;
			localStorageMock.setItem = () => {
				throw new DOMException('Blocked', 'SecurityError');
			};

			const savedVehicle = { id: 1, name: 'My Honda', make: 'Honda', model: 'Civic' };
			mockSaveVehicle.mockResolvedValue({ data: savedVehicle, error: null });

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			await fireEvent.click(
				screen.getByRole('button', { name: 'Add your vehicle to get started' })
			);
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Honda' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Honda' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Civic' } });
			await fireEvent.submit(document.querySelector('form')!);

			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Vehicle should still display even though localStorage failed
			expect(screen.getByText('My Honda')).toBeTruthy();

			// Restore
			localStorageMock.setItem = origSetItem;
		});
	});
	describe('recovery path when VEHICLE_ID_STORAGE_KEY is missing but vehicle exists in IndexedDB', () => {
		it('recovers and loads first vehicle when stored key is missing but vehicle exists in DB', async () => {
			// No stored key, but vehicle exists in DB
			const existingVehicle = { id: 1, name: 'Recovered Vehicle', make: 'Toyota', model: 'Camry' };
			mockGetAllVehicles.mockResolvedValue({
				data: [existingVehicle],
				error: null
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Should show the recovered vehicle, not the empty state
			expect(screen.getByText('Recovered Vehicle')).toBeTruthy();
			expect(screen.queryByRole('button', { name: 'Add your vehicle to get started' })).toBeNull();
		});

		it('persists recovered vehicle ID to localStorage', async () => {
			const existingVehicle = { id: 5, name: 'Recovered Vehicle', make: 'Honda', model: 'Civic' };
			mockGetAllVehicles.mockResolvedValue({
				data: [existingVehicle],
				error: null
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Vehicle ID should be persisted
			expect(localStorageMock.getItem('passanger_vehicle_id')).toBe('5');
		});

		it('shows empty state when no stored key and no vehicles exist in DB', async () => {
			mockGetAllVehicles.mockResolvedValue({
				data: [],
				error: null
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Should show empty state
			expect(screen.getByRole('button', { name: 'Add your vehicle to get started' })).toBeTruthy();
		});

		it('shows error state when recovery GET_FAILED', async () => {
			mockGetAllVehicles.mockResolvedValue({
				data: null,
				error: { code: 'GET_FAILED', message: 'IndexedDB unavailable' }
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Should show error state, not empty state
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/could not load your vehicle/i)).toBeTruthy();
			expect(screen.queryByRole('button', { name: 'Add your vehicle to get started' })).toBeNull();
		});

		it('shows error state when recovery returns any non-null error', async () => {
			mockGetAllVehicles.mockResolvedValue({
				data: null,
				error: { code: 'SAVE_FAILED', message: 'Unexpected repository error' }
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/could not load your vehicle/i)).toBeTruthy();
			expect(screen.queryByRole('button', { name: 'Add your vehicle to get started' })).toBeNull();
		});

		it('uses first vehicle when multiple exist in DB', async () => {
			const vehicles = [
				{ id: 1, name: 'First Vehicle', make: 'Toyota', model: 'Camry' },
				{ id: 2, name: 'Second Vehicle', make: 'Honda', model: 'Civic' }
			];
			mockGetAllVehicles.mockResolvedValue({
				data: vehicles,
				error: null
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Should show first vehicle
			expect(screen.getByText('First Vehicle')).toBeTruthy();
			expect(screen.queryByText('Second Vehicle')).toBeNull();
		});
	});

	describe('Story 1.6: FuelEntryForm integration', () => {
		it('shows fuel entry form when vehicle exists (placeholder removed)', async () => {
			const savedVehicle = { id: 1, name: 'My Honda', make: 'Honda', model: 'Civic' };
			mockSaveVehicle.mockResolvedValue({ data: savedVehicle, error: null });

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Add vehicle
			await fireEvent.click(
				screen.getByRole('button', { name: 'Add your vehicle to get started' })
			);
			await fireEvent.input(screen.getByLabelText(/display name/i), {
				target: { value: 'My Honda' }
			});
			await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Honda' } });
			await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Civic' } });
			await fireEvent.submit(document.querySelector('form')!);

			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Fuel entry form should be visible (has odometer field)
			expect(screen.getByLabelText(/odometer/i)).toBeTruthy();
			expect(screen.getByLabelText(/quantity/i)).toBeTruthy();
			expect(screen.getByLabelText(/total cost/i)).toBeTruthy();

			// Old placeholder should be gone
			expect(screen.queryByText(/fuel entry form coming/i)).toBeNull();
		});

		it('shows fuel entry form alongside vehicle header', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '3');
			mockGetVehicleById.mockResolvedValue({
				data: { id: 3, name: 'My Civic', make: 'Honda', model: 'Civic', year: 2022 },
				error: null
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			// Vehicle name should be in heading
			expect(screen.getByRole('heading', { name: 'My Civic' })).toBeTruthy();

			// Fuel entry form should be visible
			expect(screen.getByLabelText(/odometer/i)).toBeTruthy();
		});
	});

	describe('Story 1.8: install prompt integration', () => {
		it('does not show the install prompt before the first successful fuel save', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({
				data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
				error: null
			});
			installPromptState.platform = 'ios';
			installPromptState.canShowPrompt = true;

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.queryByText(/keep passanger one tap away/i)).toBeNull();
		});

		it('shows the install prompt after the first successful fuel save when shell state allows it', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({
				data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
				error: null
			});
			installPromptState.platform = 'ios';
			installPromptState.canShowPrompt = true;
			mockSaveFuelLog.mockResolvedValue({
				data: {
					id: 1,
					vehicleId: 7,
					date: new Date('2026-03-11T10:00:00Z'),
					odometer: 87400,
					quantity: 42,
					unit: 'L',
					distanceUnit: 'km',
					totalCost: 78,
					calculatedConsumption: 0,
					notes: ''
				},
				error: null
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), {
				target: { value: '87400' }
			});
			await fireEvent.input(screen.getByLabelText(/quantity/i), { target: { value: '42' } });
			await fireEvent.input(screen.getByLabelText(/total cost/i), { target: { value: '78' } });
			await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByText(/keep passanger one tap away/i)).toBeTruthy();
			expect(screen.getByText(/tap the share icon/i)).toBeTruthy();
		});

		it('hides the prompt after dismissal and delegates suppression to shell context', async () => {
			localStorageMock.setItem('passanger_vehicle_id', '7');
			mockGetVehicleById.mockResolvedValue({
				data: { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang' },
				error: null
			});
			installPromptState.platform = 'ios';
			installPromptState.canShowPrompt = true;
			mockSaveFuelLog.mockResolvedValue({
				data: {
					id: 1,
					vehicleId: 7,
					date: new Date('2026-03-11T10:00:00Z'),
					odometer: 87400,
					quantity: 42,
					unit: 'L',
					distanceUnit: 'km',
					totalCost: 78,
					calculatedConsumption: 0,
					notes: ''
				},
				error: null
			});

			render(FuelEntryPage);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			await fireEvent.input(screen.getByLabelText(/odometer/i), {
				target: { value: '87400' }
			});
			await fireEvent.input(screen.getByLabelText(/quantity/i), { target: { value: '42' } });
			await fireEvent.input(screen.getByLabelText(/total cost/i), { target: { value: '78' } });
			await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
			flushSync();

			expect(mockDismissInstallPrompt).toHaveBeenCalledOnce();
			expect(screen.queryByText(/keep passanger one tap away/i)).toBeNull();
		});
	});
});
