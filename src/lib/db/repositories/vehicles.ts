import { db } from '../db';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { Vehicle, NewVehicle } from '../schema';
import { MAX_VEHICLES } from '$lib/config';
import { validateNewVehicle, validatePartialVehicle } from '../validators/rowValidation';
import { runWrite, encodeSentinel } from '../writeSkeleton';

export class VehicleRepository {
	async saveVehicle(vehicle: NewVehicle): Promise<Result<Vehicle>> {
		try {
			// AD-VA-4: the cap counts ACTIVE vehicles only — archiving a car frees a slot, so a user at
			// the limit can archive one and add another without hitting MAX_VEHICLES.
			const existing = await db.vehicles.filter((v) => !v.isArchived).count();
			if (existing >= MAX_VEHICLES) {
				return err('MAX_VEHICLES', `Maximum ${MAX_VEHICLES} vehicles allowed`);
			}
		} catch (e) {
			return err('SAVE_FAILED', String(e));
		}
		return runWrite(
			() => validateNewVehicle(vehicle),
			async () => {
				const id = await db.vehicles.add({ ...vehicle } as Vehicle);
				const saved = await db.vehicles.get(id as number);
				if (!saved) throw encodeSentinel('SAVE_FAILED', 'Record not found after insert');
				return saved;
			},
			'SAVE_FAILED'
		);
	}

	async getVehicleById(id: number): Promise<Result<Vehicle>> {
		try {
			const vehicle = await db.vehicles.get(id);
			if (!vehicle) return err('NOT_FOUND', `Vehicle ${id} not found`);
			return ok(vehicle);
		} catch (e) {
			return err('GET_FAILED', String(e));
		}
	}

	// AC5: the single ACTIVE read funnel. Archived vehicles are excluded here so every consumer that
	// loads "the vehicles" (layout context → VehicleSwitcher/CaptureSheet/dashboards, Settings, import
	// steps, export scope) inherits the exclusion — an archived vehicle never appears as a current car.
	async getAllVehicles(): Promise<Result<Vehicle[]>> {
		try {
			const vehicles = await db.vehicles.filter((v) => !v.isArchived).toArray();
			return ok(vehicles);
		} catch (e) {
			return err('GET_FAILED', String(e));
		}
	}

	// AC5/AC7: the sibling read for the Archived surface (Settings). Returns ONLY archived vehicles.
	async getArchivedVehicles(): Promise<Result<Vehicle[]>> {
		try {
			const vehicles = await db.vehicles.filter((v) => v.isArchived === true).toArray();
			return ok(vehicles);
		} catch (e) {
			return err('GET_FAILED', String(e));
		}
	}

	async updateVehicle(id: number, changes: Partial<NewVehicle>): Promise<Result<Vehicle>> {
		return runWrite(
			() => validatePartialVehicle(changes),
			async () => {
				const count = await db.vehicles.update(id, changes);
				if (count === 0) throw encodeSentinel('NOT_FOUND', `Vehicle ${id} not found`);
				const updated = await db.vehicles.get(id);
				if (!updated) throw encodeSentinel('UPDATE_FAILED', 'Record not found after update');
				return updated;
			},
			'UPDATE_FAILED'
		);
	}

	// AC2: the DEFAULT destructive action — archive, not purge. A single flag-flip update through the
	// ADR-006 write boundary (validate → op → notify on success). The vehicle row and ALL its child
	// rows are RETAINED, so odometer/history survive and restore brings back the identical car (identity
	// = the retained row's stable `id`, AD-VA-3). `archivedAt` stamps when it was archived.
	async archiveVehicle(id: number): Promise<Result<Vehicle>> {
		return this.updateVehicle(id, { isArchived: true, archivedAt: Date.now() });
	}

	// AC3: the inverse flag-flip — clear `isArchived` and drop `archivedAt` (Dexie deletes a key set to
	// undefined). The car returns to the active set, re-selectable, with its history intact.
	async restoreVehicle(id: number): Promise<Result<Vehicle>> {
		return this.updateVehicle(id, { isArchived: false, archivedAt: undefined });
	}

	// AC4/AC2: the PERMANENT purge — the hard cascade, now reachable only as an explicit
	// "Delete permanently" action from the Archived list (the only path that destroys data, AD-VA-5).
	async deleteVehicle(id: number): Promise<Result<void>> {
		// Cascade-delete the vehicle's owned records so no orphaned fuel logs, expenses, or service
		// reminders are left behind in IndexedDB. Existence-checked (S17): a no-op delete must not
		// fire notifyDataChanged (which would bump the data generation and invalidate a pending
		// Undo elsewhere for no real mutation). Run in a single transaction so a partial failure
		// rolls back rather than leaving the vehicle deleted but its children stranded (or vice versa).
		return runWrite(
			() => null,
			() =>
				db.transaction(
					'rw',
					db.vehicles,
					db.fuelLogs,
					db.expenses,
					db.serviceReminders,
					async () => {
						const existing = await db.vehicles.get(id);
						if (!existing) throw encodeSentinel('NOT_FOUND', `Vehicle ${id} not found`);
						await db.fuelLogs.where('vehicleId').equals(id).delete();
						await db.expenses.where('vehicleId').equals(id).delete();
						await db.serviceReminders.where('vehicleId').equals(id).delete();
						await db.vehicles.delete(id);
					}
				),
			'DELETE_FAILED'
		);
	}

	async getVehicleCount(): Promise<Result<number>> {
		try {
			const count = await db.vehicles.count();
			return ok(count);
		} catch (e) {
			return err('GET_FAILED', String(e));
		}
	}

	// AD-VA-4: count of ACTIVE vehicles only — what the MAX_VEHICLES cap is measured against.
	async getActiveVehicleCount(): Promise<Result<number>> {
		try {
			const count = await db.vehicles.filter((v) => !v.isArchived).count();
			return ok(count);
		} catch (e) {
			return err('GET_FAILED', String(e));
		}
	}
}

export const vehicleRepository = new VehicleRepository();

// Convenience function exports — delegate to repository instance for backward compatibility
export const saveVehicle = (vehicle: NewVehicle) => vehicleRepository.saveVehicle(vehicle);
export const getVehicleById = (id: number) => vehicleRepository.getVehicleById(id);
export const getAllVehicles = () => vehicleRepository.getAllVehicles();
export const getArchivedVehicles = () => vehicleRepository.getArchivedVehicles();
export const updateVehicle = (id: number, changes: Partial<NewVehicle>) =>
	vehicleRepository.updateVehicle(id, changes);
export const archiveVehicle = (id: number) => vehicleRepository.archiveVehicle(id);
export const restoreVehicle = (id: number) => vehicleRepository.restoreVehicle(id);
export const deleteVehicle = (id: number) => vehicleRepository.deleteVehicle(id);
export const getVehicleCount = () => vehicleRepository.getVehicleCount();
export const getActiveVehicleCount = () => vehicleRepository.getActiveVehicleCount();
