// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie, { type EntityTable } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateV1ToV2 } from './v2';
import { migrateV2ToV3 } from './v3';
import type { FuelLog, ServiceReminder } from '../schema';

const V3_SCHEMA = {
	vehicles: '++id, name, make, model, year',
	fuelLogs: '++id, vehicleId, date, odometer',
	expenses: '++id, vehicleId, date, type, odometer'
};

const V4_SCHEMA = {
	...V3_SCHEMA,
	serviceReminders: '++id, vehicleId'
};

const openDatabases = new Set<Dexie>();

class V3DB extends Dexie {
	fuelLogs!: EntityTable<FuelLog, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores(V3_SCHEMA);
		this.version(2).stores(V3_SCHEMA).upgrade(migrateV1ToV2);
		this.version(3).stores(V3_SCHEMA).upgrade(migrateV2ToV3);
	}
}

class V4DB extends Dexie {
	fuelLogs!: EntityTable<FuelLog, 'id'>;
	serviceReminders!: EntityTable<ServiceReminder, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores(V3_SCHEMA);
		this.version(2).stores(V3_SCHEMA).upgrade(migrateV1ToV2);
		this.version(3).stores(V3_SCHEMA).upgrade(migrateV2ToV3);
		this.version(4).stores(V4_SCHEMA);
	}
}

function trackDb<T extends Dexie>(db: T): T {
	openDatabases.add(db);
	return db;
}

function createDbName() {
	return `passanger-v4-migration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

afterEach(async () => {
	for (const db of openDatabases) {
		db.close();
		await db.delete();
	}
	openDatabases.clear();
});

describe('v4 migration — add serviceReminders store', () => {
	it('adds a usable serviceReminders table while preserving existing fuel logs', async () => {
		const dbName = createDbName();

		// Open at v3 and seed a fuel log.
		const v3 = trackDb(new V3DB(dbName));
		await v3.open();
		await v3.fuelLogs.add({
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
		v3.close();

		// Re-open at v4 — schema upgrade adds the new store.
		const v4 = trackDb(new V4DB(dbName));
		await v4.open();

		// The pre-existing fuel log survives the upgrade unchanged.
		const logs = await v4.fuelLogs.toArray();
		expect(logs).toHaveLength(1);
		expect(logs[0].odometer).toBe(50000);

		// The serviceReminders table now exists and starts empty.
		expect(v4.tables.map((t) => t.name)).toContain('serviceReminders');
		expect(await v4.serviceReminders.count()).toBe(0);

		// And it is usable: insert + read back via its indexed vehicleId.
		const id = await v4.serviceReminders.add({
			vehicleId: 1,
			title: 'Oil change',
			intervalKm: 10000
		} as ServiceReminder);
		const stored = await v4.serviceReminders.get(id as number);
		expect(stored?.title).toBe('Oil change');

		const forVehicle = await v4.serviceReminders.where('vehicleId').equals(1).toArray();
		expect(forVehicle).toHaveLength(1);
	});

	it('opens a fresh database directly at v4 with the serviceReminders store available', async () => {
		const dbName = createDbName();
		const v4 = trackDb(new V4DB(dbName));
		await v4.open();

		expect(v4.verno).toBe(4);
		expect(v4.tables.map((t) => t.name)).toContain('serviceReminders');
		expect(await v4.serviceReminders.count()).toBe(0);
	});
});
