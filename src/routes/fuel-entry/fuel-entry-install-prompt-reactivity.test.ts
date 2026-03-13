import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import FuelEntryPageInstallPromptHarness from './FuelEntryPageInstallPromptHarness.test.svelte';

const mockGetVehicleById = vi.fn();
const mockGetAllVehicles = vi.fn();
const mockGetAllFuelLogs = vi.fn();
const mockSaveFuelLog = vi.fn();
const mockUpdateFuelLogsAtomic = vi.fn();

vi.mock('$lib/db/repositories/vehicles', () => ({
	getVehicleById: (...args: unknown[]) => mockGetVehicleById(...args),
	getAllVehicles: (...args: unknown[]) => mockGetAllVehicles(...args)
}));

vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: (...args: unknown[]) => mockGetAllFuelLogs(...args),
	saveFuelLog: (...args: unknown[]) => mockSaveFuelLog(...args),
	updateFuelLogsAtomic: (...args: unknown[]) => mockUpdateFuelLogsAtomic(...args)
}));

vi.mock('$app/paths', () => ({
	resolve: (href: string) => href
}));

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

Object.defineProperty(globalThis, 'localStorage', {
	value: localStorageMock,
	writable: true
});

const savedVehicle = {
	id: 7,
	name: 'Old Faithful',
	make: 'Ford',
	model: 'Mustang'
};

const firstFuelLog = {
	id: 1,
	vehicleId: 7,
	date: new Date('2026-03-11T10:00:00Z'),
	odometer: 87400,
	quantity: 42,
	unit: 'L' as const,
	distanceUnit: 'km' as const,
	totalCost: 78,
	calculatedConsumption: 0,
	notes: ''
};

async function settleUi() {
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

async function saveFirstFuelEntry() {
	await fireEvent.input(screen.getByLabelText(/odometer/i), {
		target: { value: '87400' }
	});
	await fireEvent.input(screen.getByLabelText(/quantity/i), { target: { value: '42' } });
	await fireEvent.input(screen.getByLabelText(/total cost/i), { target: { value: '78' } });
	await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
	await settleUi();
}

describe('FuelEntry page install prompt reactivity', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
		localStorageMock.setItem('passanger_vehicle_id', '7');
		mockGetVehicleById.mockResolvedValue({ data: savedVehicle, error: null });
		mockGetAllVehicles.mockResolvedValue({ data: [], error: null });
		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockSaveFuelLog.mockResolvedValue({ data: firstFuelLog, error: null });
		mockUpdateFuelLogsAtomic.mockResolvedValue({ data: [], error: null });
	});

	afterEach(() => {
		cleanup();
	});

	it('shows the Android prompt after late installability capture without requiring a second save', async () => {
		const requestInstall = vi.fn().mockResolvedValue('accepted');
		const view = render(FuelEntryPageInstallPromptHarness, {
			props: {
				platform: 'android',
				canShowPrompt: false,
				canTriggerNativeInstall: false,
				onRequestInstall: requestInstall
			}
		});

		await settleUi();
		await saveFirstFuelEntry();

		expect(screen.queryByText(/keep passanger one tap away/i)).toBeNull();
		expect(mockSaveFuelLog).toHaveBeenCalledTimes(1);

		await view.rerender({
			platform: 'android',
			canShowPrompt: true,
			canTriggerNativeInstall: true,
			onRequestInstall: requestInstall
		});
		await settleUi();

		expect(screen.getByText(/keep passanger one tap away/i)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy();
		expect(mockSaveFuelLog).toHaveBeenCalledTimes(1);
	});

	it('uses the Android install CTA through the real page flow', async () => {
		const requestInstall = vi.fn().mockResolvedValue('accepted');
		const view = render(FuelEntryPageInstallPromptHarness, {
			props: {
				platform: 'android',
				canShowPrompt: true,
				canTriggerNativeInstall: true,
				onRequestInstall: requestInstall
			}
		});

		await settleUi();
		await saveFirstFuelEntry();

		await fireEvent.click(screen.getByRole('button', { name: 'Install' }));
		await Promise.resolve();

		expect(requestInstall).toHaveBeenCalledOnce();

		await view.rerender({
			platform: 'android',
			isDismissed: true,
			canShowPrompt: false,
			canTriggerNativeInstall: false,
			onRequestInstall: requestInstall
		});
		await settleUi();

		expect(screen.queryByText(/keep passanger one tap away/i)).toBeNull();
	});
});
