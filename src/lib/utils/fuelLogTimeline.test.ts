import { describe, expect, it } from 'vitest';
import type { FuelLog } from '$lib/db/schema';
import {
	buildFuelLogDeletionPlan,
	buildFuelLogUpdatePlan,
	getFuelLogPredecessor,
	recalculateFuelLogConsumptions,
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
		notes: overrides.notes ?? '',
		isPartialFill: overrides.isPartialFill ?? false,
		precededByMissedFill: overrides.precededByMissedFill ?? false
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

describe('fuelLogTimeline — missed & partial fills (Story 7.1)', () => {
	// Helper: consumption by id after the engine walk, rounded to 3dp for readable assertions.
	function consumptionsById(logs: FuelLog[]): Record<number, number> {
		const out: Record<number, number> = {};
		for (const log of recalculateFuelLogConsumptions(logs)) {
			out[log.id] = Math.round(log.calculatedConsumption * 1000) / 1000;
		}
		return out;
	}

	it('is identical to the plain full-to-full calc when no flags are set (back-compat)', () => {
		const logs = [
			createFuelLog({ id: 1, date: new Date('2026-03-09'), odometer: 1000, quantity: 40 }),
			createFuelLog({ id: 2, date: new Date('2026-03-10'), odometer: 1500, quantity: 40 })
		];
		// First entry 0; second = (40 / 500) * 100 = 8.
		expect(consumptionsById(logs)).toEqual({ 1: 0, 2: 8 });
	});

	it('defers a partial fill and accumulates its litres into the next full fill span', () => {
		const logs = [
			createFuelLog({ id: 1, date: new Date('2026-03-09'), odometer: 1000, quantity: 40 }),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10'),
				odometer: 1200,
				quantity: 10,
				isPartialFill: true
			}),
			createFuelLog({ id: 3, date: new Date('2026-03-11'), odometer: 1500, quantity: 30 })
		];
		// Partial → 0; full fill spans anchor(1000)→1500 with litres 10 + 30 = 40: (40/500)*100 = 8.
		expect(consumptionsById(logs)).toEqual({ 1: 0, 2: 0, 3: 8 });
	});

	it('accumulates across consecutive partials before the next full fill', () => {
		const logs = [
			createFuelLog({ id: 1, date: new Date('2026-03-09'), odometer: 1000, quantity: 40 }),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10'),
				odometer: 1100,
				quantity: 5,
				isPartialFill: true
			}),
			createFuelLog({
				id: 3,
				date: new Date('2026-03-11'),
				odometer: 1200,
				quantity: 5,
				isPartialFill: true
			}),
			createFuelLog({ id: 4, date: new Date('2026-03-12'), odometer: 1600, quantity: 30 })
		];
		// Two partials → 0; full spans 1000→1600 with 5 + 5 + 30 = 40 litres: (40/600)*100 = 6.667.
		expect(consumptionsById(logs)).toEqual({ 1: 0, 2: 0, 3: 0, 4: 6.667 });
	});

	it('excludes a missed-preceded interval (0) and re-anchors the span at that fill', () => {
		const logs = [
			createFuelLog({ id: 1, date: new Date('2026-03-09'), odometer: 1000, quantity: 40 }),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10'),
				odometer: 1400,
				quantity: 40,
				precededByMissedFill: true
			}),
			createFuelLog({ id: 3, date: new Date('2026-03-11'), odometer: 1800, quantity: 36 })
		];
		// Missed interval → 0; next full measures from the re-anchor (1400): (36/400)*100 = 9.
		expect(consumptionsById(logs)).toEqual({ 1: 0, 2: 0, 3: 9 });
	});

	it('handles a fill that is both missed-preceded and partial (re-anchor + carry its litres)', () => {
		const logs = [
			createFuelLog({ id: 1, date: new Date('2026-03-09'), odometer: 1000, quantity: 40 }),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10'),
				odometer: 1400,
				quantity: 10,
				precededByMissedFill: true,
				isPartialFill: true
			}),
			createFuelLog({ id: 3, date: new Date('2026-03-11'), odometer: 1800, quantity: 30 })
		];
		// id2 → 0 and re-anchors at 1400 carrying its 10 litres; id3 = ((10+30)/400)*100 = 10.
		expect(consumptionsById(logs)).toEqual({ 1: 0, 2: 0, 3: 10 });
	});

	it('a forgotten tank flagged as missed no longer reports a false-low number (regression)', () => {
		// Without the flag, driving 1000 km on a single logged 40 L tank reads (40/1000)*100 = 4
		// L/100km — implausibly efficient (a whole tank went unlogged). Flagging the fill as
		// missed-preceded zeroes the interval so it drops out of trends via the existing > 0 filter.
		const naive = [
			createFuelLog({ id: 1, date: new Date('2026-03-09'), odometer: 1000, quantity: 40 }),
			createFuelLog({ id: 2, date: new Date('2026-03-10'), odometer: 2000, quantity: 40 })
		];
		expect(consumptionsById(naive)[2]).toBe(4); // the false-low value

		const flagged = [
			naive[0],
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10'),
				odometer: 2000,
				quantity: 40,
				precededByMissedFill: true
			})
		];
		expect(consumptionsById(flagged)[2]).toBe(0); // excluded, not false-low
	});
});
