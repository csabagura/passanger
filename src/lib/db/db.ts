import Dexie, { type EntityTable } from 'dexie';

// Re-export Dexie's `liveQuery` from inside the db boundary so reactive read adapters
// (state/liveQuery.svelte.ts, AD-4) can subscribe to storage-mutation events without
// importing `dexie` directly — eslint hard-errors on `dexie` imports outside src/lib/db/**.
// Keeping the raw import here preserves the "Dexie is isolated to the db layer" invariant.
export { liveQuery } from 'dexie';
import { DB_NAME } from '$lib/config';
import type { Vehicle, FuelLog, Expense, ServiceReminder } from './schema';
import { migrateV1ToV2 } from './migrations/v2';
import { migrateV2ToV3 } from './migrations/v3';
import { migrateV4ToV5 } from './migrations/v5';
import { migrateV5ToV6 } from './migrations/v6';
import { migrateV6ToV7 } from './migrations/v7';

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

		// Version 5 (Story 7.1, Data Quality) — add `isPartialFill` / `precededByMissedFill` to
		// fuelLogs. The flags are NOT indexed (never queried by key — the timeline engine reads them
		// in-memory), so the schema strings are re-declared verbatim; the upgrade backfills existing
		// rows to `false`. See ADR-005 and migrations/v5.ts.
		this.version(5)
			.stores({
				vehicles: '++id, name, make, model, year',
				fuelLogs: '++id, vehicleId, date, odometer',
				expenses: '++id, vehicleId, date, type, odometer',
				serviceReminders: '++id, vehicleId'
			})
			.upgrade(migrateV4ToV5);

		// Version 6 (Story 8.5, ADR-007) — add `createdAt` / `distanceUnit` / `lastClosedByExpenseId`
		// to serviceReminders. None of the three is indexed, so the schema strings are re-declared
		// verbatim; the upgrade backfills existing rows. See ADR-007 and migrations/v6.ts.
		this.version(6)
			.stores({
				vehicles: '++id, name, make, model, year',
				fuelLogs: '++id, vehicleId, date, odometer',
				expenses: '++id, vehicleId, date, type, odometer',
				serviceReminders: '++id, vehicleId'
			})
			.upgrade(migrateV5ToV6);

		// Version 7 (Story 9.2, ADR-008) — add `isArchived` / `archivedAt` to vehicles for archive &
		// restore. Neither is indexed, so the schema strings are re-declared verbatim; the upgrade
		// backfills existing rows to `isArchived = false`. See ADR-008 and migrations/v7.ts.
		this.version(7)
			.stores({
				vehicles: '++id, name, make, model, year',
				fuelLogs: '++id, vehicleId, date, odometer',
				expenses: '++id, vehicleId, date, type, odometer',
				serviceReminders: '++id, vehicleId'
			})
			.upgrade(migrateV6ToV7);
	}
}

export const db = new PassangerDB();
