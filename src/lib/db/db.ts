import Dexie, { type EntityTable } from 'dexie';
import { DB_NAME } from '$lib/config';
import type { Vehicle, FuelLog, Expense, ServiceReminder } from './schema';
import { migrateV1ToV2 } from './migrations/v2';
import { migrateV2ToV3 } from './migrations/v3';

class PassangerDB extends Dexie {
	vehicles!: EntityTable<Vehicle, 'id'>;
	fuelLogs!: EntityTable<FuelLog, 'id'>;
	expenses!: EntityTable<Expense, 'id'>;
	serviceReminders!: EntityTable<ServiceReminder, 'id'>;

	constructor() {
		super(DB_NAME);

		// Version 1 — Baseline schema
		this.version(1).stores({
			// Only indexed fields listed here — non-indexed fields stored automatically
			vehicles: '++id, name, make, model, year',
			fuelLogs: '++id, vehicleId, date, odometer',
			expenses: '++id, vehicleId, date, type, odometer'
		});

		// Version 2 — Add distanceUnit field to FuelLog
		// FIX #13 (Pass 13): Backfill distanceUnit based on unit field for consistency
		this.version(2)
			.stores({
				vehicles: '++id, name, make, model, year',
				fuelLogs: '++id, vehicleId, date, odometer',
				expenses: '++id, vehicleId, date, type, odometer'
			})
			.upgrade(migrateV1ToV2);

		// Version 3 — Add per-entry `currency` to fuelLogs and expenses.
		// Schema strings are unchanged (currency is not indexed); the upgrade backfills
		// existing rows from the user's home currency.
		this.version(3)
			.stores({
				vehicles: '++id, name, make, model, year',
				fuelLogs: '++id, vehicleId, date, odometer',
				expenses: '++id, vehicleId, date, type, odometer'
			})
			.upgrade(migrateV2ToV3);

		// Version 4 — Add the `serviceReminders` store. This is a brand-new empty table, so
		// no upgrade function is required; existing tables are re-declared unchanged and
		// their data carries forward automatically.
		this.version(4).stores({
			vehicles: '++id, name, make, model, year',
			fuelLogs: '++id, vehicleId, date, odometer',
			expenses: '++id, vehicleId, date, type, odometer',
			serviceReminders: '++id, vehicleId'
		});
	}
}

export const db = new PassangerDB();
