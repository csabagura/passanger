import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import LogPage from './+page.svelte';

vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: vi.fn().mockResolvedValue({ data: [], error: null }),
	saveFuelLog: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
	getTimelineNeighbors: vi.fn().mockResolvedValue({
		data: { before: null, after: null },
		error: null
	})
}));

vi.mock('$lib/db/repositories/expenses', () => ({
	getAllExpenses: vi.fn().mockResolvedValue({ data: [], error: null }),
	saveExpense: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null })
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

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const testVehicle = { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang', year: 2016 };

const installPromptCtx = {
	platform: 'unsupported' as const,
	isStandalone: false,
	isDismissed: false,
	canShowPrompt: false,
	canTriggerNativeInstall: false,
	dismissPrompt: vi.fn(),
	requestInstall: vi.fn().mockResolvedValue('unavailable' as const)
};

function makeVehiclesContext(activeVehicle: typeof testVehicle | null = null) {
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
			return true;
		},
		switchVehicle: vi.fn(),
		refreshVehicles: vi.fn().mockResolvedValue(undefined)
	};
}

function renderPage(activeVehicle: typeof testVehicle | null = null) {
	const contextMap = new Map<string, unknown>();
	contextMap.set('installPrompt', installPromptCtx);
	contextMap.set('settings', {
		get settings() {
			return { fuelUnit: 'L/100km' as const, currency: '€' };
		},
		updateSettings: vi.fn()
	});
	contextMap.set('vehicles', makeVehiclesContext(activeVehicle));

	return render(LogPage, {
		context: contextMap
	});
}

describe('Log page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
	});

	afterEach(() => {
		cleanup();
	});

	it('shows vehicle onboarding when no vehicle exists', async () => {
		renderPage(null);
		await waitFor(() => {
			expect(screen.getByText('No vehicle yet')).toBeTruthy();
		});
		expect(screen.getByRole('button', { name: /Add your vehicle/ })).toBeTruthy();
	});

	it('shows segmented switch with Fuel and Service modes when vehicle exists', async () => {
		renderPage(testVehicle);
		await waitFor(() => {
			expect(screen.getByRole('radiogroup', { name: 'Log mode' })).toBeTruthy();
		});

		const fuelRadio = screen.getByRole('radio', { name: 'Fuel' });
		const serviceRadio = screen.getByRole('radio', { name: 'Service' });
		expect(fuelRadio.getAttribute('aria-checked')).toBe('true');
		expect(serviceRadio.getAttribute('aria-checked')).toBe('false');
	});

	it('switches between Fuel and Service modes', async () => {
		renderPage(testVehicle);
		await waitFor(() => {
			expect(screen.getByRole('radio', { name: 'Service' })).toBeTruthy();
		});

		await fireEvent.click(screen.getByRole('radio', { name: 'Service' }));

		expect(screen.getByRole('radio', { name: 'Service' }).getAttribute('aria-checked')).toBe(
			'true'
		);
		expect(screen.getByRole('radio', { name: 'Fuel' }).getAttribute('aria-checked')).toBe('false');
	});

	it('supports keyboard navigation between modes', async () => {
		renderPage(testVehicle);
		await waitFor(() => {
			expect(screen.getByRole('radiogroup', { name: 'Log mode' })).toBeTruthy();
		});

		const radiogroup = screen.getByRole('radiogroup', { name: 'Log mode' });
		await fireEvent.keyDown(radiogroup, { key: 'ArrowRight' });

		expect(screen.getByRole('radio', { name: 'Service' }).getAttribute('aria-checked')).toBe(
			'true'
		);
	});

	it('does not show onboarding survey before first save', async () => {
		renderPage(testVehicle);
		await waitFor(() => {
			expect(screen.getByRole('radiogroup', { name: 'Log mode' })).toBeTruthy();
		});

		expect(screen.queryByRole('complementary', { name: /onboarding survey/i })).toBeNull();
	});

	it('does not show onboarding survey when install prompt is eligible', async () => {
		installPromptCtx.canShowPrompt = true;
		installPromptCtx.platform = 'android';
		installPromptCtx.canTriggerNativeInstall = true;

		renderPage(testVehicle);
		await waitFor(() => {
			expect(screen.getByRole('radiogroup', { name: 'Log mode' })).toBeTruthy();
		});

		expect(screen.queryByRole('complementary', { name: /onboarding survey/i })).toBeNull();

		installPromptCtx.canShowPrompt = false;
		installPromptCtx.platform = 'unsupported';
		installPromptCtx.canTriggerNativeInstall = false;
	});

	it('does not show onboarding survey after it has been completed', async () => {
		localStorageMock.setItem(
			'passanger_onboarding_survey',
			JSON.stringify({ completed: true, dismissed: false, response: 'track-costs' })
		);

		renderPage(testVehicle);
		await waitFor(() => {
			expect(screen.getByRole('radiogroup', { name: 'Log mode' })).toBeTruthy();
		});

		expect(screen.queryByRole('complementary', { name: /onboarding survey/i })).toBeNull();
	});

	it('does not show onboarding survey after it has been dismissed', async () => {
		localStorageMock.setItem(
			'passanger_onboarding_survey',
			JSON.stringify({ completed: false, dismissed: true })
		);

		renderPage(testVehicle);
		await waitFor(() => {
			expect(screen.getByRole('radiogroup', { name: 'Log mode' })).toBeTruthy();
		});

		expect(screen.queryByRole('complementary', { name: /onboarding survey/i })).toBeNull();
	});

	it('does not show survey immediately after install prompt dismiss — waits for next save', async () => {
		installPromptCtx.canShowPrompt = true;
		installPromptCtx.platform = 'android';
		installPromptCtx.canTriggerNativeInstall = true;

		renderPage(testVehicle);
		await waitFor(() => {
			expect(screen.getByRole('radiogroup', { name: 'Log mode' })).toBeTruthy();
		});

		expect(screen.queryByRole('complementary', { name: /onboarding survey/i })).toBeNull();

		installPromptCtx.canShowPrompt = false;
		installPromptCtx.platform = 'unsupported';
		installPromptCtx.canTriggerNativeInstall = false;
	});
});
