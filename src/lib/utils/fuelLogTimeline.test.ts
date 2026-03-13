import { describe, expect, it } from 'vitest';
import type { FuelLog } from '$lib/db/schema';
import {
	buildFuelLogDeletionPlan,
	buildFuelLogUpdatePlan,
	getFuelLogPredecessor,
	recalculateFuelLogTimeline,
	sortFuelLogsForTimeline
} from './fuelLogTimeline';

function createFuelLog(overrides: Partial<FuelLog>): FuelLog {
	return {
		id: overrides.id ?? 1,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date('2026-03-10T12:00:00Z'),
		odometer: overrides.odometer ?? 100,
		quantity: overrides.quantity ?? 10,
		unit: overrides.unit ?? 'L',
		distanceUnit: overrides.distanceUnit ?? 'km',
		totalCost: overrides.totalCost ?? 20,
		calculatedConsumption: overrides.calculatedConsumption ?? 0,
		notes: overrides.notes ?? ''
	};
}

describe('fuelLogTimeline', () => {
	it('sorts logs by date then id for stable predecessor lookup', () => {
		const logs = [
			createFuelLog({ id: 3, date: new Date('2026-03-12T12:00:00Z') }),
			createFuelLog({ id: 2, date: new Date('2026-03-11T12:00:00Z') }),
			createFuelLog({ id: 1, date: new Date('2026-03-11T12:00:00Z') })
		];

		expect(sortFuelLogsForTimeline(logs).map((log) => log.id)).toEqual([1, 2, 3]);
	});

	it('finds the true chronological predecessor for an edited middle log', () => {
		const logs = [
			createFuelLog({ id: 11, date: new Date('2026-03-09T12:00:00Z'), odometer: 100 }),
			createFuelLog({ id: 12, date: new Date('2026-03-10T12:00:00Z'), odometer: 200 }),
			createFuelLog({ id: 13, date: new Date('2026-03-11T12:00:00Z'), odometer: 300 })
		];

		expect(getFuelLogPredecessor(logs, 12)?.id).toBe(11);
		expect(getFuelLogPredecessor(logs, 11)).toBeUndefined();
	});

	it('recalculates the edited log and later successors in timeline order', () => {
		const logs = [
			createFuelLog({
				id: 1,
				date: new Date('2026-03-09T12:00:00Z'),
				odometer: 100,
				calculatedConsumption: 0
			}),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10T12:00:00Z'),
				odometer: 200,
				calculatedConsumption: 10
			}),
			createFuelLog({
				id: 3,
				date: new Date('2026-03-11T12:00:00Z'),
				odometer: 300,
				calculatedConsumption: 10
			})
		];

		const recalculated = recalculateFuelLogTimeline(
			logs,
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10T12:00:00Z'),
				odometer: 250,
				calculatedConsumption: 10
			})
		);

		expect(recalculated.map((log) => Math.round(log.calculatedConsumption * 10) / 10)).toEqual([
			0, 6.7, 20
		]);
	});

	it('builds update patches for the edited log and any affected later logs', () => {
		const logs = [
			createFuelLog({
				id: 1,
				date: new Date('2026-03-09T12:00:00Z'),
				odometer: 100,
				calculatedConsumption: 0
			}),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10T12:00:00Z'),
				odometer: 200,
				calculatedConsumption: 10
			}),
			createFuelLog({
				id: 3,
				date: new Date('2026-03-11T12:00:00Z'),
				odometer: 300,
				calculatedConsumption: 10
			})
		];

		const patches = buildFuelLogUpdatePlan(
			logs,
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10T12:00:00Z'),
				odometer: 250,
				calculatedConsumption: 10
			})
		);

		expect(patches).toHaveLength(2);
		expect(patches[0]).toMatchObject({
			id: 2,
			changes: {
				odometer: 250,
				unit: 'L',
				distanceUnit: 'km'
			}
		});
		expect(patches[0].changes.calculatedConsumption).toBeCloseTo(6.6666666667);
		expect(patches[1]).toEqual({
			id: 3,
			changes: {
				calculatedConsumption: 20
			}
		});
	});

	it('builds a deletion plan that recalculates the next log after deleting a middle entry', () => {
		const logs = [
			createFuelLog({
				id: 1,
				date: new Date('2026-03-09T12:00:00Z'),
				odometer: 100,
				calculatedConsumption: 0
			}),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10T12:00:00Z'),
				odometer: 200,
				calculatedConsumption: 10
			}),
			createFuelLog({
				id: 3,
				date: new Date('2026-03-11T12:00:00Z'),
				odometer: 300,
				calculatedConsumption: 10
			})
		];

		expect(buildFuelLogDeletionPlan(logs, 2)).toEqual([
			{
				id: 3,
				changes: {
					calculatedConsumption: 5
				}
			}
		]);
	});

	it('builds a deletion plan that makes the new first comparable log pending', () => {
		const logs = [
			createFuelLog({
				id: 1,
				date: new Date('2026-03-09T12:00:00Z'),
				odometer: 100,
				calculatedConsumption: 0
			}),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10T12:00:00Z'),
				odometer: 200,
				calculatedConsumption: 10
			}),
			createFuelLog({
				id: 3,
				date: new Date('2026-03-11T12:00:00Z'),
				odometer: 300,
				calculatedConsumption: 10
			})
		];

		expect(buildFuelLogDeletionPlan(logs, 1)).toEqual([
			{
				id: 2,
				changes: {
					calculatedConsumption: 0
				}
			}
		]);
	});

	it('keeps mixed-unit continuity pending after deletion instead of applying stale math', () => {
		const logs = [
			createFuelLog({
				id: 1,
				date: new Date('2026-03-09T12:00:00Z'),
				odometer: 100,
				unit: 'L',
				distanceUnit: 'km',
				calculatedConsumption: 0
			}),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10T12:00:00Z'),
				odometer: 200,
				unit: 'L',
				distanceUnit: 'km',
				calculatedConsumption: 10
			}),
			createFuelLog({
				id: 3,
				date: new Date('2026-03-11T12:00:00Z'),
				odometer: 300,
				unit: 'gal',
				distanceUnit: 'mi',
				calculatedConsumption: 25
			})
		];

		expect(buildFuelLogDeletionPlan(logs, 2)).toEqual([
			{
				id: 3,
				changes: {
					calculatedConsumption: 0
				}
			}
		]);
	});
});
