import type { Transaction } from 'dexie';
import type { FuelLog } from '../schema';

type LegacyFuelLog = Omit<FuelLog, 'distanceUnit'> & {
	distanceUnit?: FuelLog['distanceUnit'];
};

export async function migrateV1ToV2(transaction: Transaction) {
	const fuelLogs = transaction.table<LegacyFuelLog, number>('fuelLogs');

	await fuelLogs.toCollection().modify((log) => {
		if (log.distanceUnit) {
			return;
		}

		log.distanceUnit = log.unit === 'gal' ? 'mi' : 'km';
	});
}
