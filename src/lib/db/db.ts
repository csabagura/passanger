import Dexie, { type EntityTable } from 'dexie';
import { DB_NAME } from '$lib/config';
import type { Vehicle, FuelLog, Expense } from './schema';
import { migrateV1ToV2 } from './migrations/v2';

class PassangerDB extends Dexie {
	vehicles!: EntityTable<Vehicle, 'id'>;
	fuelLogs!: EntityTable<FuelLog, 'id'>;
	expenses!: EntityTable<Expense, 'id'>;

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
	}
}

export const db = new PassangerDB();
