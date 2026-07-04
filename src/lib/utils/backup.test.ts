import { describe, it, expect } from 'vitest';
import { serializeBackup, parseBackup, buildBackupFilename, type BackupFile } from './backup';
import { BACKUP_APP_ID, DB_VERSION, MAX_VEHICLES } from '$lib/config';
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

	// v6 (Story 8.5, ADR-007): a v5-shaped backup (no createdAt/distanceUnit/lastClosedByExpenseId)
	// restores cleanly with the 3 new fields simply absent — no historical backfill on restore.
	it('preserves a serviceReminder from a v5 backup with the v6 fields absent', () => {
		const v5Shaped: BackupData = {
			...data,
			serviceReminders: [{ id: 32, vehicleId: 1, title: 'Oil change', intervalKm: 10000 }]
		};
		const result = parseBackup(serializeBackup(v5Shaped, settings));
		expect(result.error).toBeNull();
		const reminder = result.data?.data.serviceReminders[0];
		expect(reminder?.createdAt).toBeUndefined();
		expect(reminder?.distanceUnit).toBeUndefined();
		expect(reminder?.lastClosedByExpenseId).toBeUndefined();
	});

	it('round-trips a serviceReminder carrying the v6 fields', () => {
		const v6Shaped: BackupData = {
			...data,
			serviceReminders: [
				{
					id: 33,
					vehicleId: 1,
					title: 'Oil change',
					intervalKm: 10000,
					createdAt: 1_700_000_000_000,
					distanceUnit: 'mi',
					lastClosedByExpenseId: 42
				}
			]
		};
		const result = parseBackup(serializeBackup(v6Shaped, settings));
		expect(result.error).toBeNull();
		const reminder = result.data?.data.serviceReminders[0];
		expect(reminder?.createdAt).toBe(1_700_000_000_000);
		expect(reminder?.distanceUnit).toBe('mi');
		expect(reminder?.lastClosedByExpenseId).toBe(42);
	});

	// v7 (Story 9.2, ADR-008): isArchived/archivedAt round-trip through the pass-through revivers with
	// no validator change (AC9).
	it('round-trips a vehicle carrying isArchived/archivedAt (v7)', () => {
		const v7Shaped: BackupData = {
			...data,
			vehicles: [
				{ id: 1, name: 'Car', make: 'Honda', model: 'Civic', isArchived: false },
				{
					id: 2,
					name: 'Old Car',
					make: 'Ford',
					model: 'Focus',
					isArchived: true,
					archivedAt: 1_700_000_000_000
				}
			]
		};
		const result = parseBackup(serializeBackup(v7Shaped, settings));
		expect(result.error).toBeNull();
		const vehicles = result.data?.data.vehicles;
		expect(vehicles?.[0].isArchived).toBe(false);
		expect(vehicles?.[1].isArchived).toBe(true);
		expect(vehicles?.[1].archivedAt).toBe(1_700_000_000_000);
	});

	// A pre-v7 backup (no isArchived) restores with the field absent — readers treat it as active.
	it('preserves a pre-v7 vehicle with isArchived absent (restores as active)', () => {
		const preV7: BackupData = {
			...data,
			vehicles: [{ id: 1, name: 'Car', make: 'Honda', model: 'Civic' }]
		};
		const result = parseBackup(serializeBackup(preV7, settings));
		expect(result.error).toBeNull();
		expect(result.data?.data.vehicles[0].isArchived).toBeUndefined();
	});

	// A backup stamped at the previous schema version (6) restores into v7 (forward-compatible).
	it('accepts a backup stamped at schemaVersion 6 (restores into v7)', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: 6,
			exportedAt: new Date().toISOString(),
			data: {
				vehicles: [{ id: 1, name: 'Car', make: 'Honda', model: 'Civic' }],
				fuelLogs: [],
				expenses: [],
				serviceReminders: []
			},
			settings
		});
		const result = parseBackup(json);
		expect(result.error).toBeNull();
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

	it('rejects a backup from a NEWER app version', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION + 1,
			exportedAt: new Date().toISOString(),
			data: { vehicles: [], fuelLogs: [], expenses: [], serviceReminders: [] },
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toMatch(/newer app version/i);
	});

	it('accepts an OLDER-schema backup and restores it (Story 7.1 / AC7 — v4 → v5 round-trip)', () => {
		// A v4 backup predates the isPartialFill / precededByMissedFill fields. It must still restore;
		// the missing flags are simply absent on the revived rows (readers coerce them to false).
		const v4FuelLog = {
			id: 1,
			vehicleId: 1,
			date: new Date('2026-01-01').toISOString(),
			odometer: 10000,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 60,
			calculatedConsumption: 0
			// note: no isPartialFill / precededByMissedFill
		};
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: 4,
			exportedAt: new Date().toISOString(),
			data: {
				vehicles: [{ id: 1, name: 'Car', make: 'Honda', model: 'Civic' }],
				fuelLogs: [v4FuelLog],
				expenses: [],
				serviceReminders: []
			},
			settings
		});
		const result = parseBackup(json);
		expect(result.error).toBeNull();
		expect(result.data?.data.fuelLogs).toHaveLength(1);
		expect(result.data?.data.fuelLogs[0].isPartialFill).toBeUndefined();
		expect(result.data?.data.fuelLogs[0].precededByMissedFill).toBeUndefined();
	});

	it('rejects corrupt schemaVersion values — null / fractional / below the v4 floor (review P4)', () => {
		// `NaN > DB_VERSION` is false, so a plain upper-bound check would ACCEPT a corrupt version
		// (JSON has no NaN literal — a NaN stamp arrives as null, also rejected by the integer gate).
		// The backup feature shipped at DB_VERSION 4, so no legitimate file is stamped lower.
		for (const schemaVersion of [null, 4.5, 3, 0, -1]) {
			const json = JSON.stringify({
				app: BACKUP_APP_ID,
				schemaVersion,
				exportedAt: new Date().toISOString(),
				data: { vehicles: [], fuelLogs: [], expenses: [], serviceReminders: [] },
				settings
			});
			const result = parseBackup(json);
			expect(result.error?.code, `schemaVersion=${schemaVersion}`).toBe('VALIDATION_ERROR');
		}
	});

	it('rejects wrong-typed fill-quality flags on a fuel log (review P6 — ADR-005 §5 gate)', () => {
		// A hand-edited `isPartialFill: "yes"` would survive `?? false` coercion as TRUTHY and
		// silently flag the fill as partial — the validator must reject non-boolean values.
		const badLog = {
			id: 1,
			vehicleId: 1,
			date: new Date('2026-01-01').toISOString(),
			odometer: 10000,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 60,
			calculatedConsumption: 0,
			isPartialFill: 'yes'
		};
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: { vehicles: [], fuelLogs: [badLog], expenses: [], serviceReminders: [] },
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('round-trips a v5 backup with the fill-quality flags SET (review P6 — ADR-005 mandate)', () => {
		const flaggedData: BackupData = {
			...data,
			fuelLogs: [
				{ ...data.fuelLogs[0], isPartialFill: true, precededByMissedFill: false },
				{
					...data.fuelLogs[0],
					id: 11,
					odometer: 1400,
					calculatedConsumption: 0,
					isPartialFill: false,
					precededByMissedFill: true
				}
			]
		};
		const result = parseBackup(serializeBackup(flaggedData, settings));
		expect(result.error).toBeNull();
		expect(result.data?.data.fuelLogs[0].isPartialFill).toBe(true);
		expect(result.data?.data.fuelLogs[0].precededByMissedFill).toBe(false);
		expect(result.data?.data.fuelLogs[1].isPartialFill).toBe(false);
		expect(result.data?.data.fuelLogs[1].precededByMissedFill).toBe(true);
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

	it('rejects an unpaired L+mi fuel log (ADR-006 AD-WB-2 pairing gate)', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: {
				vehicles: [{ id: 1, name: 'Car', make: 'Honda', model: 'Civic' }],
				fuelLogs: [
					{
						id: 1,
						vehicleId: 1,
						date: new Date('2026-01-01').toISOString(),
						odometer: 1000,
						quantity: 40,
						unit: 'L',
						distanceUnit: 'mi',
						totalCost: 60,
						calculatedConsumption: 0
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

	it.each([NaN, Infinity, -Infinity, -1, 0])(
		'rejects a fuel log with odometer=%s (NaN/±Infinity/negative/zero numerics)',
		(odometer) => {
			const json = JSON.stringify({
				app: BACKUP_APP_ID,
				schemaVersion: DB_VERSION,
				exportedAt: new Date().toISOString(),
				data: {
					vehicles: [{ id: 1, name: 'Car', make: 'Honda', model: 'Civic' }],
					fuelLogs: [
						{
							id: 1,
							vehicleId: 1,
							date: new Date('2026-01-01').toISOString(),
							odometer,
							quantity: 40,
							unit: 'L',
							distanceUnit: 'km',
							totalCost: 60,
							calculatedConsumption: 0
						}
					],
					expenses: [],
					serviceReminders: []
				},
				settings
			});
			// JSON has no NaN/Infinity literal — it round-trips as `null`, which the number checks
			// reject just as surely as the finite guard rejects a literal Infinity from a hand-edit.
			const result = parseBackup(json);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		}
	);

	it('rejects an empty-string vehicle name (empty strings)', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: {
				vehicles: [{ id: 1, name: '', make: 'Honda', model: 'Civic' }],
				fuelLogs: [],
				expenses: [],
				serviceReminders: []
			},
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
	});

	it('rejects a dangling vehicleId (fuel log references a vehicle absent from the file)', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: {
				vehicles: [{ id: 1, name: 'Car', make: 'Honda', model: 'Civic' }],
				fuelLogs: [
					{
						id: 1,
						vehicleId: 99,
						date: new Date('2026-01-01').toISOString(),
						odometer: 1000,
						quantity: 40,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 60,
						calculatedConsumption: 0
					}
				],
				expenses: [],
				serviceReminders: []
			},
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toMatch(/does not exist in this backup/i);
	});

	it('rejects more than MAX_VEHICLES vehicles', () => {
		const vehicles = Array.from({ length: MAX_VEHICLES + 1 }, (_, i) => ({
			id: i + 1,
			name: `Car ${i + 1}`,
			make: 'Honda',
			model: 'Civic'
		}));
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: { vehicles, fuelLogs: [], expenses: [], serviceReminders: [] },
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toMatch(/cannot contain more than/i);
	});

	// AC8/AD-VA-4: the cap counts ACTIVE vehicles only. A backup with MAX_VEHICLES active + N archived
	// vehicles imports cleanly — archived rows never occupy a slot.
	it('accepts MAX_VEHICLES active vehicles PLUS archived ones (active-only cap)', () => {
		const active = Array.from({ length: MAX_VEHICLES }, (_, i) => ({
			id: i + 1,
			name: `Active ${i + 1}`,
			make: 'Honda',
			model: 'Civic',
			isArchived: false
		}));
		const archived = Array.from({ length: 3 }, (_, i) => ({
			id: MAX_VEHICLES + i + 1,
			name: `Archived ${i + 1}`,
			make: 'Ford',
			model: 'Focus',
			isArchived: true,
			archivedAt: 1000
		}));
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: {
				vehicles: [...active, ...archived],
				fuelLogs: [],
				expenses: [],
				serviceReminders: []
			},
			settings
		});
		const result = parseBackup(json);
		expect(result.error).toBeNull();
		expect(result.data?.data.vehicles).toHaveLength(MAX_VEHICLES + 3);
	});

	it('still rejects MORE than MAX_VEHICLES ACTIVE vehicles even when archived ones are present', () => {
		const active = Array.from({ length: MAX_VEHICLES + 1 }, (_, i) => ({
			id: i + 1,
			name: `Active ${i + 1}`,
			make: 'Honda',
			model: 'Civic',
			isArchived: false
		}));
		const archived = [
			{ id: 100, name: 'Archived', make: 'Ford', model: 'Focus', isArchived: true, archivedAt: 1 }
		];
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: {
				vehicles: [...active, ...archived],
				fuelLogs: [],
				expenses: [],
				serviceReminders: []
			},
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toMatch(/cannot contain more than/i);
	});

	it('rejects two fuel logs sharing an id — bulkPut would silently overwrite one with the other', () => {
		const json = JSON.stringify({
			app: BACKUP_APP_ID,
			schemaVersion: DB_VERSION,
			exportedAt: new Date().toISOString(),
			data: {
				vehicles: [{ id: 1, name: 'Car', make: 'Honda', model: 'Civic' }],
				fuelLogs: [
					{
						id: 5,
						vehicleId: 1,
						date: new Date('2026-01-01').toISOString(),
						odometer: 1000,
						quantity: 40,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 60,
						calculatedConsumption: 0
					},
					{
						id: 5,
						vehicleId: 1,
						date: new Date('2026-01-05').toISOString(),
						odometer: 1400,
						quantity: 38,
						unit: 'L',
						distanceUnit: 'km',
						totalCost: 55,
						calculatedConsumption: 5
					}
				],
				expenses: [],
				serviceReminders: []
			},
			settings
		});
		const result = parseBackup(json);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toMatch(/more than one row with id/i);
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
