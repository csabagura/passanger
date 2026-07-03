import { describe, it, expect } from 'vitest';
import {
	validateNewVehicle,
	validatePartialVehicle,
	validateNewFuelLog,
	validatePartialFuelLog,
	validateNewExpense,
	validatePartialExpense,
	isPositiveFinite,
	validateNewServiceReminder,
	validatePartialServiceReminder,
	hasAtLeastOneInterval,
	isValidRowId,
	validateVehicleCount,
	validateVehicleReferentialIntegrity
} from './rowValidation';
import type { NewVehicle, NewFuelLog, NewExpense, NewServiceReminder } from '../schema';

const makeVehicle = (): NewVehicle => ({ name: 'My Honda', make: 'Honda', model: 'Civic' });

const makeFuelLog = (): NewFuelLog => ({
	vehicleId: 1,
	date: new Date('2025-01-15'),
	odometer: 50000,
	quantity: 40.5,
	unit: 'L',
	distanceUnit: 'km',
	totalCost: 68.45,
	calculatedConsumption: 7.2
});

const makeExpense = (): NewExpense => ({
	vehicleId: 1,
	date: new Date('2025-01-15'),
	type: 'Oil Change',
	cost: 45.0
});

const makeReminder = (): NewServiceReminder => ({
	vehicleId: 1,
	title: 'Oil change',
	intervalKm: 5000
});

describe('validateNewVehicle / validatePartialVehicle', () => {
	it('accepts a valid vehicle', () => {
		expect(validateNewVehicle(makeVehicle())).toBeNull();
	});

	it('rejects empty name/make/model', () => {
		expect(validateNewVehicle({ ...makeVehicle(), name: '' })).not.toBeNull();
		expect(validateNewVehicle({ ...makeVehicle(), name: '   ' })).not.toBeNull();
		expect(validateNewVehicle({ ...makeVehicle(), make: '' })).not.toBeNull();
		expect(validateNewVehicle({ ...makeVehicle(), model: '' })).not.toBeNull();
	});

	it('S14: a truthy non-string name/make/model returns a validation error, never throws', () => {
		expect(() =>
			validateNewVehicle({ ...makeVehicle(), name: 5 as unknown as string })
		).not.toThrow();
		expect(validateNewVehicle({ ...makeVehicle(), name: 5 as unknown as string })).not.toBeNull();
		expect(
			validateNewVehicle({ ...makeVehicle(), make: true as unknown as string })
		).not.toBeNull();
		expect(validateNewVehicle({ ...makeVehicle(), model: {} as unknown as string })).not.toBeNull();
	});

	it('S14 partial: a truthy non-string name/make/model returns a validation error, never throws', () => {
		expect(() => validatePartialVehicle({ name: 5 as unknown as string })).not.toThrow();
		expect(validatePartialVehicle({ name: 5 as unknown as string })).not.toBeNull();
		expect(validatePartialVehicle({ make: true as unknown as string })).not.toBeNull();
		expect(validatePartialVehicle({ model: {} as unknown as string })).not.toBeNull();
	});

	it('rejects an out-of-range or non-integer year', () => {
		expect(validateNewVehicle({ ...makeVehicle(), year: 1899 })).not.toBeNull();
		expect(
			validateNewVehicle({ ...makeVehicle(), year: new Date().getFullYear() + 1 })
		).not.toBeNull();
		expect(validateNewVehicle({ ...makeVehicle(), year: 2020.5 })).not.toBeNull();
	});

	it('accepts an absent year (optional field)', () => {
		expect(validateNewVehicle(makeVehicle())).toBeNull();
	});

	it('partial: rejects clearing name/make/model to empty', () => {
		expect(validatePartialVehicle({ name: '' })).not.toBeNull();
		expect(validatePartialVehicle({ make: '   ' })).not.toBeNull();
	});

	it('partial: untouched fields are not validated', () => {
		expect(validatePartialVehicle({ name: 'New Name' })).toBeNull();
	});
});

describe('validateNewFuelLog / validatePartialFuelLog', () => {
	it('accepts a valid fuel log', () => {
		expect(validateNewFuelLog(makeFuelLog())).toBeNull();
	});

	it('rejects non-positive vehicleId', () => {
		expect(validateNewFuelLog({ ...makeFuelLog(), vehicleId: 0 })).not.toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), vehicleId: -1 })).not.toBeNull();
	});

	it('rejects an invalid date', () => {
		expect(validateNewFuelLog({ ...makeFuelLog(), date: new Date('not-a-date') })).not.toBeNull();
	});

	it('rejects zero/negative/NaN/Infinity odometer', () => {
		expect(validateNewFuelLog({ ...makeFuelLog(), odometer: 0 })).not.toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), odometer: -1 })).not.toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), odometer: NaN })).not.toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), odometer: Infinity })).not.toBeNull();
	});

	it('rejects zero/negative/NaN/Infinity quantity', () => {
		expect(validateNewFuelLog({ ...makeFuelLog(), quantity: 0 })).not.toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), quantity: -1 })).not.toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), quantity: NaN })).not.toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), quantity: Infinity })).not.toBeNull();
	});

	it('rejects negative/NaN/Infinity totalCost', () => {
		expect(validateNewFuelLog({ ...makeFuelLog(), totalCost: -1 })).not.toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), totalCost: NaN })).not.toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), totalCost: Infinity })).not.toBeNull();
	});

	it('accepts zero totalCost (a legitimately free/zero-cost fill)', () => {
		expect(validateNewFuelLog({ ...makeFuelLog(), totalCost: 0 })).toBeNull();
	});

	it('rejects an invalid unit or distanceUnit enum value', () => {
		expect(validateNewFuelLog({ ...makeFuelLog(), unit: 'ml' as 'L' })).not.toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), distanceUnit: 'yd' as 'km' })).not.toBeNull();
	});

	it('rejects unit/distanceUnit pairing violations (L+mi, gal+km)', () => {
		expect(validateNewFuelLog({ ...makeFuelLog(), unit: 'L', distanceUnit: 'mi' })).not.toBeNull();
		expect(
			validateNewFuelLog({ ...makeFuelLog(), unit: 'gal', distanceUnit: 'km' })
		).not.toBeNull();
	});

	it('accepts the two valid pairings', () => {
		expect(validateNewFuelLog({ ...makeFuelLog(), unit: 'L', distanceUnit: 'km' })).toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), unit: 'gal', distanceUnit: 'mi' })).toBeNull();
	});

	it('rejects a non-boolean v5 flag, accepts a valid boolean or absent', () => {
		expect(
			validateNewFuelLog({ ...makeFuelLog(), isPartialFill: 'yes' as unknown as boolean })
		).not.toBeNull();
		expect(
			validateNewFuelLog({
				...makeFuelLog(),
				precededByMissedFill: 1 as unknown as boolean
			})
		).not.toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), isPartialFill: true })).toBeNull();
		expect(validateNewFuelLog({ ...makeFuelLog(), precededByMissedFill: false })).toBeNull();
		expect(validateNewFuelLog(makeFuelLog())).toBeNull();
	});

	it('partial: rejects updating unit without distanceUnit and vice versa', () => {
		expect(validatePartialFuelLog({ unit: 'gal' })).not.toBeNull();
		expect(validatePartialFuelLog({ distanceUnit: 'mi' })).not.toBeNull();
	});

	it('partial: rejects a mismatched pair when both are updated together', () => {
		expect(validatePartialFuelLog({ unit: 'L', distanceUnit: 'mi' })).not.toBeNull();
	});

	it('partial: accepts a matched pair updated together', () => {
		expect(validatePartialFuelLog({ unit: 'gal', distanceUnit: 'mi' })).toBeNull();
	});

	it('partial: rejects a present non-boolean v5 flag but allows an explicit undefined (clear)', () => {
		expect(validatePartialFuelLog({ isPartialFill: 'yes' as unknown as boolean })).not.toBeNull();
		expect(validatePartialFuelLog({ isPartialFill: undefined })).toBeNull();
	});

	it('partial: untouched fields are not validated', () => {
		expect(validatePartialFuelLog({ notes: 'updated' })).toBeNull();
	});
});

describe('validateNewExpense / validatePartialExpense', () => {
	it('accepts a valid expense', () => {
		expect(validateNewExpense(makeExpense())).toBeNull();
	});

	it('rejects an empty type', () => {
		expect(validateNewExpense({ ...makeExpense(), type: '' })).not.toBeNull();
		expect(validateNewExpense({ ...makeExpense(), type: '   ' })).not.toBeNull();
	});

	it('S14: a truthy non-string type returns a validation error, never throws', () => {
		expect(() =>
			validateNewExpense({ ...makeExpense(), type: 5 as unknown as string })
		).not.toThrow();
		expect(validateNewExpense({ ...makeExpense(), type: 5 as unknown as string })).not.toBeNull();
		expect(() => validatePartialExpense({ type: 5 as unknown as string })).not.toThrow();
		expect(validatePartialExpense({ type: 5 as unknown as string })).not.toBeNull();
	});

	it('rejects negative/NaN/Infinity cost', () => {
		expect(validateNewExpense({ ...makeExpense(), cost: -1 })).not.toBeNull();
		expect(validateNewExpense({ ...makeExpense(), cost: NaN })).not.toBeNull();
		expect(validateNewExpense({ ...makeExpense(), cost: Infinity })).not.toBeNull();
	});

	it('accepts an absent odometer (optional) but rejects a negative/NaN one when present', () => {
		expect(validateNewExpense(makeExpense())).toBeNull();
		expect(validateNewExpense({ ...makeExpense(), odometer: -1 })).not.toBeNull();
		expect(validateNewExpense({ ...makeExpense(), odometer: NaN })).not.toBeNull();
	});

	it('partial: rejects clearing type to empty', () => {
		expect(validatePartialExpense({ type: '' })).not.toBeNull();
	});
});

describe('isPositiveFinite', () => {
	it('accepts positive finite numbers only', () => {
		expect(isPositiveFinite(5000)).toBe(true);
		expect(isPositiveFinite(0)).toBe(false);
		expect(isPositiveFinite(-1)).toBe(false);
		expect(isPositiveFinite(NaN)).toBe(false);
		expect(isPositiveFinite(Infinity)).toBe(false);
		expect(isPositiveFinite('5000')).toBe(false);
		expect(isPositiveFinite(undefined)).toBe(false);
	});
});

describe('validateNewServiceReminder / validatePartialServiceReminder', () => {
	it('accepts a valid reminder', () => {
		expect(validateNewServiceReminder(makeReminder())).toBeNull();
	});

	it('rejects a reminder with neither interval', () => {
		expect(validateNewServiceReminder({ vehicleId: 1, title: 'Oil change' })).not.toBeNull();
	});

	it('rejects a non-positive-finite interval', () => {
		expect(validateNewServiceReminder({ ...makeReminder(), intervalKm: 0 })).not.toBeNull();
		expect(validateNewServiceReminder({ ...makeReminder(), intervalKm: -1 })).not.toBeNull();
		expect(validateNewServiceReminder({ ...makeReminder(), intervalKm: NaN })).not.toBeNull();
	});

	it('rejects an empty title', () => {
		expect(validateNewServiceReminder({ ...makeReminder(), title: '' })).not.toBeNull();
	});

	it('S14: a truthy non-string title returns a validation error, never throws', () => {
		expect(() =>
			validateNewServiceReminder({ ...makeReminder(), title: 5 as unknown as string })
		).not.toThrow();
		expect(
			validateNewServiceReminder({ ...makeReminder(), title: 5 as unknown as string })
		).not.toBeNull();
		expect(() => validatePartialServiceReminder({ title: 5 as unknown as string })).not.toThrow();
		expect(validatePartialServiceReminder({ title: 5 as unknown as string })).not.toBeNull();
	});

	it('accepts a days-only reminder', () => {
		expect(
			validateNewServiceReminder({ vehicleId: 1, title: 'Timing belt', intervalDays: 365 })
		).toBeNull();
	});

	it('partial: validates a present interval, ignores an absent one', () => {
		expect(validatePartialServiceReminder({ intervalKm: 5000 })).toBeNull();
		expect(validatePartialServiceReminder({ intervalKm: 0 })).not.toBeNull();
		expect(validatePartialServiceReminder({ title: 'New title' })).toBeNull();
	});

	it('partial: an explicit undefined interval is a no-op clear, not a validation failure', () => {
		expect(validatePartialServiceReminder({ intervalKm: undefined })).toBeNull();
		expect(
			validatePartialServiceReminder({ intervalKm: undefined, intervalDays: undefined })
		).toBeNull();
	});
});

describe('hasAtLeastOneInterval (S13 cross-field invariant)', () => {
	it('true when at least one interval is present', () => {
		expect(hasAtLeastOneInterval({ intervalKm: 5000 })).toBe(true);
		expect(hasAtLeastOneInterval({ intervalDays: 365 })).toBe(true);
		expect(hasAtLeastOneInterval({ intervalKm: 5000, intervalDays: 365 })).toBe(true);
	});

	it('false when neither interval is present', () => {
		expect(hasAtLeastOneInterval({})).toBe(false);
		expect(hasAtLeastOneInterval({ intervalKm: undefined, intervalDays: undefined })).toBe(false);
	});
});

describe('isValidRowId', () => {
	it('accepts a positive integer', () => {
		expect(isValidRowId(1)).toBe(true);
		expect(isValidRowId(42)).toBe(true);
	});

	it('rejects zero, negative, non-integer, NaN, Infinity, and non-numbers', () => {
		expect(isValidRowId(0)).toBe(false);
		expect(isValidRowId(-1)).toBe(false);
		expect(isValidRowId(1.5)).toBe(false);
		expect(isValidRowId(NaN)).toBe(false);
		expect(isValidRowId(Infinity)).toBe(false);
		expect(isValidRowId('1')).toBe(false);
		expect(isValidRowId(undefined)).toBe(false);
	});
});

describe('validateVehicleCount (H17a)', () => {
	it('accepts a count at or below MAX_VEHICLES', () => {
		expect(validateVehicleCount(5)).toBeNull();
		expect(validateVehicleCount(0)).toBeNull();
	});

	it('rejects a count above MAX_VEHICLES', () => {
		expect(validateVehicleCount(6)).not.toBeNull();
	});
});

describe('validateVehicleReferentialIntegrity (H17a)', () => {
	it('accepts rows whose vehicleId exists in the set', () => {
		const ids = new Set([1, 2]);
		expect(
			validateVehicleReferentialIntegrity(ids, [{ vehicleId: 1 }, { vehicleId: 2 }], 'fuelLog')
		).toBeNull();
	});

	it('rejects a row whose vehicleId is not in the set (dangling reference)', () => {
		const ids = new Set([1, 2]);
		expect(validateVehicleReferentialIntegrity(ids, [{ vehicleId: 99 }], 'fuelLog')).not.toBeNull();
	});

	it('accepts an empty row set', () => {
		expect(validateVehicleReferentialIntegrity(new Set([1]), [], 'expense')).toBeNull();
	});
});
