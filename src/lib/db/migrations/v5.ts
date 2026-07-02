import type { Transaction } from 'dexie';

// v5 (Story 7.1, Data Quality) — add `isPartialFill` / `precededByMissedFill` to fuelLogs.
//
// Both are non-indexed additive booleans (the schema strings in db.ts are unchanged). Existing
// rows predate the missed/partial concept, so the lossless interpretation is `false` on both:
// every legacy fill was a full fill with no missed predecessor. Backfilling makes the stored data
// self-describing; readers still coerce `?? false` as a belt-and-braces guard (e.g. rows restored
// from a v4 backup, which bypass this upgrade).
//
// Idempotent: only writes when a flag is missing, so a repeated upgrade run is a no-op. Mirrors the
// v3 currency backfill pattern.
export async function migrateV4ToV5(transaction: Transaction) {
	await transaction
		.table<{ isPartialFill?: boolean; precededByMissedFill?: boolean }, number>('fuelLogs')
		.toCollection()
		.modify((log) => {
			if (log.isPartialFill == null) {
				log.isPartialFill = false;
			}
			if (log.precededByMissedFill == null) {
				log.precededByMissedFill = false;
			}
		});
}
