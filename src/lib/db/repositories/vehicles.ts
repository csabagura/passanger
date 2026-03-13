import { db } from '../db';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { Vehicle, NewVehicle } from '../schema';

function validateNewVehicle(vehicle: NewVehicle): string | null {
	if (!vehicle.name || vehicle.name.trim() === '') return 'Vehicle name is required';
	if (!vehicle.make || vehicle.make.trim() === '') return 'Vehicle make is required';
	if (!vehicle.model || vehicle.model.trim() === '') return 'Vehicle model is required';
	if (vehicle.year !== undefined) {
		if (
			!Number.isInteger(vehicle.year) ||
			vehicle.year < 1900 ||
			vehicle.year > new Date().getFullYear()
		) {
			return 'Vehicle year must be an integer between 1900 and the current year';
		}
	}
	return null;
}

function validatePartialVehicle(changes: Partial<NewVehicle>): string | null {
	if ('name' in changes && (!changes.name || changes.name.trim() === ''))
		return 'Vehicle name cannot be empty';
	if ('make' in changes && (!changes.make || changes.make.trim() === ''))
		return 'Vehicle make cannot be empty';
	if ('model' in changes && (!changes.model || changes.model.trim() === ''))
		return 'Vehicle model cannot be empty';
	if ('year' in changes && changes.year !== undefined) {
		if (
			!Number.isInteger(changes.year) ||
			changes.year < 1900 ||
			changes.year > new Date().getFullYear()
		) {
			return 'Vehicle year must be an integer between 1900 and the current year';
		}
	}
	return null;
}

export class VehicleRepository {
	async saveVehicle(vehicle: NewVehicle): Promise<Result<Vehicle>> {
		const validationError = validateNewVehicle(vehicle);
		if (validationError) return err('VALIDATION_ERROR', validationError);
		try {
			const id = await db.vehicles.add({ ...vehicle } as Vehicle);
			const saved = await db.vehicles.get(id as number);
			if (!saved) return err('SAVE_FAILED', 'Record not found after insert');
			return ok(saved);
		} catch (e) {
			return err('SAVE_FAILED', String(e));
		}
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
		const validationError = validatePartialVehicle(changes);
		if (validationError) return err('VALIDATION_ERROR', validationError);
		try {
			const count = await db.vehicles.update(id, changes);
			if (count === 0) return err('NOT_FOUND', `Vehicle ${id} not found`);
			const updated = await db.vehicles.get(id);
			if (!updated) return err('UPDATE_FAILED', 'Record not found after update');
			return ok(updated);
		} catch (e) {
			return err('UPDATE_FAILED', String(e));
		}
	}

	async deleteVehicle(id: number): Promise<Result<void>> {
		try {
			await db.vehicles.delete(id);
			return ok(undefined);
		} catch (e) {
			return err('DELETE_FAILED', String(e));
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
