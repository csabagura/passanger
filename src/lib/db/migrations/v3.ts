import type { Transaction } from 'dexie';
import { getSettings } from '$lib/utils/settings';
import { DEFAULT_CURRENCY } from '$lib/config';

// v3 — add per-entry `currency` to fuelLogs and expenses.
//
// Backfill existing rows from the user's current home currency (settings), falling back
// to the app default. Before v3 the app applied a single global currency symbol at
// display time, so every existing row was implicitly in the user's current currency —
// backfilling that value is the lossless interpretation.
//
// Idempotent: rows that already carry a non-empty currency are left untouched, so a
// repeated upgrade run is a no-op.
export async function migrateV2ToV3(transaction: Transaction) {
	const homeCurrency = getSettings().currency || DEFAULT_CURRENCY;

	await transaction
		.table<{ currency?: string }, number>('fuelLogs')
		.toCollection()
		.modify((log) => {
			if (log.currency == null || log.currency === '') {
				log.currency = homeCurrency;
			}
		});

	await transaction
		.table<{ currency?: string }, number>('expenses')
		.toCollection()
		.modify((expense) => {
			if (expense.currency == null || expense.currency === '') {
				expense.currency = homeCurrency;
			}
		});
}
