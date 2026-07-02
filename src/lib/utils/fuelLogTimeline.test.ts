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
	const log: FuelLog = {
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
	// currency stays absent unless explicitly provided — logs without one exercise the
	// no-currency patch shape (Dexie update() deletes undefined-valued keys).
	if (overrides.currency !== undefined) {
		log.currency = overrides.currency;
	}
	return log;
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

	it('carries a currency-only edit into the updated row patch (H1 regression)', () => {
		const logs = [
			createFuelLog({
				id: 1,
				date: new Date('2026-03-09T12:00:00Z'),
				odometer: 100,
				currency: '€',
				calculatedConsumption: 0
			}),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10T12:00:00Z'),
				odometer: 200,
				currency: '€',
				calculatedConsumption: 10
			})
		];

		// Currency-only edit: identical date/odometer/quantity/cost, only currency differs.
		const patches = buildFuelLogUpdatePlan(
			logs,
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10T12:00:00Z'),
				odometer: 200,
				currency: 'Ft',
				calculatedConsumption: 10
			})
		);

		expect(patches).toHaveLength(1);
		expect(patches[0].id).toBe(2);
		expect(patches[0].changes.currency).toBe('Ft');
	});

	it('omits the currency key from the patch when the edited log carries none', () => {
		const logs = [
			createFuelLog({ id: 1, date: new Date('2026-03-09T12:00:00Z'), odometer: 100 }),
			createFuelLog({ id: 2, date: new Date('2026-03-10T12:00:00Z'), odometer: 200 })
		];

		const patches = buildFuelLogUpdatePlan(
			logs,
			createFuelLog({ id: 2, date: new Date('2026-03-10T12:00:00Z'), odometer: 250 })
		);

		// Dexie update() deletes undefined-valued keys — the key must be absent, not undefined.
		expect(patches[0].id).toBe(2);
		expect('currency' in patches[0].changes).toBe(false);
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

	it('a missed-preceded PARTIAL cannot anchor — 0s until the next full fill (strict AC3, review D1)', () => {
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
			createFuelLog({ id: 3, date: new Date('2026-03-11'), odometer: 1800, quantity: 30 }),
			createFuelLog({ id: 4, date: new Date('2026-03-12'), odometer: 2200, quantity: 32 })
		];
		// id2's tank level is UNKNOWN (partial), so it cannot anchor even though it re-syncs the
		// odometer — a number measured from it could read high or low. id3 (first full fill after the
		// break) → honest 0 and anchors at 1800; id4 = (32/400)*100 = 8.
		expect(consumptionsById(logs)).toEqual({ 1: 0, 2: 0, 3: 0, 4: 8 });
	});

	it('a missed-preceded FULL fill re-anchors, and a SEPARATE later partial accumulates into it', () => {
		const logs = [
			createFuelLog({ id: 1, date: new Date('2026-03-09'), odometer: 1000, quantity: 40 }),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10'),
				odometer: 1400,
				quantity: 40,
				precededByMissedFill: true
			}),
			createFuelLog({
				id: 3,
				date: new Date('2026-03-11'),
				odometer: 1600,
				quantity: 8,
				isPartialFill: true
			}),
			createFuelLog({ id: 4, date: new Date('2026-03-12'), odometer: 1900, quantity: 32 })
		];
		// id2 (missed but FULL — the tank is full, the reading is trustworthy) → 0 and re-anchors at
		// 1400; id3 partial → 0, carries 8 L; id4 spans 1400→1900 with 8 + 32 = 40 L: (40/500)*100 = 8.
		expect(consumptionsById(logs)).toEqual({ 1: 0, 2: 0, 3: 0, 4: 8 });
	});

	it('a partial as the first-ever fill does not anchor — 0s until the first full fill (strict AC3)', () => {
		const logs = [
			createFuelLog({
				id: 1,
				date: new Date('2026-03-09'),
				odometer: 1000,
				quantity: 10,
				isPartialFill: true
			}),
			createFuelLog({ id: 2, date: new Date('2026-03-10'), odometer: 1400, quantity: 40 }),
			createFuelLog({ id: 3, date: new Date('2026-03-11'), odometer: 1900, quantity: 35 })
		];
		// id1's tank level is unknown → no anchor; id2 (first FULL fill) → honest 0, anchors at 1400;
		// id3 = (35/500)*100 = 7.
		expect(consumptionsById(logs)).toEqual({ 1: 0, 2: 0, 3: 7 });
	});

	it('a distance-unit change at a PARTIAL breaks the span and drops the carry (no mixed-unit math)', () => {
		const logs = [
			createFuelLog({ id: 1, date: new Date('2026-03-09'), odometer: 1000, quantity: 40 }),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10'),
				odometer: 700,
				quantity: 3,
				unit: 'gal',
				distanceUnit: 'mi',
				isPartialFill: true
			}),
			createFuelLog({ id: 3, date: new Date('2026-03-11'), odometer: 1500, quantity: 30 })
		];
		// id2's mi-partial can neither extend the km span (its gallons must never blend into a km/L
		// number) nor anchor a new one → id3 has no anchor: honest 0, then anchors at 1500.
		expect(consumptionsById(logs)).toEqual({ 1: 0, 2: 0, 3: 0 });
	});

	it('flipping a mid-timeline log to partial via buildFuelLogUpdatePlan re-spans the successor', () => {
		const logs = [
			createFuelLog({ id: 1, date: new Date('2026-03-09'), odometer: 1000, quantity: 40 }),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10'),
				odometer: 1200,
				quantity: 10,
				calculatedConsumption: 5
			}),
			createFuelLog({
				id: 3,
				date: new Date('2026-03-11'),
				odometer: 1500,
				quantity: 30,
				calculatedConsumption: 10
			})
		];

		const patches = buildFuelLogUpdatePlan(
			logs,
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10'),
				odometer: 1200,
				quantity: 10,
				calculatedConsumption: 5,
				isPartialFill: true
			})
		);

		// The edited row zeroes and persists the flag; the successor re-spans 1000→1500 over 10+30 L.
		expect(patches).toHaveLength(2);
		expect(patches[0]).toMatchObject({
			id: 2,
			changes: { calculatedConsumption: 0, isPartialFill: true, precededByMissedFill: false }
		});
		expect(patches[1]).toEqual({ id: 3, changes: { calculatedConsumption: 8 } });
	});

	it('deleting the full fill that closes a partial span re-spans the next full fill (deletion plan)', () => {
		const logs = [
			createFuelLog({ id: 1, date: new Date('2026-03-09'), odometer: 1000, quantity: 40 }),
			createFuelLog({
				id: 2,
				date: new Date('2026-03-10'),
				odometer: 1200,
				quantity: 10,
				isPartialFill: true
			}),
			createFuelLog({
				id: 3,
				date: new Date('2026-03-11'),
				odometer: 1500,
				quantity: 30,
				calculatedConsumption: 8
			}),
			createFuelLog({
				id: 4,
				date: new Date('2026-03-12'),
				odometer: 2000,
				quantity: 35,
				calculatedConsumption: 7
			})
		];

		// Deleting id3 (the span-closing full fill): id4 now closes the span 1000→2000 over 10+35 L
		// = (45/1000)*100 = 4.5. The partial's carry survives the deletion.
		expect(buildFuelLogDeletionPlan(logs, 3)).toEqual([
			{ id: 4, changes: { calculatedConsumption: 4.5 } }
		]);
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
