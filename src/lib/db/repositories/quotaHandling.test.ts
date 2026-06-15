import 'fake-indexeddb/auto'; // MUST be first import — patches global IndexedDB
import { describe, it, expect, afterEach, vi } from 'vitest';
import { db } from '../db';
import { saveFuelLog } from './fuelLogs';
import { saveExpense } from './expenses';
import { saveVehicle } from './vehicles';
import type { NewFuelLog, NewExpense, NewVehicle } from '../schema';

// A representative storage-quota failure as thrown by IndexedDB.
const quotaError = new DOMException('The quota has been exceeded.', 'QuotaExceededError');

const validFuelLog: NewFuelLog = {
	vehicleId: 1,
	date: new Date('2026-01-01T10:00:00Z'),
	odometer: 1000,
	quantity: 40,
	unit: 'L',
	distanceUnit: 'km',
	totalCost: 80,
	calculatedConsumption: 0
};

const validExpense: NewExpense = {
	vehicleId: 1,
	date: new Date('2026-01-01T10:00:00Z'),
	type: 'Oil Change',
	cost: 50
};

const validVehicle: NewVehicle = { name: 'Car', make: 'Honda', model: 'Civic' };

afterEach(() => {
	vi.restoreAllMocks();
});

describe('repositories map storage-quota failures to QUOTA_EXCEEDED', () => {
	it('saveFuelLog', async () => {
		vi.spyOn(db.fuelLogs, 'add').mockRejectedValueOnce(quotaError);
		const result = await saveFuelLog(validFuelLog);
		expect(result.error?.code).toBe('QUOTA_EXCEEDED');
	});

	it('saveExpense', async () => {
		vi.spyOn(db.expenses, 'add').mockRejectedValueOnce(quotaError);
		const result = await saveExpense(validExpense);
		expect(result.error?.code).toBe('QUOTA_EXCEEDED');
	});

	it('saveVehicle', async () => {
		vi.spyOn(db.vehicles, 'add').mockRejectedValueOnce(quotaError);
		const result = await saveVehicle(validVehicle);
		expect(result.error?.code).toBe('QUOTA_EXCEEDED');
	});

	it('leaves non-quota failures as their original code', async () => {
		vi.spyOn(db.fuelLogs, 'add').mockRejectedValueOnce(new Error('disk on fire'));
		const result = await saveFuelLog(validFuelLog);
		expect(result.error?.code).toBe('SAVE_FAILED');
	});
});
