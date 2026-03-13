// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie, { type EntityTable } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateV1ToV2 } from './v2';
import type { FuelLog } from '../schema';

type LegacyFuelLog = Omit<FuelLog, 'distanceUnit'> & {
	distanceUnit?: FuelLog['distanceUnit'];
};

const SCHEMA = {
	vehicles: '++id, name, make, model, year',
	fuelLogs: '++id, vehicleId, date, odometer',
	expenses: '++id, vehicleId, date, type, odometer'
};

const openDatabases = new Set<Dexie>();

class MigrationTestV1DB extends Dexie {
	fuelLogs!: EntityTable<LegacyFuelLog, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores(SCHEMA);
	}
}

class MigrationTestV2DB extends Dexie {
	fuelLogs!: EntityTable<LegacyFuelLog, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores(SCHEMA);
		this.version(2).stores(SCHEMA).upgrade(migrateV1ToV2);
	}
}

function trackDb<T extends Dexie>(db: T): T {
	openDatabases.add(db);
	return db;
}

function createDbName() {
	return `passanger-v2-migration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

afterEach(async () => {
	for (const db of openDatabases) {
		db.close();
		await db.delete();
	}

	openDatabases.clear();
});

describe('migrateV1ToV2', () => {
	it('backfills distanceUnit during a real v1 to v2 upgrade', async () => {
		const dbName = createDbName();
		const v1 = trackDb(new MigrationTestV1DB(dbName));

		await v1.open();
		await v1.fuelLogs.bulkAdd([
			{
				vehicleId: 1,
				date: new Date('2025-01-10'),
				odometer: 50000,
				quantity: 40,
				unit: 'L',
				totalCost: 70,
				calculatedConsumption: 7,
				notes: 'city fill'
			},
			{
				vehicleId: 1,
				date: new Date('2025-01-11'),
				odometer: 31000,
				quantity: 10,
				unit: 'gal',
				totalCost: 35,
				calculatedConsumption: 31,
				notes: 'highway fill'
			}
		]);
		v1.close();

		const v2 = trackDb(new MigrationTestV2DB(dbName));
		await v2.open();

		const logs = (await v2.fuelLogs.toArray()).sort(
			(left, right) => left.odometer - right.odometer
		);

		expect(logs).toHaveLength(2);
		expect(logs[0]?.unit).toBe('gal');
		expect(logs[0]?.distanceUnit).toBe('mi');
		expect(logs[1]?.unit).toBe('L');
		expect(logs[1]?.distanceUnit).toBe('km');
	});

	it('does not rewrite an existing unit pairing during migration', async () => {
		const dbName = createDbName();
		const v1 = trackDb(new MigrationTestV1DB(dbName));

		await v1.open();
		await v1.fuelLogs.add({
			vehicleId: 1,
			date: new Date('2025-01-12'),
			odometer: 42000,
			quantity: 38,
			unit: 'L',
			distanceUnit: 'mi',
			totalCost: 66,
			calculatedConsumption: 6.8,
			notes: 'legacy data with unexpected pairing'
		});
		v1.close();

		const v2 = trackDb(new MigrationTestV2DB(dbName));
		await v2.open();

		const [log] = await v2.fuelLogs.toArray();

		expect(log?.unit).toBe('L');
		expect(log?.distanceUnit).toBe('mi');
	});
});
