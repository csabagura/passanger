import type { FuelLog, NewFuelLog } from '$lib/db/schema';
import { calculateConsumption } from '$lib/utils/calculations';

export interface FuelLogUpdatePatch {
	id: number;
	changes: Partial<NewFuelLog>;
}

export function sortFuelLogsForTimeline(logs: FuelLog[]): FuelLog[] {
	return [...logs].sort((left, right) => {
		const dateDifference = left.date.getTime() - right.date.getTime();
		return dateDifference !== 0 ? dateDifference : left.id - right.id;
	});
}

export function getFuelLogPredecessor(logs: FuelLog[], logId: number): FuelLog | undefined {
	const sortedLogs = sortFuelLogsForTimeline(logs);
	const logIndex = sortedLogs.findIndex((log) => log.id === logId);

	return logIndex > 0 ? sortedLogs[logIndex - 1] : undefined;
}

export function getFuelLogSuccessor(logs: FuelLog[], logId: number): FuelLog | undefined {
	const sortedLogs = sortFuelLogsForTimeline(logs);
	const logIndex = sortedLogs.findIndex((log) => log.id === logId);

	return logIndex >= 0 && logIndex < sortedLogs.length - 1 ? sortedLogs[logIndex + 1] : undefined;
}

function recalculateSortedFuelLogs(logs: FuelLog[]): FuelLog[] {
	const sortedLogs = sortFuelLogsForTimeline(logs);

	// Consumption is measured full-fill → full-fill (Story 7.1, strict AC3 semantics per review
	// decision D1). ONLY a full fill can anchor a span — at a full fill the tank level is KNOWN
	// (full), so "litres added since the anchor ÷ distance since the anchor" is honest. A partial's
	// tank level is unknown, so a partial NEVER anchors: it defers its own value (0) and, when a span
	// is open, rolls its litres into `carriedQuantity` for the next full fill to close the interval.
	// A `precededByMissedFill` interval is unreliable (0); if that fill is FULL it re-anchors (the
	// reading is trustworthy again), if it is also partial the span stays closed until the next full
	// fill. A distance-unit change breaks the span the same way (mixed km/mi — and, via the L↔km /
	// gal↔mi pairing invariant, mixed litres/gallons — must never blend into one number).
	// Flags are coerced `?? false` so v1–v4 rows (and rows restored from a v4 backup, which never run
	// the v5 upgrade) behave exactly as before: every fill full, none missed → identical to v4 output.
	let anchor: { odometer: number; distanceUnit: 'km' | 'mi' } | undefined;
	let carriedQuantity = 0;

	return sortedLogs.map((log) => {
		const isPartial = log.isPartialFill ?? false;
		const missed = log.precededByMissedFill ?? false;
		const spanBroken = !anchor || anchor.distanceUnit !== log.distanceUnit;
		// ADR-006 AD-WB-5 (H4 anchor-trust rule): a FULL fill whose odometer does not exceed the
		// current anchor's is an untrusted/regressing reading (e.g. a below-previous odometer typo).
		// Anchor selection used to be decoupled from span sign — a regressing full fill still became
		// the next span's anchor even though its OWN span was non-positive, silently inflating every
		// downstream span measured from the bogus-low reading. Quarantine it instead: report 0 (below,
		// via calculateConsumption's own distance<=0 guard) and leave the anchor/carry untouched, so
		// the NEXT full fill is still measured from the last TRUSTED reading. The first-ever anchor is
		// unaffected (`anchor === undefined` makes this false) and a unit change still always re-anchors
		// (`spanBroken` short-circuits this to false, matching existing behaviour).
		const isRegression = !spanBroken && anchor !== undefined && log.odometer <= anchor.odometer;

		let consumption: number;
		if (missed || isPartial || spanBroken) {
			// Missed → interval spans an unknown tank; partial → deferred to the next full fill;
			// no anchor / unit change → no comparable full-fill predecessor. All honest 0.
			consumption = 0;
		} else {
			// Full fill closing the open span: distance since the anchor, litres = carried partials +
			// this fill. Reuses calculateConsumption (non-positive distance/quantity → 0, PREP-1 finite)
			// — a regression also lands here and naturally computes 0 via the distance<=0 guard.
			consumption = calculateConsumption(
				log.odometer,
				anchor!.odometer,
				carriedQuantity + log.quantity,
				log.unit
			);
		}

		// Advance the span state AFTER computing this fill's value.
		if (isPartial) {
			if (missed || spanBroken) {
				// The span can't be measured through this partial (missed predecessor, first-ever fill,
				// or unit change) and a partial can't anchor a new one → closed until the next full fill.
				anchor = undefined;
				carriedQuantity = 0;
			} else if (isRegression) {
				// QUARANTINE (H4, extended to partials): a below-anchor odometer is just as untrustworthy
				// on a partial reading as on a full one — leave anchor/carriedQuantity exactly as they
				// were (do NOT carry this partial's litres forward), mirroring the full-fill quarantine
				// below. Without this branch, isPartial short-circuits past isRegression entirely and an
				// untrusted partial's litres get folded into the next full fill's numerator anyway —
				// the same over-attribution AD-WB-5 exists to prevent, just reached via a partial row.
			} else {
				// Open span continues: accumulate this partial's litres toward the next full fill.
				carriedQuantity += log.quantity;
			}
		} else if (isRegression) {
			// QUARANTINE (H4): do NOT re-anchor and do NOT touch carriedQuantity — the untrusted
			// reading is skipped entirely. Its own litres are deliberately NOT carried forward either:
			// carrying them would import a known-corrupt endpoint's fuel into the NEXT trusted span's
			// numerator (a smaller copy of the same poison). Under-counting one fill is bounded and
			// honest; over-attributing is not (ADR-005 strict-anchor doctrine, D1).
		} else {
			// Full fill (incl. first-ever / missed-preceded / unit-change / a genuine odometer advance):
			// the tank is full here and the reading is trusted, so it anchors the next span.
			anchor = { odometer: log.odometer, distanceUnit: log.distanceUnit };
			carriedQuantity = 0;
		}

		return { ...log, calculatedConsumption: consumption };
	});
}

export function recalculateFuelLogTimeline(logs: FuelLog[], updatedLog: FuelLog): FuelLog[] {
	const nextLogs = [...logs.filter((log) => log.id !== updatedLog.id), updatedLog];
	return recalculateSortedFuelLogs(nextLogs);
}

// Span-aware consumption for a full set of logs, sorted into timeline order. The single public entry
// point for bulk (re)computation — used by the CSV importer (Story 7.1) so imported partial/missed
// fills defer/zero exactly like live edits, keeping the timeline engine (AD-DA-3) the sole owner of
// the math. Returns the logs in timeline order with `calculatedConsumption` filled.
export function recalculateFuelLogConsumptions(logs: FuelLog[]): FuelLog[] {
	return recalculateSortedFuelLogs(logs);
}

export function buildFuelLogUpdatePlan(
	originalLogs: FuelLog[],
	updatedLog: FuelLog
): FuelLogUpdatePatch[] {
	const originalLogsById = new Map(originalLogs.map((log) => [log.id, log]));
	const recalculatedLogs = recalculateFuelLogTimeline(originalLogs, updatedLog);

	return recalculatedLogs.flatMap((log) => {
		const originalLog = originalLogsById.get(log.id);
		if (!originalLog) {
			return [];
		}

		if (log.id === updatedLog.id) {
			const changes: Partial<NewFuelLog> = {
				date: log.date,
				odometer: log.odometer,
				quantity: log.quantity,
				unit: log.unit,
				distanceUnit: log.distanceUnit,
				totalCost: log.totalCost,
				calculatedConsumption: log.calculatedConsumption,
				// Story 7.1 — persist the edited fill-quality flags for the updated row (coerced so a
				// pre-v5 row edited without touching them stays explicit `false`, not `undefined`).
				isPartialFill: log.isPartialFill ?? false,
				precededByMissedFill: log.precededByMissedFill ?? false
			};

			if (log.notes !== undefined) {
				changes.notes = log.notes;
			}

			// Conditional include like notes — an explicit `undefined` would make Dexie update()
			// delete the stored key on legacy currency-less rows.
			if (log.currency !== undefined) {
				changes.currency = log.currency;
			}

			return [{ id: log.id, changes }];
		}

		if (originalLog.calculatedConsumption === log.calculatedConsumption) {
			return [];
		}

		return [
			{
				id: log.id,
				changes: {
					calculatedConsumption: log.calculatedConsumption
				}
			}
		];
	});
}

export function buildFuelLogDeletionPlan(
	originalLogs: FuelLog[],
	deletedLogId: number
): FuelLogUpdatePatch[] {
	const originalLogsById = new Map(originalLogs.map((log) => [log.id, log]));
	const recalculatedLogs = recalculateSortedFuelLogs(
		originalLogs.filter((log) => log.id !== deletedLogId)
	);

	return recalculatedLogs.flatMap((log) => {
		const originalLog = originalLogsById.get(log.id);
		if (!originalLog || originalLog.calculatedConsumption === log.calculatedConsumption) {
			return [];
		}

		return [
			{
				id: log.id,
				changes: {
					calculatedConsumption: log.calculatedConsumption
				}
			}
		];
	});
}
