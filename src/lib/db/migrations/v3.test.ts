// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie, { type EntityTable } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateV1ToV2 } from './v2';
import { migrateV2ToV3 } from './v3';
import type { FuelLog, Expense } from '../schema';

const SCHEMA = {
	vehicles: '++id, name, make, model, year',
	fuelLogs: '++id, vehicleId, date, odometer',
	expenses: '++id, vehicleId, date, type, odometer'
};

const openDatabases = new Set<Dexie>();

class V2DB extends Dexie {
	fuelLogs!: EntityTable<FuelLog, 'id'>;
	expenses!: EntityTable<Expense, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores(SCHEMA);
		this.version(2).stores(SCHEMA).upgrade(migrateV1ToV2);
	}
}

class V3DB extends Dexie {
	fuelLogs!: EntityTable<FuelLog, 'id'>;
	expenses!: EntityTable<Expense, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores(SCHEMA);
		this.version(2).stores(SCHEMA).upgrade(migrateV1ToV2);
		this.version(3).stores(SCHEMA).upgrade(migrateV2ToV3);
	}
}

function trackDb<T extends Dexie>(db: T): T {
	openDatabases.add(db);
	return db;
}

function createDbName() {
	return `passanger-v3-migration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

afterEach(async () => {
	for (const db of openDatabases) {
		db.close();
		await db.delete();
	}

	openDatabases.clear();
});

describe('migrateV2ToV3', () => {
	it('backfills currency on fuel logs and expenses (home currency, defaulting to € with no settings)', async () => {
		const dbName = createDbName();
		const v2 = trackDb(new V2DB(dbName));
		await v2.open();
		await v2.fuelLogs.add({
			vehicleId: 1,
			date: new Date('2025-01-10'),
			odometer: 50000,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 70,
			calculatedConsumption: 7
		} as FuelLog);
		await v2.expenses.add({
			vehicleId: 1,
			date: new Date('2025-01-11'),
			type: 'Oil Change',
			cost: 50
		} as Expense);
		v2.close();

		const v3 = trackDb(new V3DB(dbName));
		await v3.open();

		const [log] = await v3.fuelLogs.toArray();
		const [expense] = await v3.expenses.toArray();

		expect(log?.currency).toBe('€');
		expect(expense?.currency).toBe('€');
	});

	it('leaves an entry that already has a currency untouched (idempotent)', async () => {
		const dbName = createDbName();
		const v2 = trackDb(new V2DB(dbName));
		await v2.open();
		await v2.fuelLogs.add({
			vehicleId: 1,
			date: new Date('2025-01-10'),
			odometer: 50000,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 70,
			calculatedConsumption: 7,
			currency: 'Ft'
		} as FuelLog);
		v2.close();

		const v3 = trackDb(new V3DB(dbName));
		await v3.open();

		const [log] = await v3.fuelLogs.toArray();
		expect(log?.currency).toBe('Ft');
	});
});
