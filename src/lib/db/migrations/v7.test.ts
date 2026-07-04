// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie, { type EntityTable } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateV1ToV2 } from './v2';
import { migrateV2ToV3 } from './v3';
import { migrateV4ToV5 } from './v5';
import { migrateV5ToV6 } from './v6';
import { migrateV6ToV7 } from './v7';
import type { FuelLog, ServiceReminder, Vehicle } from '../schema';

const SCHEMA_V3 = {
	vehicles: '++id, name, make, model, year',
	fuelLogs: '++id, vehicleId, date, odometer',
	expenses: '++id, vehicleId, date, type, odometer'
};
const SCHEMA_V4 = { ...SCHEMA_V3, serviceReminders: '++id, vehicleId' };

const openDatabases = new Set<Dexie>();

class V6DB extends Dexie {
	vehicles!: EntityTable<Vehicle, 'id'>;
	fuelLogs!: EntityTable<FuelLog, 'id'>;
	serviceReminders!: EntityTable<ServiceReminder, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores(SCHEMA_V3);
		this.version(2).stores(SCHEMA_V3).upgrade(migrateV1ToV2);
		this.version(3).stores(SCHEMA_V3).upgrade(migrateV2ToV3);
		this.version(4).stores(SCHEMA_V4);
		this.version(5).stores(SCHEMA_V4).upgrade(migrateV4ToV5);
		this.version(6).stores(SCHEMA_V4).upgrade(migrateV5ToV6);
	}
}

class V7DB extends Dexie {
	vehicles!: EntityTable<Vehicle, 'id'>;
	fuelLogs!: EntityTable<FuelLog, 'id'>;
	serviceReminders!: EntityTable<ServiceReminder, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores(SCHEMA_V3);
		this.version(2).stores(SCHEMA_V3).upgrade(migrateV1ToV2);
		this.version(3).stores(SCHEMA_V3).upgrade(migrateV2ToV3);
		this.version(4).stores(SCHEMA_V4);
		this.version(5).stores(SCHEMA_V4).upgrade(migrateV4ToV5);
		this.version(6).stores(SCHEMA_V4).upgrade(migrateV5ToV6);
		this.version(7).stores(SCHEMA_V4).upgrade(migrateV6ToV7);
	}
}

function trackDb<T extends Dexie>(db: T): T {
	openDatabases.add(db);
	return db;
}

function createDbName() {
	return `passanger-v7-migration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

afterEach(async () => {
	for (const db of openDatabases) {
		db.close();
		await db.delete();
	}
	openDatabases.clear();
});

describe('migrateV6ToV7', () => {
	it('backfills isArchived to false on existing vehicles, leaving archivedAt unset', async () => {
		const dbName = createDbName();
		const v6 = trackDb(new V6DB(dbName));
		await v6.open();
		await v6.vehicles.add({ name: 'My Honda', make: 'Honda', model: 'Civic' } as Vehicle);
		v6.close();

		const v7 = trackDb(new V7DB(dbName));
		await v7.open();

		const [vehicle] = await v7.vehicles.toArray();
		expect(vehicle?.isArchived).toBe(false);
		expect(vehicle?.archivedAt).toBeUndefined();
	});

	it('leaves a row that already carries isArchived untouched (idempotent)', async () => {
		const dbName = createDbName();
		const v6 = trackDb(new V6DB(dbName));
		await v6.open();
		await v6.vehicles.add({
			name: 'Archived car',
			make: 'Toyota',
			model: 'Corolla',
			isArchived: true,
			archivedAt: 12345
		} as Vehicle);
		v6.close();

		const v7 = trackDb(new V7DB(dbName));
		await v7.open();

		const [vehicle] = await v7.vehicles.toArray();
		expect(vehicle?.isArchived).toBe(true);
		expect(vehicle?.archivedAt).toBe(12345);
	});

	it('leaves child tables (fuelLogs / serviceReminders) untouched', async () => {
		const dbName = createDbName();
		const v6 = trackDb(new V6DB(dbName));
		await v6.open();
		const vehicleId = (await v6.vehicles.add({
			name: 'Car',
			make: 'Mazda',
			model: '3'
		} as Vehicle)) as number;
		await v6.fuelLogs.add({
			vehicleId,
			date: new Date('2025-01-01'),
			odometer: 10000,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 60,
			calculatedConsumption: 6
		} as FuelLog);
		v6.close();

		const v7 = trackDb(new V7DB(dbName));
		await v7.open();

		const logs = await v7.fuelLogs.toArray();
		expect(logs).toHaveLength(1);
		expect(logs[0]?.vehicleId).toBe(vehicleId);
	});
});
