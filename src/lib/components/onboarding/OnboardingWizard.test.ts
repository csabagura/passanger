import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
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
