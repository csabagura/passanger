import type { Transaction } from 'dexie';

// v6 (Story 8.5, ADR-007) — add `createdAt` / `distanceUnit` / `lastClosedByExpenseId` to
// serviceReminders.
//
// `createdAt` backfills to `lastServiceDate.getTime()` when present (an existing service record
// is real historical signal and the honest anchor) — `lastServiceDate` is already stored as a
// `Date`, never a string, so this is a direct `.getTime()` read. Otherwise it backfills to
// migration-time (`Date.now()`, captured ONCE for the whole batch, not re-read per row) — a
// reminder with no service history starts counting "since creation" from today rather than
// manufacturing a fictitious past date.
//
// `distanceUnit` backfills from the vehicle's most-recent fuel log's `distanceUnit` (by log
// date); a vehicle with no fuel logs leaves it undefined — the read boundary falls back to the
// vehicle's current display-unit setting, never a guess (ADR-005's design of record).
//
// `lastClosedByExpenseId` is NOT backfilled — no historical loop-close event is reconstructable
// from existing data; it stays undefined on every pre-v6 row, forward-looking only.
//
// Idempotent: only writes a field when it is currently absent, so a repeated upgrade run is a
// no-op. Mirrors the v3/v5 backfill pattern.
export async function migrateV5ToV6(transaction: Transaction) {
	const migrationTimestamp = Date.now();

	const fuelLogs = await transaction
		.table<{ vehicleId: number; date: Date; distanceUnit: 'km' | 'mi' }, number>('fuelLogs')
		.toArray();

	// Most-recent-by-date distanceUnit per vehicle, for backfilling reminders that predate any
	// fuel log of their own.
	const latestDistanceUnitByVehicle = new Map<number, 'km' | 'mi'>();
	const latestTimeByVehicle = new Map<number, number>();
	for (const log of fuelLogs) {
		const time = log.date instanceof Date ? log.date.getTime() : new Date(log.date).getTime();
		const currentLatest = latestTimeByVehicle.get(log.vehicleId);
		if (currentLatest === undefined || time >= currentLatest) {
			latestTimeByVehicle.set(log.vehicleId, time);
			latestDistanceUnitByVehicle.set(log.vehicleId, log.distanceUnit);
		}
	}

	await transaction
		.table<
			{
				vehicleId: number;
				lastServiceDate?: Date;
				createdAt?: number;
				distanceUnit?: 'km' | 'mi';
				lastClosedByExpenseId?: number;
			},
			number
		>('serviceReminders')
		.toCollection()
		.modify((reminder) => {
			if (reminder.createdAt == null) {
				reminder.createdAt = reminder.lastServiceDate
					? reminder.lastServiceDate.getTime()
					: migrationTimestamp;
			}
			if (reminder.distanceUnit == null) {
				const derived = latestDistanceUnitByVehicle.get(reminder.vehicleId);
				if (derived !== undefined) {
					reminder.distanceUnit = derived;
				}
			}
			// lastClosedByExpenseId intentionally left undefined for every pre-v6 row.
		});
}
