import 'fake-indexeddb/auto'; // MUST be first import — patches global IndexedDB before db.ts opens
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '$lib/db/db';
import { saveFuelLog, getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
import type { FuelLog, NewFuelLog } from '$lib/db/schema';
import { createLiveQuery, createRepoLiveQuery } from './liveQuery.svelte';
import { err } from '$lib/utils/result';

const VEHICLE_ID = 1;

const makeLog = (odometer: number): NewFuelLog => ({
	vehicleId: VEHICLE_ID,
	date: new Date('2025-01-15'),
	odometer,
	quantity: 40.5,
	unit: 'L',
	distanceUnit: 'km',
	totalCost: 68.45,
	calculatedConsumption: 7.2
});

// queryFn reads through the repository so the tracked db.fuelLogs read sits inside the
// observed function; unwrap the Result so the adapter's T is FuelLog[] (matches `initial: []`).
const fuelLogsQuery = () => getAllFuelLogs(VEHICLE_ID).then((r) => r.data ?? []);

beforeEach(async () => {
	await db.delete();
	await db.open();
});

describe('createLiveQuery', () => {
	it('AC5: seeds `current` with the supplied initial before the first async emission', () => {
		const q = createLiveQuery<FuelLog[]>(fuelLogsQuery, []);
		// liveQuery emits asynchronously — synchronously after creation `current` is still the seed,
		// so a consumer can distinguish "not loaded yet" ([] here) from a later loaded-empty emission.
		expect(q.current).toEqual([]);
		expect(q.error).toBeNull();
		q.destroy();
	});

	it('AC2: re-emits after a repository write — value updates without a manual re-read', async () => {
		await saveFuelLog(makeLog(50000));

		const q = createLiveQuery<FuelLog[]>(fuelLogsQuery, []);

		// Initial emission reflects current rows.
		await vi.waitFor(() => expect(q.current).toHaveLength(1));

		// A repository write while subscribed must push a new emission — no re-read by the consumer.
		await saveFuelLog(makeLog(50500));
		await vi.waitFor(() => expect(q.current).toHaveLength(2));
		expect(q.current?.map((l) => l.odometer).sort()).toEqual([50000, 50500]);

		q.destroy();
	});

	it('AC6: after destroy() the subscription is released — later writes do not change `current`', async () => {
		await saveFuelLog(makeLog(50000));

		const q = createLiveQuery<FuelLog[]>(fuelLogsQuery, []);
		await vi.waitFor(() => expect(q.current).toHaveLength(1));

		q.destroy();

		// Write after teardown; give liveQuery ample time to (wrongly) emit if still subscribed.
		await saveFuelLog(makeLog(50500));
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect(q.current).toHaveLength(1);
	});

	it('AC6: destroy() is idempotent — calling it twice does not throw', async () => {
		const q = createLiveQuery<FuelLog[]>(fuelLogsQuery, []);
		await vi.waitFor(() => expect(q.current).toHaveLength(0));

		expect(() => {
			q.destroy();
			q.destroy();
		}).not.toThrow();
	});

	it('AC5: a rejecting queryFn surfaces as an `error` state, not an unhandled rejection', async () => {
		const boom = new Error('query failed');
		const q = createLiveQuery<FuelLog[]>(() => Promise.reject(boom), []);

		await vi.waitFor(() => expect(q.error).toBe(boom));
		// `current` keeps its last good value (here the initial seed) rather than throwing.
		expect(q.current).toEqual([]);

		q.destroy();
	});

	it('AC5: a synchronously-throwing queryFn surfaces as `error`, not an uncaught exception', async () => {
		const boom = new Error('sync boom');
		const q = createLiveQuery<FuelLog[]>(() => {
			throw boom;
		}, []);

		// Dexie defers queryFn into a timer, so a raw sync throw would escape uncaught; the adapter
		// wraps queryFn to convert it into a rejection that lands on `error` (last good `current` kept).
		await vi.waitFor(() => expect(q.error).toBe(boom));
		expect(q.current).toEqual([]);

		q.destroy();
	});
});

describe('createRepoLiveQuery', () => {
	it('H2: a resultFn resolving to err(...) surfaces on `.error` instead of a coalesced empty value', async () => {
		const q = createRepoLiveQuery<FuelLog[]>(
			() => Promise.resolve(err('DB_READ_FAILED', 'boom')),
			[]
		);

		await vi.waitFor(() => expect(q.error).not.toBeNull());
		// Review fix (8.6): both the error code (name) and the descriptive message are preserved —
		// previously only the code survived, discarding the repository's message entirely.
		expect((q.error as Error).name).toBe('DB_READ_FAILED');
		expect((q.error as Error).message).toBe('boom');
		// `current` keeps its last good value (the initial seed) rather than becoming `[]` from a swallow.
		expect(q.current).toEqual([]);

		q.destroy();
	});

	it('H2: a resultFn resolving to ok(data) emits `.data` on `.current` with no error', async () => {
		await saveFuelLog(makeLog(50000));

		const q = createRepoLiveQuery<FuelLog[]>(() => getAllFuelLogs(VEHICLE_ID), []);

		await vi.waitFor(() => expect(q.current).toHaveLength(1));
		expect(q.error).toBeNull();

		q.destroy();
	});

	it('H2: re-emits a fresh error after a prior success (repository starts failing mid-stream)', async () => {
		let shouldFail = false;
		const q = createRepoLiveQuery<FuelLog[]>(
			() =>
				shouldFail ? Promise.resolve(err('DB_READ_FAILED', 'boom')) : getAllFuelLogs(VEHICLE_ID),
			[]
		);

		await vi.waitFor(() => expect(q.current).toEqual([]));
		expect(q.error).toBeNull();

		shouldFail = true;
		await saveFuelLog(makeLog(50000)); // trigger a re-run via the liveQuery table-mutation watch
		await vi.waitFor(() => expect(q.error).not.toBeNull());

		q.destroy();
	});
});
