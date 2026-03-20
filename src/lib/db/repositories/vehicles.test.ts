// @vitest-environment node
import 'fake-indexeddb/auto'; // MUST be first import — patches global IndexedDB
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import {
	saveVehicle,
	getVehicleById,
	getAllVehicles,
	updateVehicle,
	deleteVehicle,
	getVehicleCount
} from './vehicles';
import { MAX_VEHICLES } from '$lib/config';

beforeEach(async () => {
	await db.delete();
	await db.open();
});

describe('VehicleRepository', () => {
	describe('saveVehicle — validation', () => {
		it('rejects empty name', async () => {
			const result = await saveVehicle({ name: '', make: 'Toyota', model: 'Yaris' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects whitespace-only name', async () => {
			const result = await saveVehicle({ name: '   ', make: 'Toyota', model: 'Yaris' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects empty make', async () => {
			const result = await saveVehicle({ name: 'Car', make: '', model: 'Yaris' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects empty model', async () => {
			const result = await saveVehicle({ name: 'Car', make: 'Toyota', model: '' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects non-positive year', async () => {
			const result = await saveVehicle({ name: 'Car', make: 'Toyota', model: 'Yaris', year: -1 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects fractional year', async () => {
			const result = await saveVehicle({
				name: 'Car',
				make: 'Toyota',
				model: 'Yaris',
				year: 2005.5
			});
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects year below 1900', async () => {
			const result = await saveVehicle({
				name: 'Car',
				make: 'Toyota',
				model: 'Yaris',
				year: 1899
			});
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects year above current year', async () => {
			const futureYear = new Date().getFullYear() + 1;
			const result = await saveVehicle({
				name: 'Car',
				make: 'Toyota',
				model: 'Yaris',
				year: futureYear
			});
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('accepts year exactly 1900', async () => {
			const result = await saveVehicle({
				name: 'Antique',
				make: 'Ford',
				model: 'Model T',
				year: 1900
			});
			expect(result.error).toBeNull();
			expect(result.data?.year).toBe(1900);
		});

		it('accepts year equal to current year', async () => {
			const currentYear = new Date().getFullYear();
			const result = await saveVehicle({
				name: 'New Car',
				make: 'Tesla',
				model: 'Model 3',
				year: currentYear
			});
			expect(result.error).toBeNull();
			expect(result.data?.year).toBe(currentYear);
		});
	});

	describe('saveVehicle', () => {
		it('returns ok with saved vehicle including generated id', async () => {
			const result = await saveVehicle({ name: 'My Car', make: 'Toyota', model: 'Yaris' });
			expect(result.error).toBeNull();
			expect(result.data?.id).toBeDefined();
			expect(typeof result.data?.id).toBe('number');
			expect(result.data?.name).toBe('My Car');
			expect(result.data?.make).toBe('Toyota');
			expect(result.data?.model).toBe('Yaris');
		});

		it('saves vehicle with optional year field', async () => {
			const result = await saveVehicle({
				name: 'Old Car',
				make: 'Ford',
				model: 'Focus',
				year: 2005
			});
			expect(result.error).toBeNull();
			expect(result.data?.year).toBe(2005);
		});

		it('saves vehicle without optional year field', async () => {
			const result = await saveVehicle({ name: 'No Year', make: 'Honda', model: 'Civic' });
			expect(result.error).toBeNull();
			expect(result.data?.year).toBeUndefined();
		});
	});

	describe('getVehicleById', () => {
		it('returns the vehicle when found', async () => {
			const saved = await saveVehicle({ name: 'Test', make: 'BMW', model: '3 Series' });
			const result = await getVehicleById(saved.data!.id);
			expect(result.error).toBeNull();
			expect(result.data?.id).toBe(saved.data!.id);
			expect(result.data?.name).toBe('Test');
		});

		it('returns err with NOT_FOUND when id does not exist', async () => {
			const result = await getVehicleById(999);
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});
	});

	describe('getAllVehicles', () => {
		it('returns empty array when no records', async () => {
			const result = await getAllVehicles();
			expect(result.error).toBeNull();
			expect(result.data).toEqual([]);
		});

		it('returns all saved vehicles', async () => {
			await saveVehicle({ name: 'Car 1', make: 'Audi', model: 'A3' });
			await saveVehicle({ name: 'Car 2', make: 'VW', model: 'Golf' });
			const result = await getAllVehicles();
			expect(result.error).toBeNull();
			expect(result.data).toHaveLength(2);
		});
	});

	describe('updateVehicle — validation', () => {
		it('rejects empty name in changes', async () => {
			const saved = await saveVehicle({ name: 'Valid', make: 'Honda', model: 'Civic' });
			const result = await updateVehicle(saved.data!.id, { name: '' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects non-positive year in changes', async () => {
			const saved = await saveVehicle({ name: 'Valid', make: 'Honda', model: 'Civic' });
			const result = await updateVehicle(saved.data!.id, { year: 0 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects year below 1900 in changes', async () => {
			const saved = await saveVehicle({ name: 'Valid', make: 'Honda', model: 'Civic' });
			const result = await updateVehicle(saved.data!.id, { year: 1899 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects year above current year in changes', async () => {
			const saved = await saveVehicle({ name: 'Valid', make: 'Honda', model: 'Civic' });
			const futureYear = new Date().getFullYear() + 1;
			const result = await updateVehicle(saved.data!.id, { year: futureYear });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});
	});

	describe('updateVehicle', () => {
		it('persists name change while preserving other fields', async () => {
			const saved = await saveVehicle({ name: 'Old Name', make: 'Honda', model: 'Civic' });
			const updated = await updateVehicle(saved.data!.id, { name: 'New Name' });
			expect(updated.error).toBeNull();
			expect(updated.data?.name).toBe('New Name');
			expect(updated.data?.make).toBe('Honda');
			expect(updated.data?.model).toBe('Civic');
		});

		it('returns err with NOT_FOUND when id does not exist', async () => {
			const result = await updateVehicle(999, { name: 'Ghost' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});
	});

	describe('MAX_VEHICLES enforcement', () => {
		it('allows saving when under the limit', async () => {
			for (let i = 0; i < MAX_VEHICLES - 1; i++) {
				await saveVehicle({ name: `Car ${i}`, make: 'Make', model: 'Model' });
			}
			const result = await saveVehicle({ name: 'Last Car', make: 'Make', model: 'Model' });
			expect(result.error).toBeNull();
			expect(result.data).toBeTruthy();
		});

		it('returns MAX_VEHICLES error when at the limit', async () => {
			for (let i = 0; i < MAX_VEHICLES; i++) {
				await saveVehicle({ name: `Car ${i}`, make: 'Make', model: 'Model' });
			}
			const result = await saveVehicle({ name: 'Over Limit', make: 'Make', model: 'Model' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('MAX_VEHICLES');
		});

		it('allows saving again after deleting one at the limit', async () => {
			const vehicles = [];
			for (let i = 0; i < MAX_VEHICLES; i++) {
				const r = await saveVehicle({ name: `Car ${i}`, make: 'Make', model: 'Model' });
				vehicles.push(r.data!);
			}
			await deleteVehicle(vehicles[0].id);
			const result = await saveVehicle({ name: 'Replacement', make: 'Make', model: 'Model' });
			expect(result.error).toBeNull();
			expect(result.data).toBeTruthy();
		});
	});

	describe('getVehicleCount', () => {
		it('returns 0 when no vehicles exist', async () => {
			const result = await getVehicleCount();
			expect(result.error).toBeNull();
			expect(result.data).toBe(0);
		});

		it('returns correct count after adding vehicles', async () => {
			await saveVehicle({ name: 'Car 1', make: 'A', model: 'B' });
			await saveVehicle({ name: 'Car 2', make: 'A', model: 'B' });
			const result = await getVehicleCount();
			expect(result.error).toBeNull();
			expect(result.data).toBe(2);
		});

		it('returns correct count after delete', async () => {
			const r = await saveVehicle({ name: 'Car 1', make: 'A', model: 'B' });
			await saveVehicle({ name: 'Car 2', make: 'A', model: 'B' });
			await deleteVehicle(r.data!.id);
			const result = await getVehicleCount();
			expect(result.error).toBeNull();
			expect(result.data).toBe(1);
		});
	});

	describe('deleteVehicle', () => {
		it('removes the record so subsequent get returns NOT_FOUND', async () => {
			const saved = await saveVehicle({ name: 'To Delete', make: 'Ford', model: 'Focus' });
			const deleteResult = await deleteVehicle(saved.data!.id);
			expect(deleteResult.error).toBeNull();
			const fetched = await getVehicleById(saved.data!.id);
			expect(fetched.error?.code).toBe('NOT_FOUND');
		});

		it('returns ok for non-existent id (Dexie delete is idempotent)', async () => {
			const result = await deleteVehicle(999);
			expect(result.error).toBeNull();
		});
	});
});
