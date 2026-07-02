// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie, { type EntityTable } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateV1ToV2 } from './v2';
import { migrateV2ToV3 } from './v3';
import { migrateV4ToV5 } from './v5';
import type { FuelLog } from '../schema';

const SCHEMA_V3 = {
	vehicles: '++id, name, make, model, year',
	fuelLogs: '++id, vehicleId, date, odometer',
	expenses: '++id, vehicleId, date, type, odometer'
};
const SCHEMA_V4 = { ...SCHEMA_V3, serviceReminders: '++id, vehicleId' };

const openDatabases = new Set<Dexie>();

class V4DB extends Dexie {
	fuelLogs!: EntityTable<FuelLog, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores(SCHEMA_V3);
		this.version(2).stores(SCHEMA_V3).upgrade(migrateV1ToV2);
		this.version(3).stores(SCHEMA_V3).upgrade(migrateV2ToV3);
		this.version(4).stores(SCHEMA_V4);
	}
}

class V5DB extends Dexie {
	fuelLogs!: EntityTable<FuelLog, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores(SCHEMA_V3);
		this.version(2).stores(SCHEMA_V3).upgrade(migrateV1ToV2);
		this.version(3).stores(SCHEMA_V3).upgrade(migrateV2ToV3);
		this.version(4).stores(SCHEMA_V4);
		this.version(5).stores(SCHEMA_V4).upgrade(migrateV4ToV5);
	}
}

function trackDb<T extends Dexie>(db: T): T {
	openDatabases.add(db);
	return db;
}

function createDbName() {
	return `passanger-v5-migration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

afterEach(async () => {
	for (const db of openDatabases) {
		db.close();
		await db.delete();
	}
	openDatabases.clear();
});

describe('migrateV4ToV5', () => {
	it('backfills isPartialFill and precededByMissedFill to false on existing fuel logs', async () => {
		const dbName = createDbName();
		const v4 = trackDb(new V4DB(dbName));
		await v4.open();
		await v4.fuelLogs.add({
			vehicleId: 1,
			date: new Date('2025-01-10'),
			odometer: 50000,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 70,
			calculatedConsumption: 7,
			currency: '€'
		} as FuelLog);
		v4.close();

		const v5 = trackDb(new V5DB(dbName));
		await v5.open();

		const [log] = await v5.fuelLogs.toArray();
		expect(log?.isPartialFill).toBe(false);
		expect(log?.precededByMissedFill).toBe(false);
		// Additive migration must not disturb existing fields.
		expect(log?.calculatedConsumption).toBe(7);
		expect(log?.currency).toBe('€');
	});

	it('leaves rows that already carry the flags untouched (idempotent)', async () => {
		const dbName = createDbName();
		const v4 = trackDb(new V4DB(dbName));
		await v4.open();
		await v4.fuelLogs.add({
			vehicleId: 1,
			date: new Date('2025-01-10'),
			odometer: 50000,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 70,
			calculatedConsumption: 0,
			currency: '€',
			isPartialFill: true,
			precededByMissedFill: true
		} as FuelLog);
		v4.close();

		const v5 = trackDb(new V5DB(dbName));
		await v5.open();

		const [log] = await v5.fuelLogs.toArray();
		expect(log?.isPartialFill).toBe(true);
		expect(log?.precededByMissedFill).toBe(true);
	});
});
