import type { Transaction } from 'dexie';

// v7 (Story 9.2, ADR-008) — add `isArchived` / `archivedAt` to vehicles for archive & restore.
//
// Both are non-indexed additive fields (the schema strings in db.ts are unchanged). Existing rows
// predate the archive concept, so the lossless interpretation is `isArchived = false`: every legacy
// vehicle is active. Backfilling makes the stored data self-describing; readers still coerce an
// absent value to active (e.g. rows restored from a pre-v7 backup, which bypass this upgrade).
//
// `archivedAt` is NOT backfilled — an active vehicle has no archive timestamp; it is set only when a
// vehicle is archived and cleared (undefined) again on restore.
//
// Idempotent: only writes `isArchived` when it is currently absent, so a repeated upgrade run is a
// no-op. Mirrors the v3/v5 backfill pattern.
export async function migrateV6ToV7(transaction: Transaction) {
	await transaction
		.table<{ isArchived?: boolean }, number>('vehicles')
		.toCollection()
		.modify((vehicle) => {
			if (vehicle.isArchived == null) {
				vehicle.isArchived = false;
			}
		});
}
