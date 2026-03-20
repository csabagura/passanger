import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import VehicleListManager from './VehicleListManager.svelte';
import type { Vehicle } from '$lib/db/schema';
import { MAX_VEHICLES } from '$lib/config';

const mockGetAllVehicles = vi.fn();
const mockDeleteVehicle = vi.fn();
const mockGetVehicleCount = vi.fn();
const mockSaveVehicle = vi.fn();
const mockUpdateVehicle = vi.fn();

vi.mock('$lib/db/repositories/vehicles', () => ({
	getAllVehicles: () => mockGetAllVehicles(),
	deleteVehicle: (...args: unknown[]) => mockDeleteVehicle(...args),
	getVehicleCount: () => mockGetVehicleCount(),
	saveVehicle: (...args: unknown[]) => mockSaveVehicle(...args),
	updateVehicle: (...args: unknown[]) => mockUpdateVehicle(...args)
}));

const mockSafeSetItem = vi.fn();
const mockSafeRemoveItem = vi.fn();
const mockReadStoredVehicleId = vi.fn();

vi.mock('$lib/utils/vehicleStorage', () => ({
	safeSetItem: (...args: unknown[]) => mockSafeSetItem(...args),
	safeRemoveItem: (...args: unknown[]) => mockSafeRemoveItem(...args),
	readStoredVehicleId: () => mockReadStoredVehicleId()
}));

function makeVehicle(overrides: Partial<Vehicle> & { id: number; name: string }): Vehicle {
	return { make: 'Make', model: 'Model', ...overrides };
}

const vehicle1: Vehicle = makeVehicle({ id: 1, name: 'My Honda', make: 'Honda', model: 'Civic', year: 2019 });
const vehicle2: Vehicle = makeVehicle({ id: 2, name: 'Work Van', make: 'Ford', model: 'Transit', year: 2021 });

function setupMocks(vehicles: Vehicle[] = [vehicle1, vehicle2]) {
	mockGetAllVehicles.mockResolvedValue({ data: vehicles, error: null });
	mockGetVehicleCount.mockResolvedValue({ data: vehicles.length, error: null });
}

async function renderAndWait(props: Record<string, unknown> = {}) {
	setupMocks(props._vehicles as Vehicle[] | undefined);
	delete props._vehicles;
	render(VehicleListManager, props);
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}

describe('VehicleListManager', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	describe('list view — rendering', () => {
		it('renders all vehicles with name, make, model, and year', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			expect(screen.getByText('My Honda')).toBeTruthy();
			expect(screen.getByText(/Honda Civic · 2019/)).toBeTruthy();
			expect(screen.getByText('Work Van')).toBeTruthy();
			expect(screen.getByText(/Ford Transit · 2021/)).toBeTruthy();
		});

		it('renders vehicle list as a semantic list', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			const list = screen.getByRole('list', { name: /vehicle list/i });
			expect(list).toBeTruthy();
			const items = within(list).getAllByRole('listitem');
			expect(items).toHaveLength(2);
		});

		it('renders Edit and Delete buttons for each vehicle', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			expect(screen.getByRole('button', { name: /edit my honda/i })).toBeTruthy();
			expect(screen.getByRole('button', { name: /delete my honda/i })).toBeTruthy();
			expect(screen.getByRole('button', { name: /edit work van/i })).toBeTruthy();
			expect(screen.getByRole('button', { name: /delete work van/i })).toBeTruthy();
		});

		it('shows vehicle count out of MAX_VEHICLES', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			expect(screen.getByText(`2 of ${MAX_VEHICLES} vehicles`)).toBeTruthy();
		});

		it('shows Add vehicle button when under limit', async () => {
			await renderAndWait({ _vehicles: [vehicle1] });
			expect(screen.getByRole('button', { name: /add vehicle/i })).toBeTruthy();
		});

		it('does not show vehicle without year with separator', async () => {
			const noYearVehicle = makeVehicle({ id: 3, name: 'No Year Car', make: 'Toyota', model: 'Yaris' });
			await renderAndWait({ _vehicles: [noYearVehicle] });
			expect(screen.getByText(/Toyota Yaris/)).toBeTruthy();
			expect(screen.queryByText(/Toyota Yaris ·/)).toBeNull();
		});
	});

	describe('active vehicle indicator', () => {
		it('shows active indicator on the currently active vehicle', async () => {
			await renderAndWait({ activeVehicleId: 1, _vehicles: [vehicle1, vehicle2] });
			const items = screen.getAllByRole('listitem');
			const activeItem = items.find((item) => item.getAttribute('aria-current') === 'true');
			expect(activeItem).toBeTruthy();
			expect(within(activeItem!).getByText('My Honda')).toBeTruthy();
			expect(within(activeItem!).getByText('Active')).toBeTruthy();
		});

		it('does not show active indicator on non-active vehicles', async () => {
			await renderAndWait({ activeVehicleId: 1, _vehicles: [vehicle1, vehicle2] });
			const items = screen.getAllByRole('listitem');
			const nonActiveItem = items.find((item) => item.getAttribute('aria-current') !== 'true');
			expect(nonActiveItem).toBeTruthy();
			expect(within(nonActiveItem!).queryByText('Active')).toBeNull();
		});
	});

	describe('empty state', () => {
		it('shows CTA to add first vehicle when no vehicles', async () => {
			await renderAndWait({ _vehicles: [] });
			expect(screen.getByText(/no vehicles yet/i)).toBeTruthy();
			expect(screen.getByRole('button', { name: /add vehicle/i })).toBeTruthy();
		});
	});

	describe('MAX_VEHICLES limit', () => {
		it('shows limit message and hides add button at MAX_VEHICLES', async () => {
			const maxVehicles = Array.from({ length: MAX_VEHICLES }, (_, i) =>
				makeVehicle({ id: i + 1, name: `Car ${i + 1}` })
			);
			await renderAndWait({ _vehicles: maxVehicles });
			expect(screen.getByText(/maximum 5 vehicles reached/i)).toBeTruthy();
			// The add vehicle button should not be present (only limit message)
			const buttons = screen.getAllByRole('button');
			const addBtn = buttons.find((b) => b.textContent?.includes('Add vehicle'));
			expect(addBtn).toBeUndefined();
		});
	});

	describe('create flow', () => {
		it('switches to create view when Add vehicle is clicked', async () => {
			await renderAndWait({ _vehicles: [vehicle1] });
			await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));
			flushSync();
			// VehicleForm should now be rendered (has heading "Add Vehicle")
			expect(screen.getByRole('heading', { name: /add vehicle/i })).toBeTruthy();
		});

		it('switches to create view from empty state CTA', async () => {
			await renderAndWait({ _vehicles: [] });
			await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));
			flushSync();
			expect(screen.getByRole('heading', { name: /add vehicle/i })).toBeTruthy();
		});
	});

	describe('edit flow', () => {
		it('switches to edit view when Edit is clicked', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			await fireEvent.click(screen.getByRole('button', { name: /edit my honda/i }));
			flushSync();
			expect(screen.getByRole('heading', { name: /edit vehicle/i })).toBeTruthy();
			// Fields should be pre-filled
			expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe('My Honda');
		});
	});

	describe('delete flow', () => {
		it('shows confirmation dialog when Delete is clicked', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			await fireEvent.click(screen.getByRole('button', { name: /delete my honda/i }));
			flushSync();
			expect(screen.getByText(/delete my honda\?/i)).toBeTruthy();
			expect(screen.getByText(/entries linked to this vehicle will remain/i)).toBeTruthy();
		});

		it('hides confirmation dialog when Cancel is clicked', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			await fireEvent.click(screen.getByRole('button', { name: /delete my honda/i }));
			flushSync();
			// Click cancel in the confirmation panel
			const cancelBtns = screen.getAllByRole('button', { name: /cancel/i });
			await fireEvent.click(cancelBtns[0]);
			flushSync();
			expect(screen.queryByText(/delete my honda\?/i)).toBeNull();
		});

		it('calls deleteVehicle and removes vehicle from list on confirm', async () => {
			mockDeleteVehicle.mockResolvedValue({ data: undefined, error: null });
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });

			await fireEvent.click(screen.getByRole('button', { name: /delete my honda/i }));
			flushSync();

			// After confirming, the mock will resolve and loadVehicles will be called again
			mockGetAllVehicles.mockResolvedValueOnce({ data: [vehicle2], error: null });

			await fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockDeleteVehicle).toHaveBeenCalledWith(1);
			expect(screen.queryByText('My Honda')).toBeNull();
			expect(screen.getByText('Work Van')).toBeTruthy();
		});
	});

	describe('active vehicle deletion fallback (AC: 6)', () => {
		it('sets first remaining vehicle as active when active vehicle is deleted', async () => {
			mockDeleteVehicle.mockResolvedValue({ data: undefined, error: null });
			const mockOnChange = vi.fn();
			await renderAndWait({
				activeVehicleId: 1,
				onActiveVehicleChange: mockOnChange,
				_vehicles: [vehicle1, vehicle2]
			});

			await fireEvent.click(screen.getByRole('button', { name: /delete my honda/i }));
			flushSync();

			mockGetAllVehicles.mockResolvedValueOnce({ data: [vehicle2], error: null });

			await fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockSafeSetItem).toHaveBeenCalledWith('passanger_vehicle_id', '2');
			expect(mockOnChange).toHaveBeenCalledWith(2);
		});

		it('clears active vehicle when last vehicle is deleted', async () => {
			mockDeleteVehicle.mockResolvedValue({ data: undefined, error: null });
			const mockOnChange = vi.fn();
			await renderAndWait({
				activeVehicleId: 1,
				onActiveVehicleChange: mockOnChange,
				_vehicles: [vehicle1]
			});

			await fireEvent.click(screen.getByRole('button', { name: /delete my honda/i }));
			flushSync();

			mockGetAllVehicles.mockResolvedValueOnce({ data: [], error: null });

			await fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockSafeRemoveItem).toHaveBeenCalledWith('passanger_vehicle_id');
			expect(mockOnChange).toHaveBeenCalledWith(null);
		});

		it('does not change active vehicle when non-active vehicle is deleted', async () => {
			mockDeleteVehicle.mockResolvedValue({ data: undefined, error: null });
			const mockOnChange = vi.fn();
			await renderAndWait({
				activeVehicleId: 1,
				onActiveVehicleChange: mockOnChange,
				_vehicles: [vehicle1, vehicle2]
			});

			await fireEvent.click(screen.getByRole('button', { name: /delete work van/i }));
			flushSync();

			mockGetAllVehicles.mockResolvedValueOnce({ data: [vehicle1], error: null });

			await fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockSafeSetItem).not.toHaveBeenCalled();
			expect(mockSafeRemoveItem).not.toHaveBeenCalled();
			expect(mockOnChange).not.toHaveBeenCalled();
		});
	});

	describe('load error state', () => {
		it('renders error message when getAllVehicles returns an error', async () => {
			mockGetAllVehicles.mockResolvedValue({ data: null, error: { code: 'UNKNOWN', message: 'DB error' } });
			render(VehicleListManager);
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/could not load vehicles/i)).toBeTruthy();
		});
	});

	describe('delete confirmation accessibility', () => {
		it('renders delete confirmation with role="alertdialog" and aria-labelledby', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			await fireEvent.click(screen.getByRole('button', { name: /delete my honda/i }));
			flushSync();
			const dialog = screen.getByRole('alertdialog');
			expect(dialog).toBeTruthy();
			expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
			const labelId = dialog.getAttribute('aria-labelledby')!;
			const label = document.getElementById(labelId);
			expect(label).toBeTruthy();
			expect(label!.textContent).toContain('Delete My Honda?');
		});
	});

	describe('delete state reset on mode switch', () => {
		it('resets armed delete state when switching to create mode', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			// Arm delete
			await fireEvent.click(screen.getByRole('button', { name: /delete my honda/i }));
			flushSync();
			expect(screen.getByRole('alertdialog')).toBeTruthy();

			// Switch to create mode
			await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));
			flushSync();
			expect(screen.getByRole('heading', { name: /add vehicle/i })).toBeTruthy();

			// Cancel back to list — confirmation should not reappear
			await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
			flushSync();
			expect(screen.queryByRole('alertdialog')).toBeNull();
		});

		it('resets armed delete state when switching to edit mode', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			// Arm delete on vehicle 1
			await fireEvent.click(screen.getByRole('button', { name: /delete my honda/i }));
			flushSync();
			expect(screen.getByRole('alertdialog')).toBeTruthy();

			// Switch to edit mode on vehicle 2
			await fireEvent.click(screen.getByRole('button', { name: /edit work van/i }));
			flushSync();
			expect(screen.getByRole('heading', { name: /edit vehicle/i })).toBeTruthy();

			// Cancel back to list — confirmation should not reappear
			await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
			flushSync();
			expect(screen.queryByRole('alertdialog')).toBeNull();
		});
	});

	describe('single vehicle user (AC: 7)', () => {
		it('works identically with one vehicle — shows list, edit, delete', async () => {
			await renderAndWait({ activeVehicleId: 1, _vehicles: [vehicle1] });
			expect(screen.getByText('My Honda')).toBeTruthy();
			expect(screen.getByRole('button', { name: /edit my honda/i })).toBeTruthy();
			expect(screen.getByRole('button', { name: /delete my honda/i })).toBeTruthy();
			expect(screen.getByRole('button', { name: /add vehicle/i })).toBeTruthy();
			expect(screen.getByText(`1 of ${MAX_VEHICLES} vehicles`)).toBeTruthy();
		});
	});
});
