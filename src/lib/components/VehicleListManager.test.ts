import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import VehicleListManager from './VehicleListManager.svelte';
import type { Vehicle } from '$lib/db/schema';
import { MAX_VEHICLES } from '$lib/config';

const mockGetAllVehicles = vi.fn();
const mockGetArchivedVehicles = vi.fn();
const mockArchiveVehicle = vi.fn();
const mockRestoreVehicle = vi.fn();
const mockDeleteVehicle = vi.fn();
const mockSaveVehicle = vi.fn();
const mockUpdateVehicle = vi.fn();

vi.mock('$lib/db/repositories/vehicles', () => ({
	getAllVehicles: () => mockGetAllVehicles(),
	getArchivedVehicles: () => mockGetArchivedVehicles(),
	archiveVehicle: (...args: unknown[]) => mockArchiveVehicle(...args),
	restoreVehicle: (...args: unknown[]) => mockRestoreVehicle(...args),
	deleteVehicle: (...args: unknown[]) => mockDeleteVehicle(...args),
	saveVehicle: (...args: unknown[]) => mockSaveVehicle(...args),
	updateVehicle: (...args: unknown[]) => mockUpdateVehicle(...args)
}));

const mockSwitchVehicle = vi.fn();
const mockRefreshVehicles = vi.fn().mockResolvedValue(undefined);

function vehiclesContext() {
	return {
		vehicles: [],
		activeVehicle: null,
		activeVehicleId: null,
		loaded: true,
		vehiclesError: false,
		switchVehicle: mockSwitchVehicle,
		refreshVehicles: mockRefreshVehicles
	};
}

function makeVehicle(overrides: Partial<Vehicle> & { id: number; name: string }): Vehicle {
	return { make: 'Make', model: 'Model', ...overrides };
}

const vehicle1: Vehicle = makeVehicle({
	id: 1,
	name: 'My Honda',
	make: 'Honda',
	model: 'Civic',
	year: 2019
});
const vehicle2: Vehicle = makeVehicle({
	id: 2,
	name: 'Work Van',
	make: 'Ford',
	model: 'Transit',
	year: 2021
});
const archivedVehicle: Vehicle = makeVehicle({
	id: 9,
	name: 'Old Ranger',
	make: 'Ford',
	model: 'Ranger',
	year: 2008,
	isArchived: true,
	archivedAt: 1000
});

function setupMocks(vehicles: Vehicle[] = [vehicle1, vehicle2], archived: Vehicle[] = []) {
	mockGetAllVehicles.mockResolvedValue({ data: vehicles, error: null });
	mockGetArchivedVehicles.mockResolvedValue({ data: archived, error: null });
}

async function renderAndWait(props: Record<string, unknown> = {}) {
	setupMocks(props._vehicles as Vehicle[] | undefined, props._archived as Vehicle[] | undefined);
	delete props._vehicles;
	delete props._archived;
	const context = new Map<string, unknown>();
	context.set('vehicles', vehiclesContext());
	render(VehicleListManager, { props, context });
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

		it('renders Edit and Archive buttons for each vehicle', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			expect(screen.getByRole('button', { name: /edit my honda/i })).toBeTruthy();
			expect(screen.getByRole('button', { name: /archive my honda/i })).toBeTruthy();
			expect(screen.getByRole('button', { name: /edit work van/i })).toBeTruthy();
			expect(screen.getByRole('button', { name: /archive work van/i })).toBeTruthy();
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
			const noYearVehicle = makeVehicle({
				id: 3,
				name: 'No Year Car',
				make: 'Toyota',
				model: 'Yaris'
			});
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
			// Copy now nudges toward archiving, not deleting.
			expect(screen.getByText(/archive a vehicle to add a new one/i)).toBeTruthy();
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
			expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe('My Honda');
		});

		it('review fix (H12): reconciles the shared vehicles context (refreshVehicles) after an edit save', async () => {
			mockUpdateVehicle.mockResolvedValue({ data: vehicle1, error: null });
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });

			await fireEvent.click(screen.getByRole('button', { name: /edit my honda/i }));
			flushSync();

			mockRefreshVehicles.mockClear();
			mockGetAllVehicles.mockResolvedValueOnce({ data: [vehicle1, vehicle2], error: null });

			await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockUpdateVehicle).toHaveBeenCalled();
			expect(mockRefreshVehicles).toHaveBeenCalled();
		});
	});

	describe('archive flow (default destructive action)', () => {
		it('shows the archive confirmation dialog when Archive is clicked', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			await fireEvent.click(screen.getByRole('button', { name: /archive my honda/i }));
			flushSync();
			expect(screen.getByText(/archive my honda\?/i)).toBeTruthy();
			// Copy reassures the user history is kept and restore is possible.
			expect(screen.getByText(/history and odometer are kept/i)).toBeTruthy();
		});

		it('hides the confirmation dialog when Cancel is clicked', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			await fireEvent.click(screen.getByRole('button', { name: /archive my honda/i }));
			flushSync();
			const cancelBtns = screen.getAllByRole('button', { name: /cancel/i });
			await fireEvent.click(cancelBtns[0]);
			flushSync();
			expect(screen.queryByText(/archive my honda\?/i)).toBeNull();
		});

		it('calls archiveVehicle (NOT deleteVehicle) and removes the vehicle from the active list on confirm', async () => {
			mockArchiveVehicle.mockResolvedValue({
				data: { ...vehicle1, isArchived: true },
				error: null
			});
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });

			await fireEvent.click(screen.getByRole('button', { name: /archive my honda/i }));
			flushSync();

			// After confirming, loadVehicles re-runs — vehicle1 now moves to the archived list.
			mockGetAllVehicles.mockResolvedValueOnce({ data: [vehicle2], error: null });
			mockGetArchivedVehicles.mockResolvedValueOnce({
				data: [{ ...vehicle1, isArchived: true }],
				error: null
			});

			await fireEvent.click(screen.getByRole('button', { name: /confirm archive/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockArchiveVehicle).toHaveBeenCalledWith(1);
			expect(mockDeleteVehicle).not.toHaveBeenCalled();
			// vehicle1 is gone from the ACTIVE list (name appears only in the archived section now).
			expect(screen.getByRole('list', { name: /^vehicle list$/i })).toBeTruthy();
			expect(screen.getByText('Work Van')).toBeTruthy();
			expect(screen.getByRole('list', { name: /archived vehicles/i })).toBeTruthy();
		});

		it('surfaces an error and re-arms when archiveVehicle fails', async () => {
			mockArchiveVehicle.mockResolvedValue({
				data: null,
				error: { code: 'UPDATE_FAILED', message: 'boom' }
			});
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });

			await fireEvent.click(screen.getByRole('button', { name: /archive my honda/i }));
			flushSync();
			await fireEvent.click(screen.getByRole('button', { name: /confirm archive/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(screen.getByText(/could not archive vehicle/i)).toBeTruthy();
			// Still armed — the dialog is still open.
			expect(screen.getByText(/archive my honda\?/i)).toBeTruthy();
		});

		it('H12: reconciles the shared vehicles context (refreshVehicles) after archive', async () => {
			mockArchiveVehicle.mockResolvedValue({
				data: { ...vehicle2, isArchived: true },
				error: null
			});
			await renderAndWait({ activeVehicleId: 1, _vehicles: [vehicle1, vehicle2] });

			await fireEvent.click(screen.getByRole('button', { name: /archive work van/i }));
			flushSync();
			mockRefreshVehicles.mockClear();
			mockGetAllVehicles.mockResolvedValueOnce({ data: [vehicle1], error: null });
			mockGetArchivedVehicles.mockResolvedValueOnce({
				data: [{ ...vehicle2, isArchived: true }],
				error: null
			});
			await fireEvent.click(screen.getByRole('button', { name: /confirm archive/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockRefreshVehicles).toHaveBeenCalled();
			// The component never picks the fallback vehicle itself (S19 owns that — review 8.6).
			expect(mockSwitchVehicle).not.toHaveBeenCalled();
		});
	});

	describe('archived section', () => {
		it('renders an Archived list with Restore and Delete-permanently for each archived vehicle', async () => {
			await renderAndWait({ _vehicles: [vehicle1], _archived: [archivedVehicle] });
			expect(screen.getByRole('heading', { name: /^archived$/i })).toBeTruthy();
			const archivedList = screen.getByRole('list', { name: /archived vehicles/i });
			expect(within(archivedList).getByText('Old Ranger')).toBeTruthy();
			expect(screen.getByRole('button', { name: /restore old ranger/i })).toBeTruthy();
			expect(screen.getByRole('button', { name: /delete old ranger permanently/i })).toBeTruthy();
		});

		it('does not render the Archived section when there are no archived vehicles', async () => {
			await renderAndWait({ _vehicles: [vehicle1], _archived: [] });
			expect(screen.queryByRole('heading', { name: /^archived$/i })).toBeNull();
			expect(screen.queryByRole('list', { name: /archived vehicles/i })).toBeNull();
		});

		it('restores an archived vehicle (no confirmation) and reconciles the context', async () => {
			mockRestoreVehicle.mockResolvedValue({
				data: { ...archivedVehicle, isArchived: false },
				error: null
			});
			await renderAndWait({ _vehicles: [vehicle1], _archived: [archivedVehicle] });

			// After restore, loadVehicles re-runs: the vehicle moves back to the active list.
			mockGetAllVehicles.mockResolvedValueOnce({
				data: [vehicle1, { ...archivedVehicle, isArchived: false }],
				error: null
			});
			mockGetArchivedVehicles.mockResolvedValueOnce({ data: [], error: null });

			await fireEvent.click(screen.getByRole('button', { name: /restore old ranger/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockRestoreVehicle).toHaveBeenCalledWith(9);
			expect(mockRefreshVehicles).toHaveBeenCalled();
			// The archived section is gone (list emptied) and the car is now active.
			expect(screen.queryByRole('list', { name: /archived vehicles/i })).toBeNull();
			expect(screen.getByText('Old Ranger')).toBeTruthy();
		});

		it('requires confirmation before permanently deleting, then calls deleteVehicle (the cascade)', async () => {
			mockDeleteVehicle.mockResolvedValue({ data: undefined, error: null });
			await renderAndWait({ _vehicles: [vehicle1], _archived: [archivedVehicle] });

			await fireEvent.click(screen.getByRole('button', { name: /delete old ranger permanently/i }));
			flushSync();
			// Explicit destructive confirmation with an irreversibility warning.
			expect(screen.getByRole('alertdialog')).toBeTruthy();
			expect(screen.getByText(/permanently delete old ranger\?/i)).toBeTruthy();
			expect(screen.getByText(/can't be undone/i)).toBeTruthy();

			mockGetArchivedVehicles.mockResolvedValueOnce({ data: [], error: null });
			await fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();

			expect(mockDeleteVehicle).toHaveBeenCalledWith(9);
			expect(screen.queryByText('Old Ranger')).toBeNull();
		});

		it('cancels the permanent-delete confirmation without calling deleteVehicle', async () => {
			await renderAndWait({ _vehicles: [vehicle1], _archived: [archivedVehicle] });

			await fireEvent.click(screen.getByRole('button', { name: /delete old ranger permanently/i }));
			flushSync();
			const cancelBtns = screen.getAllByRole('button', { name: /cancel/i });
			await fireEvent.click(cancelBtns[0]);
			flushSync();

			expect(screen.queryByRole('alertdialog')).toBeNull();
			expect(mockDeleteVehicle).not.toHaveBeenCalled();
		});
	});

	describe('load error state', () => {
		it('renders error message when getAllVehicles returns an error', async () => {
			mockGetAllVehicles.mockResolvedValue({
				data: null,
				error: { code: 'UNKNOWN', message: 'DB error' }
			});
			mockGetArchivedVehicles.mockResolvedValue({ data: [], error: null });
			const context = new Map<string, unknown>();
			context.set('vehicles', vehiclesContext());
			render(VehicleListManager, { context });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/could not load vehicles/i)).toBeTruthy();
		});

		it('renders error message when getArchivedVehicles returns an error', async () => {
			mockGetAllVehicles.mockResolvedValue({ data: [vehicle1], error: null });
			mockGetArchivedVehicles.mockResolvedValue({
				data: null,
				error: { code: 'GET_FAILED', message: 'DB error' }
			});
			const context = new Map<string, unknown>();
			context.set('vehicles', vehiclesContext());
			render(VehicleListManager, { context });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/could not load vehicles/i)).toBeTruthy();
		});
	});

	describe('confirmation accessibility', () => {
		it('renders the archive confirmation with role="alertdialog" and aria-labelledby', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			await fireEvent.click(screen.getByRole('button', { name: /archive my honda/i }));
			flushSync();
			const dialog = screen.getByRole('alertdialog');
			expect(dialog).toBeTruthy();
			const labelId = dialog.getAttribute('aria-labelledby')!;
			expect(labelId).toBeTruthy();
			const label = document.getElementById(labelId);
			expect(label).toBeTruthy();
			expect(label!.textContent).toContain('Archive My Honda?');
		});
	});

	describe('action state reset on mode switch', () => {
		it('resets an armed archive state when switching to create mode', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			await fireEvent.click(screen.getByRole('button', { name: /archive my honda/i }));
			flushSync();
			expect(screen.getByRole('alertdialog')).toBeTruthy();

			await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));
			flushSync();
			expect(screen.getByRole('heading', { name: /add vehicle/i })).toBeTruthy();

			await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
			flushSync();
			expect(screen.queryByRole('alertdialog')).toBeNull();
		});

		it('resets an armed archive state when switching to edit mode', async () => {
			await renderAndWait({ _vehicles: [vehicle1, vehicle2] });
			await fireEvent.click(screen.getByRole('button', { name: /archive my honda/i }));
			flushSync();
			expect(screen.getByRole('alertdialog')).toBeTruthy();

			await fireEvent.click(screen.getByRole('button', { name: /edit work van/i }));
			flushSync();
			expect(screen.getByRole('heading', { name: /edit vehicle/i })).toBeTruthy();

			await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
			flushSync();
			expect(screen.queryByRole('alertdialog')).toBeNull();
		});
	});

	describe('single vehicle user (AC: 7)', () => {
		it('works identically with one vehicle — shows list, edit, archive', async () => {
			await renderAndWait({ activeVehicleId: 1, _vehicles: [vehicle1] });
			expect(screen.getByText('My Honda')).toBeTruthy();
			expect(screen.getByRole('button', { name: /edit my honda/i })).toBeTruthy();
			expect(screen.getByRole('button', { name: /archive my honda/i })).toBeTruthy();
			expect(screen.getByRole('button', { name: /add vehicle/i })).toBeTruthy();
			expect(screen.getByText(`1 of ${MAX_VEHICLES} vehicles`)).toBeTruthy();
		});
	});
});
