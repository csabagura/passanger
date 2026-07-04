import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/svelte';
import OnboardingWizard from './OnboardingWizard.svelte';
import type { AppSettings } from '$lib/utils/settings';

const mockSaveVehicle = vi.fn();
const mockSaveServiceReminder = vi.fn();
const mockSaveSettings = vi.fn();

vi.mock('$lib/db/repositories/vehicles', () => ({
	saveVehicle: (...args: unknown[]) => mockSaveVehicle(...args)
}));
vi.mock('$lib/db/repositories/serviceReminders', () => ({
	saveServiceReminder: (...args: unknown[]) => mockSaveServiceReminder(...args)
}));
vi.mock('$lib/utils/settings', () => ({
	saveSettings: (...args: unknown[]) => mockSaveSettings(...args)
}));

const DEFAULT_SETTINGS: AppSettings = { fuelUnit: 'L/100km', currency: '€', theme: 'system' };
const VEHICLE = { id: 7, name: 'My Honda', make: 'Honda', model: 'Civic' };

function renderWizard(opts?: {
	settings?: AppSettings;
	onComplete?: () => void;
	onCancel?: () => void;
}) {
	const updateSettings = vi.fn();
	const settingsContext = {
		get settings() {
			return opts?.settings ?? DEFAULT_SETTINGS;
		},
		updateSettings
	};
	const result = render(OnboardingWizard, {
		props: { onComplete: opts?.onComplete ?? vi.fn(), onCancel: opts?.onCancel },
		context: new Map<string, unknown>([['settings', settingsContext]])
	});
	return { ...result, updateSettings };
}

async function fillStep1() {
	await fireEvent.input(screen.getByLabelText(/display name/i), { target: { value: 'My Honda' } });
	await fireEvent.input(screen.getByLabelText(/^make$/i), { target: { value: 'Honda' } });
	await fireEvent.input(screen.getByLabelText(/^model$/i), { target: { value: 'Civic' } });
}

beforeEach(() => {
	vi.clearAllMocks();
	mockSaveVehicle.mockResolvedValue({ data: VEHICLE });
	mockSaveServiceReminder.mockResolvedValue({ data: {} });
	mockSaveSettings.mockReturnValue({ data: { coercedFields: [] } });
});
afterEach(() => cleanup());

describe('OnboardingWizard — structure & navigation (AC1)', () => {
	it('opens on step 1 with the vehicle-basics fields and a step indicator', () => {
		renderWizard();
		expect(screen.getByText(/step 1 of 3/i)).toBeTruthy();
		expect(screen.getByLabelText(/display name/i)).toBeTruthy();
		expect(screen.getByLabelText(/^make$/i)).toBeTruthy();
		expect(screen.getByLabelText(/^model$/i)).toBeTruthy();
	});

	it('blocks Next while required fields are empty (stays on step 1 with errors)', async () => {
		renderWizard();
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		expect(screen.getByText(/step 1 of 3/i)).toBeTruthy();
		expect(screen.getByText(/enter a display name/i)).toBeTruthy();
	});

	it('advances 1 → 2 → 3 once step 1 is valid', async () => {
		renderWizard();
		await fillStep1();
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		expect(screen.getByText(/step 2 of 3/i)).toBeTruthy();
		expect(screen.getByText(/units & currency/i)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		expect(screen.getByText(/step 3 of 3/i)).toBeTruthy();
		expect(screen.getByLabelText(/starting odometer/i)).toBeTruthy();
	});

	it('Back returns to the previous step; Cancel on step 1 calls onCancel', async () => {
		const onCancel = vi.fn();
		renderWizard({ onCancel });
		await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
		expect(onCancel).toHaveBeenCalledOnce();
		await fillStep1();
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		await fireEvent.click(screen.getByRole('button', { name: /back/i }));
		expect(screen.getByText(/step 1 of 3/i)).toBeTruthy();
	});
});

describe('OnboardingWizard — measurement & currency map to global settings (AC2)', () => {
	it('pre-fills from current settings and does NOT write settings when unchanged', async () => {
		const { updateSettings } = renderWizard();
		await fillStep1();
		await fireEvent.click(screen.getByRole('button', { name: /next/i })); // step 2
		await fireEvent.click(screen.getByRole('button', { name: /next/i })); // step 3
		await fireEvent.click(screen.getByRole('button', { name: /finish/i }));
		await waitFor(() => expect(mockSaveVehicle).toHaveBeenCalled());
		expect(mockSaveSettings).not.toHaveBeenCalled();
		expect(updateSettings).not.toHaveBeenCalled();
	});

	it('persists fuelUnit + currency via saveSettings when the user changes them (MPG ⇒ mi)', async () => {
		const { updateSettings } = renderWizard();
		await fillStep1();
		await fireEvent.click(screen.getByRole('button', { name: /next/i })); // step 2
		await fireEvent.click(screen.getByRole('radio', { name: /miles per gallon/i }));
		await fireEvent.click(screen.getByRole('button', { name: /next/i })); // step 3
		await fireEvent.click(screen.getByRole('button', { name: /finish/i }));
		await waitFor(() => expect(mockSaveSettings).toHaveBeenCalled());
		expect(mockSaveSettings.mock.calls[0][0]).toMatchObject({ fuelUnit: 'MPG', currency: '€' });
		expect(updateSettings).toHaveBeenCalled();
	});
});

describe('OnboardingWizard — commit (AC3, AC4, AC5, AC7)', () => {
	it('creates the vehicle with trimmed fields and calls onComplete', async () => {
		const onComplete = vi.fn();
		renderWizard({ onComplete });
		await fillStep1();
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		await fireEvent.click(screen.getByRole('button', { name: /finish/i }));
		await waitFor(() => expect(onComplete).toHaveBeenCalledWith(VEHICLE));
		expect(mockSaveVehicle).toHaveBeenCalledWith({
			name: 'My Honda',
			make: 'Honda',
			model: 'Civic',
			year: undefined
		});
	});

	it('seeds a selected preset reminder with the odometer anchor + correct distanceUnit', async () => {
		renderWizard();
		await fillStep1();
		await fireEvent.click(screen.getByRole('button', { name: /next/i })); // step 2 (stays L/100km ⇒ km)
		await fireEvent.click(screen.getByRole('button', { name: /next/i })); // step 3
		await fireEvent.input(screen.getByLabelText(/starting odometer/i), {
			target: { value: '45000' }
		});
		await fireEvent.click(screen.getByRole('checkbox', { name: /oil change/i }));
		await fireEvent.click(screen.getByRole('button', { name: /finish/i }));
		await waitFor(() => expect(mockSaveServiceReminder).toHaveBeenCalledOnce());
		expect(mockSaveServiceReminder).toHaveBeenCalledWith({
			vehicleId: 7,
			title: 'Oil change',
			intervalKm: 10000,
			intervalDays: 365,
			distanceUnit: 'km',
			lastServiceOdometer: 45000
		});
	});

	it('seeds NO reminders when none are selected', async () => {
		const onComplete = vi.fn();
		renderWizard({ onComplete });
		await fillStep1();
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		await fireEvent.click(screen.getByRole('button', { name: /finish/i }));
		await waitFor(() => expect(onComplete).toHaveBeenCalled());
		expect(mockSaveServiceReminder).not.toHaveBeenCalled();
	});

	it('rejects a non-positive starting odometer and does not create the vehicle', async () => {
		renderWizard();
		await fillStep1();
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		await fireEvent.input(screen.getByLabelText(/starting odometer/i), { target: { value: '-5' } });
		await fireEvent.click(screen.getByRole('button', { name: /finish/i }));
		expect(screen.getByText(/enter a positive number/i)).toBeTruthy();
		expect(mockSaveVehicle).not.toHaveBeenCalled();
	});

	it('surfaces the MAX_VEHICLES error and does not complete', async () => {
		const onComplete = vi.fn();
		mockSaveVehicle.mockResolvedValue({ error: { code: 'MAX_VEHICLES', message: 'cap' } });
		renderWizard({ onComplete });
		await fillStep1();
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		await fireEvent.click(screen.getByRole('button', { name: /finish/i }));
		await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
		expect(screen.getByText(/maximum of 5 vehicles/i)).toBeTruthy();
		expect(onComplete).not.toHaveBeenCalled();
	});
});

describe('OnboardingWizard — review patches (2026-07-04)', () => {
	// P1: odometer parses through the shared parsePositiveNumeric (Task-4 mandate), so a locale
	// comma-decimal is accepted (raw Number() would have produced NaN and rejected it).
	it('P1: parses a comma-decimal odometer via the shared parser', async () => {
		renderWizard();
		await fillStep1();
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		await fireEvent.input(screen.getByLabelText(/starting odometer/i), {
			target: { value: '45000,5' }
		});
		await fireEvent.click(screen.getByRole('checkbox', { name: /oil change/i }));
		await fireEvent.click(screen.getByRole('button', { name: /finish/i }));
		await waitFor(() => expect(mockSaveServiceReminder).toHaveBeenCalled());
		expect(mockSaveServiceReminder.mock.calls[0][0].lastServiceOdometer).toBe(45000.5);
	});

	// P2: the custom-currency option list is computed once from the initial currency, so selecting a
	// preset must NOT drop the pre-existing custom option (it stays switch-back-able).
	it('P2: keeps a pre-existing custom currency selectable after picking a preset', async () => {
		renderWizard({ settings: { fuelUnit: 'L/100km', currency: 'kr', theme: 'system' } });
		await fillStep1();
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		const select = screen.getByLabelText(/currency/i) as HTMLSelectElement;
		expect(within(select).getByRole('option', { name: 'kr' })).toBeTruthy();
		await fireEvent.change(select, { target: { value: '€' } });
		// The custom option is still present — the list did not collapse on selection.
		expect(within(select).getByRole('option', { name: 'kr' })).toBeTruthy();
	});

	// P3: a corrected odometer clears the stale error immediately (not only on the next Finish).
	it('P3: clears a stale odometer error once the value is corrected', async () => {
		renderWizard();
		await fillStep1();
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		await fireEvent.click(screen.getByRole('button', { name: /next/i }));
		const odo = screen.getByLabelText(/starting odometer/i);
		await fireEvent.input(odo, { target: { value: '-5' } });
		await fireEvent.click(screen.getByRole('button', { name: /finish/i }));
		expect(screen.getByText(/enter a positive number/i)).toBeTruthy();
		await fireEvent.input(odo, { target: { value: '45000' } });
		expect(screen.queryByText(/enter a positive number/i)).toBeNull();
	});

	// D1: a failed reminder seed is no longer silent — a partial-failure notice is shown, and the
	// user still lands (onComplete fires after the brief failure-path delay).
	it('D1: surfaces a partial-failure notice when a reminder seed fails, then still lands', async () => {
		vi.useFakeTimers();
		try {
			const onComplete = vi.fn();
			mockSaveServiceReminder.mockResolvedValue({ error: { code: 'SAVE_FAILED', message: 'x' } });
			renderWizard({ onComplete });
			await fillStep1();
			await fireEvent.click(screen.getByRole('button', { name: /next/i }));
			await fireEvent.click(screen.getByRole('button', { name: /next/i }));
			await fireEvent.click(screen.getByRole('checkbox', { name: /oil change/i }));
			await fireEvent.click(screen.getByRole('button', { name: /finish/i }));
			// Flush the awaited writes and advance past the failure-path landing delay (3000ms) but
			// before the 4000ms toast auto-dismiss, so both the toast and the landing are observable.
			await vi.advanceTimersByTimeAsync(3000);
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/some setup couldn't be saved/i)).toBeTruthy();
			expect(onComplete).toHaveBeenCalledWith(VEHICLE);
		} finally {
			vi.useRealTimers();
		}
	});

	// D1: when the settings write fails, seeded reminders are stamped with the EFFECTIVE (old) unit,
	// never the attempted one — a failed MPG write must not stamp reminders 'mi' while the app is 'km'.
	it('D1: stamps reminders with the effective unit when the settings write fails', async () => {
		vi.useFakeTimers();
		try {
			mockSaveSettings.mockReturnValue({ error: { code: 'SAVE_FAILED', message: 'quota' } });
			renderWizard(); // starts L/100km ⇒ km
			await fillStep1();
			await fireEvent.click(screen.getByRole('button', { name: /next/i })); // step 2
			await fireEvent.click(screen.getByRole('radio', { name: /miles per gallon/i })); // choose MPG
			await fireEvent.click(screen.getByRole('button', { name: /next/i })); // step 3
			await fireEvent.click(screen.getByRole('checkbox', { name: /oil change/i }));
			await fireEvent.click(screen.getByRole('button', { name: /finish/i }));
			await vi.advanceTimersByTimeAsync(3000);
			expect(mockSaveServiceReminder).toHaveBeenCalledOnce();
			// The MPG settings write failed → app stays km → the reminder must be stamped 'km', not 'mi'.
			expect(mockSaveServiceReminder.mock.calls[0][0].distanceUnit).toBe('km');
		} finally {
			vi.useRealTimers();
		}
	});
});
