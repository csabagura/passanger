import { describe, expect, it } from 'vitest';
import type { FuelLog, ServiceReminder } from '$lib/db/schema';
import {
	formatPredictedDue,
	predictReminderDate,
	predictedDateView,
	REMINDER_PREDICTION_INSUFFICIENT_NOTE
} from './reminderPrediction';

function createFuelEntry(overrides: Partial<FuelLog> = {}): FuelLog {
	return {
		id: overrides.id ?? 9,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 5, 10, 12, 0, 0, 0),
		odometer: overrides.odometer ?? 1700,
		quantity: overrides.quantity ?? 42,
		unit: overrides.unit ?? 'L',
		distanceUnit: overrides.distanceUnit ?? 'km',
		totalCost: overrides.totalCost ?? 78,
		currency: overrides.currency,
		calculatedConsumption: overrides.calculatedConsumption ?? 7,
		notes: overrides.notes ?? ''
	};
}

function makeReminder(overrides: Partial<ServiceReminder> = {}): ServiceReminder {
	return { id: 1, vehicleId: 7, title: 'Oil change', ...overrides };
}

// Reference "now" — 15 June 2026, 09:00 local (mirrors cadence.test's NOW).
const NOW = new Date(2026, 5, 15, 9, 0, 0, 0);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Locale-independent expectations: derive the words from the same Intl API the helper uses (mirror
// recency.test), so these pass regardless of the runtime locale.
function expectedDue(value: number, unit: 'day' | 'week'): string {
	return `≈ due ${new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, unit)}`;
}

// 3 km logs spanning 20 days, 700 km of travel → cadence reports 35 km/day (matches cadence.test).
function kmLogs(unit: 'km' | 'mi' = 'km'): FuelLog[] {
	return [
		createFuelEntry({ id: 1, date: new Date(2026, 4, 26), odometer: 1000, distanceUnit: unit }),
		createFuelEntry({ id: 2, date: new Date(2026, 5, 5), odometer: 1300, distanceUnit: unit }),
		createFuelEntry({ id: 3, date: new Date(2026, 5, 15), odometer: 1700, distanceUnit: unit })
	];
}

describe('predictReminderDate', () => {
	it('predicts a future date for a distance reminder with sufficient cadence', () => {
		// due at 1000 + 1435 = 2435; currentOdometer 1700 → kmRemaining 735; at 35 km/day → 21 days.
		const reminder = makeReminder({ intervalKm: 1435, lastServiceOdometer: 1000 });
		const result = predictReminderDate(reminder, kmLogs(), 1700, NOW);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.daysUntilDue).toBe(21);
		expect(result.date.getTime()).toBe(NOW.getTime() + 21 * MS_PER_DAY);
	});

	it('omits when the reminder is time-only (no distance interval)', () => {
		const reminder = makeReminder({ intervalDays: 365, lastServiceDate: new Date(2026, 0, 1) });
		expect(predictReminderDate(reminder, kmLogs(), 1700, NOW)).toEqual({
			status: 'omit',
			reason: 'no-distance-interval'
		});
	});

	it('omits when currentOdometer is unknown', () => {
		const reminder = makeReminder({ intervalKm: 1435, lastServiceOdometer: 1000 });
		expect(predictReminderDate(reminder, kmLogs(), undefined, NOW)).toEqual({
			status: 'omit',
			reason: 'unknown-odometer'
		});
	});

	it('omits when the reminder is already overdue on distance (no future date)', () => {
		// due at 1500; currentOdometer 1700 → kmRemaining -200.
		const reminder = makeReminder({ intervalKm: 500, lastServiceOdometer: 1000 });
		expect(predictReminderDate(reminder, kmLogs(), 1700, NOW)).toEqual({
			status: 'omit',
			reason: 'already-overdue'
		});
	});

	it('omits for each insufficient-cadence reason (too-few-logs / span-too-short / no-distance)', () => {
		const reminder = makeReminder({ intervalKm: 1435, lastServiceOdometer: 1000 });

		// too-few-logs: only 2 in-window logs.
		const tooFew = kmLogs().slice(0, 2);
		expect(predictReminderDate(reminder, tooFew, 1700, NOW)).toEqual({
			status: 'omit',
			reason: 'cadence-insufficient'
		});

		// span-too-short: 3 logs spanning under 14 days.
		const shortSpan = [
			createFuelEntry({ id: 1, date: new Date(2026, 5, 5), odometer: 1000 }),
			createFuelEntry({ id: 2, date: new Date(2026, 5, 10), odometer: 1200 }),
			createFuelEntry({ id: 3, date: new Date(2026, 5, 15), odometer: 1500 })
		];
		expect(predictReminderDate(reminder, shortSpan, 1500, NOW)).toEqual({
			status: 'omit',
			reason: 'cadence-insufficient'
		});

		// no-distance: 3 logs spanning 20 days but odometer never advances (net travel ≤ 0).
		const noDistance = [
			createFuelEntry({ id: 1, date: new Date(2026, 4, 26), odometer: 1700 }),
			createFuelEntry({ id: 2, date: new Date(2026, 5, 5), odometer: 1700 }),
			createFuelEntry({ id: 3, date: new Date(2026, 5, 15), odometer: 1700 })
		];
		expect(predictReminderDate(reminder, noDistance, 1700, NOW)).toEqual({
			status: 'omit',
			reason: 'cadence-insufficient'
		});
	});

	it('omits a far-future prediction beyond the ~1-year horizon (low confidence)', () => {
		// kmRemaining 19300 at 35 km/day → ~551 days > MAX_PREDICTION_DAYS.
		const reminder = makeReminder({ intervalKm: 20000, lastServiceOdometer: 1000 });
		expect(predictReminderDate(reminder, kmLogs(), 1700, NOW)).toEqual({
			status: 'omit',
			reason: 'beyond-horizon'
		});
	});

	it('honours the mi unit — never mixes km/mi (a miles vehicle predicts in miles)', () => {
		// Identical magnitudes but all logs are 'mi': rate is 35 mi/day, kmRemaining 735 mi → 21 days.
		// If the math wrongly converted mi→km it would yield ~13 days; asserting 21 proves units are paired.
		const reminder = makeReminder({ intervalKm: 1435, lastServiceOdometer: 1000 });
		const result = predictReminderDate(reminder, kmLogs('mi'), 1700, NOW);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.daysUntilDue).toBe(21);
	});

	it('never returns a non-finite date', () => {
		const reminder = makeReminder({ intervalKm: 1435, lastServiceOdometer: 1000 });
		const result = predictReminderDate(reminder, kmLogs(), 1700, NOW);
		if (result.status === 'ok') {
			expect(Number.isFinite(result.date.getTime())).toBe(true);
			expect(Number.isFinite(result.daysUntilDue)).toBe(true);
		}
	});
});

describe('formatPredictedDue', () => {
	it('uses a day bucket under a fortnight', () => {
		expect(formatPredictedDue(5)).toBe(expectedDue(5, 'day'));
	});

	it('uses a week bucket at a fortnight or more', () => {
		expect(formatPredictedDue(21)).toBe(expectedDue(3, 'week'));
	});

	it('rounds weeks to the nearest whole week', () => {
		expect(formatPredictedDue(20)).toBe(expectedDue(3, 'week')); // 20/7 = 2.86 → 3
	});
});

describe('predictedDateView', () => {
	it('returns the ≈ date phrase for a sufficient prediction', () => {
		const reminder = makeReminder({ intervalKm: 1435, lastServiceOdometer: 1000 });
		expect(predictedDateView(reminder, kmLogs(), 1700, NOW)).toEqual({
			kind: 'date',
			text: expectedDue(3, 'week')
		});
	});

	it('returns the honest note when cadence is insufficient', () => {
		const reminder = makeReminder({ intervalKm: 1435, lastServiceOdometer: 1000 });
		expect(predictedDateView(reminder, kmLogs().slice(0, 2), 1700, NOW)).toEqual({
			kind: 'note',
			text: REMINDER_PREDICTION_INSUFFICIENT_NOTE
		});
	});

	it('returns none for a time-only reminder (no cadence note)', () => {
		const reminder = makeReminder({ intervalDays: 365, lastServiceDate: new Date(2026, 0, 1) });
		expect(predictedDateView(reminder, kmLogs(), 1700, NOW)).toEqual({ kind: 'none', text: '' });
	});

	it('returns none for an already-overdue reminder', () => {
		const reminder = makeReminder({ intervalKm: 500, lastServiceOdometer: 1000 });
		expect(predictedDateView(reminder, kmLogs(), 1700, NOW)).toEqual({ kind: 'none', text: '' });
	});
});
