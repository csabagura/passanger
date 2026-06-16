import { describe, it, expect } from 'vitest';
import { serializeBackup, parseBackup, buildBackupFilename, type BackupFile } from './backup';
import { BACKUP_APP_ID, DB_VERSION } from '$lib/config';
import type { BackupData } from '$lib/db/backup';
import type { AppSettings } from '$lib/utils/settings';

const settings: AppSettings = {
	fuelUnit: 'L/100km',
	currency: '€',
	theme: 'dark',
	exchangeRates: { $: 0.92 }
};

const data: BackupData = {
	vehicles: [{ id: 1, name: 'Car', make: 'Honda', model: 'Civic', year: 2018 }],
	fuelLogs: [
		{
			id: 10,
			vehicleId: 1,
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
			vehicleId: 1,
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
			vehicleId: 1,
			title: 'Oil change',
			intervalKm: 10000,
			lastServiceOdometer: 1000,
			lastServiceDate: new Date('2026-01-02T08:00:00.000Z')
		}
	]
};

describe('serializeBackup', () => {
	it('produces the header shape with app + schemaVersion + exportedAt', () => {
		const json = serializeBackup(data, settings);
		const parsed = JSON.parse(json) as BackupFile;
		expect(parsed.app).toBe(BACKUP_APP_ID);
		expect(parsed.schemaVersion).toBe(DB_VERSION);
		expect(typeof parsed.exportedAt).toBe('string');
		// exportedAt is an ISO timestamp.
		expect(Number.isNaN(new Date(parsed.exportedAt).getTime())).toBe(false);
		expect(parsed.settings).toEqual(settings);
	});

	it('encodes Date fields as ISO strings', () => {
		const parsed = JSON.parse(serializeBackup(data, settings)) as BackupFile;
		expect((parsed.data.fuelLogs[0] as unknown as { date: string }).date).toBe(
			'2026-01-02T08:00:00.000Z'
		);
		expect((parsed.data.expenses[0] as unknown as { date: string }).date).toBe(
			'2026-01-03T09:00:00.000Z'
		);
		expect(
			(parsed.data.serviceReminders[0] as unknown as { lastServiceDate: string }).lastServiceDate
		).toBe('2026-01-02T08:00:00.000Z');
	});
});

describe('parseBackup — round-trip', () => {
	it('parses a serialized backup back to the original data + settings', () => {
		const result = parseBackup(serializeBackup(data, settings));
		expect(result.error).toBeNull();
		expect(result.data?.settings).toEqual(settings);
		expect(result.data?.data.vehicles).toEqual(data.vehicles);
	});

	it('revives the three Date fields to Date objects', () => {
		const result = parseBackup(serializeBackup(data, settings));
		expect(result.error).toBeNull();
		const revived = result.data!.data;
		expect(revived.fuelLogs[0].date).toBeInstanceOf(Date);
		expect(revived.fuelLogs[0].date.getTime()).toBe(new Date('2026-01-02T08:00:00.000Z').getTime());
		expect(revived.expenses[0].date).toBeInstanceOf(Date);
		expect(revived.serviceReminders[0].lastServiceDate).toBeInstanceOf(Date);
	});

	it('preserves a serviceReminder with no lastServiceDate', () => {
		const noDate: BackupData = {
			...data,
			serviceReminders: [{ id: 31, vehicleId: 1, title: 'Tyres', intervalDays: 365 }]
		};
		const result = parseBackup(serializeBackup(noDate, settings));
		expect(result.error).toBeNull();
		expect(result.data?.data.serviceReminders[0].lastServiceDate).toBeUndefined();
	});
});

describe('parseBackup — rejections', () => {
	it('rejects malformed JSON', () => {
		const result = parseBackup('{ not json');
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toMatch(/malformed/i);
	});

	it('rejects a backup from a different app', () => {
		const json = JSON.stringify({
			app: 'someotherapp',
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: { vehicles: [], fuelLogs: [], expenses: [], serviceReminders: [] },
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toMatch(/not a passanger backup/i);
	});

	it('rejects a backup from a different schema version', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION + 1,
			exportedAt: new Date().toISOString(),
			data: { vehicles: [], fuelLogs: [], expenses: [], serviceReminders: [] },
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toMatch(/different app version/i);
	});

	it('rejects a backup missing the data sections', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: { vehicles: [], fuelLogs: [] }, // expenses + serviceReminders missing
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toMatch(/missing|invalid/i);
	});

	it('rejects a backup missing the settings section', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: { vehicles: [], fuelLogs: [], expenses: [], serviceReminders: [] }
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects when a row has the wrong shape', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: {
				vehicles: [{ id: 'not-a-number', name: 'X', make: 'X', model: 'X' }],
				fuelLogs: [],
				expenses: [],
				serviceReminders: []
			},
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects a fuel log with an invalid unit', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: {
				vehicles: [],
				fuelLogs: [
					{
						id: 1,
						vehicleId: 1,
						date: '2026-01-02T08:00:00.000Z',
						odometer: 1000,
						quantity: 40,
						unit: 'liters',
						distanceUnit: 'km',
						totalCost: 80,
						calculatedConsumption: 6.5
					}
				],
				expenses: [],
				serviceReminders: []
			},
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects a service reminder with no interval', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: {
				vehicles: [],
				fuelLogs: [],
				expenses: [],
				serviceReminders: [{ id: 1, vehicleId: 1, title: 'No interval' }]
			},
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects a backup with malformed settings', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: { vehicles: [], fuelLogs: [], expenses: [], serviceReminders: [] },
			settings: { currency: 42, fuelUnit: 'L/100km', theme: 'dark' }
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toMatch(/settings/i);
	});

	it('accepts empty arrays (empty-dataset backup)', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: { vehicles: [], fuelLogs: [], expenses: [], serviceReminders: [] },
			settings
		});
		const result = parseBackup(json);
		expect(result.error).toBeNull();
		expect(result.data?.data.vehicles).toEqual([]);
	});
});

describe('buildBackupFilename', () => {
	it('formats as passanger-backup-YYYY-MM-DD.json from local date parts', () => {
		// Construct a local date to avoid TZ ambiguity in the assertion.
		const date = new Date(2026, 5, 9); // 2026-06-09 local
		expect(buildBackupFilename(date)).toBe('passanger-backup-2026-06-09.json');
	});
});
