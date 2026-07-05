import { describe, it, expect } from 'vitest';
import {
	serializeVehicleShare,
	parseVehicleShare,
	buildVehicleShareFilename,
	type VehicleShareData,
	type VehicleShareFile
} from './vehicleShare';
import { serializeBackup, parseBackup } from './backup';
import { BACKUP_APP_ID, DB_VERSION, VEHICLE_SHARE_KIND } from '$lib/config';
import type { BackupData } from '$lib/db/backup';
import type { AppSettings } from '$lib/utils/settings';

const data: VehicleShareData = {
	vehicle: { id: 7, name: 'My Civic', make: 'Honda', model: 'Civic', year: 2018 },
	fuelLogs: [
		{
			id: 10,
			vehicleId: 7,
			date: new Date('2026-01-02T08:00:00.000Z'),
			odometer: 1000,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 80,
			currency: '€',
			calculatedConsumption: 6.5,
			notes: 'first fill'
		}
	],
	expenses: [
		{
			id: 20,
			vehicleId: 7,
			date: new Date('2026-01-03T09:00:00.000Z'),
			type: 'Oil Change',
			odometer: 1100,
			cost: 50,
			currency: '€'
		}
	],
	serviceReminders: [
		{
			id: 30,
			vehicleId: 7,
			title: 'Oil change',
			intervalKm: 10000,
			lastServiceOdometer: 1000,
			lastServiceDate: new Date('2026-01-02T08:00:00.000Z'),
			lastClosedByExpenseId: 20
		}
	]
};

describe('serializeVehicleShare', () => {
	it('produces the header shape with app + schemaVersion + kind + exportedAt', () => {
		const parsed = JSON.parse(serializeVehicleShare(data)) as VehicleShareFile;
		expect(parsed.app).toBe(BACKUP_APP_ID);
		expect(parsed.schemaVersion).toBe(DB_VERSION);
		expect(parsed.kind).toBe(VEHICLE_SHARE_KIND);
		expect(typeof parsed.exportedAt).toBe('string');
		expect(Number.isNaN(new Date(parsed.exportedAt).getTime())).toBe(false);
	});

	it('carries NO settings block (privacy: a stranger cannot overwrite the recipient settings)', () => {
		const parsed = JSON.parse(serializeVehicleShare(data)) as Record<string, unknown>;
		expect('settings' in parsed).toBe(false);
	});

	it('encodes Date fields as ISO strings', () => {
		const parsed = JSON.parse(serializeVehicleShare(data)) as VehicleShareFile;
		expect((parsed.data.fuelLogs[0] as unknown as { date: string }).date).toBe(
			'2026-01-02T08:00:00.000Z'
		);
	});
});

describe('parseVehicleShare', () => {
	it('round-trips a serialized payload back to Date-revived rows', () => {
		const result = parseVehicleShare(serializeVehicleShare(data));
		expect(result.error).toBeNull();
		expect(result.data?.vehicle.name).toBe('My Civic');
		expect(result.data?.fuelLogs[0].date).toBeInstanceOf(Date);
		expect(result.data?.serviceReminders[0].lastClosedByExpenseId).toBe(20);
	});

	it('rejects malformed JSON', () => {
		const result = parseVehicleShare('{ not json');
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects a foreign app id', () => {
		const result = parseVehicleShare(JSON.stringify({ app: 'other', kind: 'vehicle' }));
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects a file missing the kind discriminator (a full backup)', () => {
		const backup = serializeBackup(
			{ vehicles: [data.vehicle], fuelLogs: [], expenses: [], serviceReminders: [] } as BackupData,
			{ fuelUnit: 'L/100km', currency: '€', theme: 'dark' } as AppSettings
		);
		const result = parseVehicleShare(backup);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects a wrong kind value', () => {
		const bad = JSON.parse(serializeVehicleShare(data));
		bad.kind = 'not-a-vehicle';
		const result = parseVehicleShare(JSON.stringify(bad));
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects a newer schemaVersion', () => {
		const bad = JSON.parse(serializeVehicleShare(data));
		bad.schemaVersion = DB_VERSION + 1;
		const result = parseVehicleShare(JSON.stringify(bad));
		expect(result.error?.message).toMatch(/newer app version/);
	});

	it('rejects a non-integer schemaVersion', () => {
		const bad = JSON.parse(serializeVehicleShare(data));
		bad.schemaVersion = 4.5;
		const result = parseVehicleShare(JSON.stringify(bad));
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects a payload whose vehicle is an array (a full-backup shape)', () => {
		const bad = JSON.parse(serializeVehicleShare(data));
		bad.data.vehicle = [data.vehicle];
		const result = parseVehicleShare(JSON.stringify(bad));
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects an invalid row (unpaired L + mi fuel log)', () => {
		const bad = JSON.parse(serializeVehicleShare(data));
		bad.data.fuelLogs[0].distanceUnit = 'mi'; // L must pair with km
		const result = parseVehicleShare(JSON.stringify(bad));
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects a child that references a different vehicle (referential integrity)', () => {
		const bad = JSON.parse(serializeVehicleShare(data));
		bad.data.fuelLogs[0].vehicleId = 999;
		const result = parseVehicleShare(JSON.stringify(bad));
		expect(result.error?.message).toMatch(/does not exist/);
	});

	it('rejects duplicate row ids within a table', () => {
		const bad = JSON.parse(serializeVehicleShare(data));
		bad.data.fuelLogs.push({ ...bad.data.fuelLogs[0] }); // same id 10 twice
		const result = parseVehicleShare(JSON.stringify(bad));
		expect(result.error?.message).toMatch(/more than one row with id/);
	});
});

describe('mutual rejection with full backup', () => {
	it('parseBackup rejects a per-car share file', () => {
		const share = serializeVehicleShare(data);
		const result = parseBackup(share);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});
});

describe('buildVehicleShareFilename', () => {
	it('slugifies the vehicle name and stamps the local date', () => {
		const name = buildVehicleShareFilename('My Civic!', new Date('2026-07-04T10:00:00'));
		expect(name).toBe('passanger-car-my-civic-2026-07-04.json');
	});

	it('falls back to "car" for a name with no usable characters', () => {
		const name = buildVehicleShareFilename('!!!', new Date('2026-07-04T10:00:00'));
		expect(name).toBe('passanger-car-car-2026-07-04.json');
	});
});
