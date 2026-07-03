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
			const existing = await db.vehicles.count();
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

	async getAllVehicles(): Promise<Result<Vehicle[]>> {
		try {
			const vehicles = await db.vehicles.toArray();
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
}

export const vehicleRepository = new VehicleRepository();

// Convenience function exports — delegate to repository instance for backward compatibility
export const saveVehicle = (vehicle: NewVehicle) => vehicleRepository.saveVehicle(vehicle);
export const getVehicleById = (id: number) => vehicleRepository.getVehicleById(id);
export const getAllVehicles = () => vehicleRepository.getAllVehicles();
export const updateVehicle = (id: number, changes: Partial<NewVehicle>) =>
	vehicleRepository.updateVehicle(id, changes);
export const deleteVehicle = (id: number) => vehicleRepository.deleteVehicle(id);
export const getVehicleCount = () => vehicleRepository.getVehicleCount();
