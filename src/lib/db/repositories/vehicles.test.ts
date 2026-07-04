// @vitest-environment node
import 'fake-indexeddb/auto'; // MUST be first import — patches global IndexedDB
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import {
	saveVehicle,
	getVehicleById,
	getAllVehicles,
	getArchivedVehicles,
	updateVehicle,
	archiveVehicle,
	restoreVehicle,
	deleteVehicle,
	getVehicleCount,
	getActiveVehicleCount
} from './vehicles';
import { MAX_VEHICLES } from '$lib/config';
import { getDataGeneration } from '$lib/utils/tabSync';

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

		it('returns NOT_FOUND for a non-existent id (S17: no silent no-op)', async () => {
			// ADR-006 AD-WB-6: a no-op delete must not report success or fire notifyDataChanged
			// (which would bump the data generation and invalidate a pending Undo elsewhere for a
			// mutation that never happened).
			const result = await deleteVehicle(999);
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});

		it('a no-op delete does not bump the local data generation (S17)', async () => {
			const generationBefore = getDataGeneration();
			await deleteVehicle(999);
			expect(getDataGeneration()).toBe(generationBefore);
		});

		it('a real delete DOES bump the local data generation', async () => {
			const saved = await saveVehicle({ name: 'To Delete', make: 'Ford', model: 'Focus' });
			const generationBefore = getDataGeneration();
			await deleteVehicle(saved.data!.id);
			expect(getDataGeneration()).toBe(generationBefore + 1);
		});

		it('cascade-deletes the vehicle owned fuel logs, expenses, and reminders', async () => {
			const target = await saveVehicle({ name: 'Target', make: 'Ford', model: 'Focus' });
			const keep = await saveVehicle({ name: 'Keep', make: 'Toyota', model: 'Yaris' });
			const targetId = target.data!.id;
			const keepId = keep.data!.id;

			await db.fuelLogs.add({
				vehicleId: targetId,
				date: new Date('2026-01-01'),
				odometer: 1000,
				quantity: 40,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 60,
				calculatedConsumption: 0
			});
			await db.expenses.add({
				vehicleId: targetId,
				date: new Date('2026-01-02'),
				type: 'Service',
				cost: 120
			});
			await db.serviceReminders.add({ vehicleId: targetId, title: 'Oil change' });
			// A sibling vehicle's record must survive the cascade.
			await db.fuelLogs.add({
				vehicleId: keepId,
				date: new Date('2026-01-01'),
				odometer: 500,
				quantity: 30,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 45,
				calculatedConsumption: 0
			});

			const result = await deleteVehicle(targetId);
			expect(result.error).toBeNull();

			expect(await db.fuelLogs.where('vehicleId').equals(targetId).count()).toBe(0);
			expect(await db.expenses.where('vehicleId').equals(targetId).count()).toBe(0);
			expect(await db.serviceReminders.where('vehicleId').equals(targetId).count()).toBe(0);
			// The other vehicle is untouched.
			expect(await db.fuelLogs.where('vehicleId').equals(keepId).count()).toBe(1);
		});
	});

	// Story 9.2 — archive & restore (Dexie v7, ADR-008).
	describe('archiveVehicle', () => {
		it('flags the vehicle archived + stamps archivedAt, retaining the row and all children', async () => {
			const saved = await saveVehicle({ name: 'Sold Car', make: 'Ford', model: 'Focus' });
			const id = saved.data!.id;
			await db.fuelLogs.add({
				vehicleId: id,
				date: new Date('2026-01-01'),
				odometer: 12000,
				quantity: 40,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 60,
				calculatedConsumption: 0
			});
			await db.expenses.add({
				vehicleId: id,
				date: new Date('2026-01-02'),
				type: 'Tyres',
				cost: 200
			});
			await db.serviceReminders.add({ vehicleId: id, title: 'Oil change', intervalKm: 10000 });

			const before = Date.now();
			const result = await archiveVehicle(id);
			const after = Date.now();

			expect(result.error).toBeNull();
			expect(result.data?.isArchived).toBe(true);
			expect(result.data?.archivedAt).toBeGreaterThanOrEqual(before);
			expect(result.data?.archivedAt).toBeLessThanOrEqual(after);

			// Odometer/history persist — the row and every child survive (identity = the retained row).
			expect(await db.vehicles.get(id)).toBeTruthy();
			expect(await db.fuelLogs.where('vehicleId').equals(id).count()).toBe(1);
			expect(await db.expenses.where('vehicleId').equals(id).count()).toBe(1);
			expect(await db.serviceReminders.where('vehicleId').equals(id).count()).toBe(1);
		});

		it('excludes the archived vehicle from getAllVehicles but includes it in getArchivedVehicles', async () => {
			const active = await saveVehicle({ name: 'Daily', make: 'Toyota', model: 'Yaris' });
			const toArchive = await saveVehicle({ name: 'Weekend', make: 'Mazda', model: 'MX-5' });
			await archiveVehicle(toArchive.data!.id);

			const activeList = await getAllVehicles();
			expect(activeList.data?.map((v) => v.id)).toEqual([active.data!.id]);

			const archivedList = await getArchivedVehicles();
			expect(archivedList.data?.map((v) => v.id)).toEqual([toArchive.data!.id]);
		});

		it('returns NOT_FOUND for a non-existent id', async () => {
			const result = await archiveVehicle(999);
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});
	});

	describe('restoreVehicle', () => {
		it('clears isArchived + archivedAt and returns the identical car to the active set', async () => {
			const saved = await saveVehicle({ name: 'Seasonal', make: 'Jeep', model: 'Wrangler' });
			const id = saved.data!.id;
			await db.fuelLogs.add({
				vehicleId: id,
				date: new Date('2026-01-01'),
				odometer: 55000,
				quantity: 50,
				unit: 'L',
				distanceUnit: 'km',
				totalCost: 80,
				calculatedConsumption: 0
			});
			await archiveVehicle(id);

			const result = await restoreVehicle(id);
			expect(result.error).toBeNull();
			expect(result.data?.isArchived).toBe(false);
			expect(result.data?.archivedAt).toBeUndefined();

			// Back in the active funnel, same id, history intact.
			const activeList = await getAllVehicles();
			expect(activeList.data?.map((v) => v.id)).toContain(id);
			expect(await db.fuelLogs.where('vehicleId').equals(id).count()).toBe(1);
			const stored = await db.vehicles.get(id);
			expect(stored?.archivedAt).toBeUndefined();
		});

		it('rejects restore when MAX_VEHICLES are already active (AD-VA-4 — cannot exceed the cap)', async () => {
			// Reach MAX active + 1 archived via the reachable path: fill to the cap, archive one,
			// add a replacement (back to MAX active), leaving the archived car restorable.
			const ids: number[] = [];
			for (let i = 0; i < MAX_VEHICLES; i++) {
				const r = await saveVehicle({ name: `Car ${i}`, make: 'Make', model: 'Model' });
				ids.push(r.data!.id);
			}
			await archiveVehicle(ids[0]);
			await saveVehicle({ name: 'Replacement', make: 'Make', model: 'Model' });
			// Now MAX active + 1 archived. Restoring the archived car would make MAX+1 active → rejected.
			const result = await restoreVehicle(ids[0]);
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('MAX_VEHICLES');
			// The row stays archived — the failed restore did not flip the flag.
			expect((await db.vehicles.get(ids[0]))?.isArchived).toBe(true);
		});

		it('allows restore when an active slot is free', async () => {
			const saved = await saveVehicle({ name: 'Seasonal', make: 'Jeep', model: 'Wrangler' });
			await archiveVehicle(saved.data!.id);
			// Only archived rows exist → an active slot is free.
			const result = await restoreVehicle(saved.data!.id);
			expect(result.error).toBeNull();
			expect(result.data?.isArchived).toBe(false);
		});
	});

	describe('MAX_VEHICLES — active-only (AD-VA-4)', () => {
		it('archiving a car frees a slot so a new vehicle can be added at the limit', async () => {
			const ids: number[] = [];
			for (let i = 0; i < MAX_VEHICLES; i++) {
				const r = await saveVehicle({ name: `Car ${i}`, make: 'Make', model: 'Model' });
				ids.push(r.data!.id);
			}
			// At the limit, a new save is rejected...
			const blocked = await saveVehicle({ name: 'Over', make: 'Make', model: 'Model' });
			expect(blocked.error?.code).toBe('MAX_VEHICLES');

			// ...but archiving one frees a slot (archived rows stay in the table, don't count).
			await archiveVehicle(ids[0]);
			const allowed = await saveVehicle({ name: 'Replacement', make: 'Make', model: 'Model' });
			expect(allowed.error).toBeNull();
			expect(allowed.data).toBeTruthy();

			// The archived row still physically exists (retained, not purged).
			expect(await db.vehicles.get(ids[0])).toBeTruthy();
		});

		it('getActiveVehicleCount counts active vehicles only', async () => {
			const a = await saveVehicle({ name: 'A', make: 'M', model: 'X' });
			await saveVehicle({ name: 'B', make: 'M', model: 'X' });
			await archiveVehicle(a.data!.id);

			const active = await getActiveVehicleCount();
			expect(active.data).toBe(1);
			// The raw row count still includes the archived row.
			const total = await getVehicleCount();
			expect(total.data).toBe(2);
		});
	});
});
