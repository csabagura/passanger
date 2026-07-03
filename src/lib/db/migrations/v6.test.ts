// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie, { type EntityTable } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateV1ToV2 } from './v2';
import { migrateV2ToV3 } from './v3';
import { migrateV4ToV5 } from './v5';
import { migrateV5ToV6 } from './v6';
import type { FuelLog, ServiceReminder } from '../schema';

const SCHEMA_V3 = {
	vehicles: '++id, name, make, model, year',
	fuelLogs: '++id, vehicleId, date, odometer',
	expenses: '++id, vehicleId, date, type, odometer'
};
const SCHEMA_V4 = { ...SCHEMA_V3, serviceReminders: '++id, vehicleId' };

const openDatabases = new Set<Dexie>();

class V5DB extends Dexie {
	fuelLogs!: EntityTable<FuelLog, 'id'>;
	serviceReminders!: EntityTable<ServiceReminder, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores(SCHEMA_V3);
		this.version(2).stores(SCHEMA_V3).upgrade(migrateV1ToV2);
		this.version(3).stores(SCHEMA_V3).upgrade(migrateV2ToV3);
		this.version(4).stores(SCHEMA_V4);
		this.version(5).stores(SCHEMA_V4).upgrade(migrateV4ToV5);
	}
}

class V6DB extends Dexie {
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

function trackDb<T extends Dexie>(db: T): T {
	openDatabases.add(db);
	return db;
}

function createDbName() {
	return `passanger-v6-migration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

afterEach(async () => {
	for (const db of openDatabases) {
		db.close();
		await db.delete();
	}
	openDatabases.clear();
});

describe('migrateV5ToV6', () => {
	it('backfills createdAt from lastServiceDate.getTime() when present', async () => {
		const dbName = createDbName();
		const v5 = trackDb(new V5DB(dbName));
		await v5.open();
		await v5.serviceReminders.add({
			vehicleId: 1,
			title: 'Oil change',
			intervalKm: 10000,
			lastServiceDate: new Date('2025-06-01')
		} as ServiceReminder);
		v5.close();

		const v6 = trackDb(new V6DB(dbName));
		await v6.open();

		const [reminder] = await v6.serviceReminders.toArray();
		expect(reminder?.createdAt).toBe(new Date('2025-06-01').getTime());
		expect(reminder?.lastClosedByExpenseId).toBeUndefined();
	});

	it('backfills createdAt to migration-time when lastServiceDate is absent', async () => {
		const dbName = createDbName();
		const v5 = trackDb(new V5DB(dbName));
		await v5.open();
		await v5.serviceReminders.add({
			vehicleId: 1,
			title: 'Timing belt',
			intervalDays: 365
		} as ServiceReminder);
		v5.close();

		const before = Date.now();
		const v6 = trackDb(new V6DB(dbName));
		await v6.open();
		const after = Date.now();

		const [reminder] = await v6.serviceReminders.toArray();
		expect(reminder?.createdAt).toBeGreaterThanOrEqual(before);
		expect(reminder?.createdAt).toBeLessThanOrEqual(after);
	});

	it('backfills distanceUnit from the vehicle most-recent fuel log', async () => {
		const dbName = createDbName();
		const v5 = trackDb(new V5DB(dbName));
		await v5.open();
		await v5.fuelLogs.add({
			vehicleId: 1,
			date: new Date('2025-01-01'),
			odometer: 10000,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 60,
			calculatedConsumption: 6
		} as FuelLog);
		await v5.fuelLogs.add({
			vehicleId: 1,
			date: new Date('2025-06-01'),
			odometer: 15000,
			quantity: 10,
			unit: 'gal',
			distanceUnit: 'mi',
			totalCost: 60,
			calculatedConsumption: 25
		} as FuelLog);
		await v5.serviceReminders.add({
			vehicleId: 1,
			title: 'Oil change',
			intervalKm: 10000
		} as ServiceReminder);
		v5.close();

		const v6 = trackDb(new V6DB(dbName));
		await v6.open();

		const [reminder] = await v6.serviceReminders.toArray();
		// The most-recent (2025-06-01) log's distanceUnit wins, not the earlier one.
		expect(reminder?.distanceUnit).toBe('mi');
	});

	it('leaves distanceUnit undefined when the vehicle has no fuel logs', async () => {
		const dbName = createDbName();
		const v5 = trackDb(new V5DB(dbName));
		await v5.open();
		await v5.serviceReminders.add({
			vehicleId: 1,
			title: 'Oil change',
			intervalKm: 10000
		} as ServiceReminder);
		v5.close();

		const v6 = trackDb(new V6DB(dbName));
		await v6.open();

		const [reminder] = await v6.serviceReminders.toArray();
		expect(reminder?.distanceUnit).toBeUndefined();
	});

	it('leaves rows that already carry the new fields untouched (idempotent)', async () => {
		const dbName = createDbName();
		const v5 = trackDb(new V5DB(dbName));
		await v5.open();
		await v5.serviceReminders.add({
			vehicleId: 1,
			title: 'Oil change',
			intervalKm: 10000,
			createdAt: 12345,
			distanceUnit: 'mi',
			lastClosedByExpenseId: 7
		} as ServiceReminder);
		v5.close();

		const v6 = trackDb(new V6DB(dbName));
		await v6.open();

		const [reminder] = await v6.serviceReminders.toArray();
		expect(reminder?.createdAt).toBe(12345);
		expect(reminder?.distanceUnit).toBe('mi');
		expect(reminder?.lastClosedByExpenseId).toBe(7);
	});

	it('a literal second run of migrateV5ToV6 is a no-op (idempotency proven, not implied)', async () => {
		const dbName = createDbName();
		const v5 = trackDb(new V5DB(dbName));
		await v5.open();
		await v5.serviceReminders.add({
			vehicleId: 1,
			title: 'Oil change',
			intervalKm: 10000,
			lastServiceDate: new Date('2025-06-01')
		} as ServiceReminder);
		v5.close();

		const v6 = trackDb(new V6DB(dbName));
		await v6.open();
		const before = await v6.serviceReminders.toArray();

		await v6.transaction('rw', v6.fuelLogs, v6.serviceReminders, (tx) => migrateV5ToV6(tx));

		const after = await v6.serviceReminders.toArray();
		expect(after).toEqual(before);
	});
});
