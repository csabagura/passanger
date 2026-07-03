import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	computeReminderStatus,
	selectDueReminders,
	resolveDueSoonThresholdKm,
	REMINDER_DUE_SOON_KM,
	REMINDER_DUE_SOON_MI,
	REMINDER_DUE_SOON_DAYS
} from './serviceReminder';
import { setLocale } from '$lib/paraglide/runtime';
import type { FuelLog, ServiceReminder } from '$lib/db/schema';

// Labels now resolve through Paraglide (Epic 6 i18n). Pin the base locale so these assertions check
// the English output deterministically (the active locale is module-level — mirror i18n.test.ts).
beforeEach(() => {
	setLocale('en', { reload: false });
});

afterEach(() => {
	setLocale('en', { reload: false });
});

function makeReminder(overrides: Partial<ServiceReminder> = {}): ServiceReminder {
	return { id: 1, vehicleId: 1, title: 'Oil change', ...overrides };
}

// Fixed reference date for deterministic day math.
const TODAY = new Date(2026, 5, 15); // 2026-06-15 (local)

function daysFromToday(offset: number): Date {
	const d = new Date(TODAY);
	d.setDate(d.getDate() + offset);
	return d;
}

describe('computeReminderStatus', () => {
	describe('km-only intervals', () => {
		it('is ok when km remaining is comfortably above the threshold', () => {
			const reminder = makeReminder({ intervalKm: 10000, lastServiceOdometer: 50000 });
			// due at 60000; current 55000 → 5000 remaining
			const result = computeReminderStatus(reminder, 55000, TODAY);
			expect(result.status).toBe('ok');
			expect(result.kmRemaining).toBe(5000);
			expect(result.daysRemaining).toBeUndefined();
			expect(result.label).toBe('Due in 5,000 km');
		});

		it('is due-soon when km remaining is within the threshold', () => {
			const reminder = makeReminder({ intervalKm: 10000, lastServiceOdometer: 50000 });
			// due at 60000; current 59600 → 400 remaining (<= 500)
			const result = computeReminderStatus(reminder, 59600, TODAY);
			expect(result.status).toBe('due-soon');
			expect(result.kmRemaining).toBe(400);
			expect(result.label).toBe('Due in 400 km');
		});

		it('is overdue when km remaining is negative', () => {
			const reminder = makeReminder({ intervalKm: 10000, lastServiceOdometer: 50000 });
			// due at 60000; current 60120 → -120 remaining
			const result = computeReminderStatus(reminder, 60120, TODAY);
			expect(result.status).toBe('overdue');
			expect(result.kmRemaining).toBe(-120);
			expect(result.label).toBe('Overdue by 120 km');
		});

		it('produces no km signal when lastServiceOdometer AND createdAt are both missing (H11a — no 0-default)', () => {
			// The old 0-default made a baseline-less reminder on a 200,000 km car scream
			// "Overdue by 195,000 km". With no usable base the km dimension contributes nothing —
			// exactly how the days dimension treats an absent lastServiceDate. A reminder with a
			// createdAt DOES anchor (see the "anchor rule" describe block below) — this covers the
			// residual case of a reminder with no createdAt at all (pre-v6, unmigrated).
			const reminder = makeReminder({ intervalKm: 5000 });
			const result = computeReminderStatus(reminder, 200000, TODAY);
			expect(result.kmRemaining).toBeUndefined();
			expect(result.daysRemaining).toBeUndefined();
			expect(result.status).toBe('ok');
			expect(result.label).toBe('No due date yet');
		});
	});

	describe('days-only intervals', () => {
		it('is ok when many days remain', () => {
			const reminder = makeReminder({ intervalDays: 30, lastServiceDate: daysFromToday(-2) });
			// due 28 days from today
			const result = computeReminderStatus(reminder, undefined, TODAY);
			expect(result.status).toBe('ok');
			expect(result.daysRemaining).toBe(28);
			expect(result.kmRemaining).toBeUndefined();
			expect(result.label).toBe('Due in 28 days');
		});

		it('is due-soon when days remaining is within the threshold', () => {
			const reminder = makeReminder({ intervalDays: 30, lastServiceDate: daysFromToday(-21) });
			// due 9 days from today
			const result = computeReminderStatus(reminder, undefined, TODAY);
			expect(result.status).toBe('due-soon');
			expect(result.daysRemaining).toBe(9);
			expect(result.label).toBe('Due in 9 days');
		});

		it('is overdue when the due date has passed', () => {
			const reminder = makeReminder({ intervalDays: 30, lastServiceDate: daysFromToday(-35) });
			// due 5 days ago
			const result = computeReminderStatus(reminder, undefined, TODAY);
			expect(result.status).toBe('overdue');
			expect(result.daysRemaining).toBe(-5);
			expect(result.label).toBe('Overdue by 5 days');
		});

		it('singularizes "day" for a one-day remaining', () => {
			const reminder = makeReminder({ intervalDays: 30, lastServiceDate: daysFromToday(-29) });
			const result = computeReminderStatus(reminder, undefined, TODAY);
			expect(result.daysRemaining).toBe(1);
			expect(result.label).toBe('Due in 1 day');
		});
	});

	describe('both intervals', () => {
		it('reports both dimensions when on track', () => {
			const reminder = makeReminder({
				intervalKm: 15000,
				lastServiceOdometer: 50000,
				intervalDays: 60,
				lastServiceDate: daysFromToday(-32)
			});
			// km: due 65000, current 63800 → 1200 remaining (> 500); days: 28 remaining (> 14)
			// both dimensions above their thresholds → ok
			const result = computeReminderStatus(reminder, 63800, TODAY);
			expect(result.status).toBe('ok');
			expect(result.kmRemaining).toBe(1200);
			expect(result.daysRemaining).toBe(28);
			expect(result.label).toBe('Due in 1,200 km / 28 days');
		});

		it('is overdue if either dimension is overdue', () => {
			const reminder = makeReminder({
				intervalKm: 15000,
				lastServiceOdometer: 50000,
				intervalDays: 30,
				lastServiceDate: daysFromToday(-40)
			});
			// km: 65000 due, current 60000 → 5000 remaining (fine); days: -10 (overdue)
			const result = computeReminderStatus(reminder, 60000, TODAY);
			expect(result.status).toBe('overdue');
			expect(result.kmRemaining).toBe(5000);
			expect(result.daysRemaining).toBe(-10);
			// Only the overdue dimension is reported in the label
			expect(result.label).toBe('Overdue by 10 days');
		});

		it('is due-soon if either dimension is within the threshold (and none overdue)', () => {
			const reminder = makeReminder({
				intervalKm: 15000,
				lastServiceOdometer: 50000,
				intervalDays: 90,
				lastServiceDate: daysFromToday(-10)
			});
			// km: 65000 due, current 64700 → 300 remaining (<=500, due-soon); days: 80 remaining
			const result = computeReminderStatus(reminder, 64700, TODAY);
			expect(result.status).toBe('due-soon');
			expect(result.label).toBe('Due in 300 km / 80 days');
		});
	});

	describe('missing currentOdometer', () => {
		it('omits kmRemaining when currentOdometer is undefined', () => {
			const reminder = makeReminder({ intervalKm: 10000, lastServiceOdometer: 50000 });
			const result = computeReminderStatus(reminder, undefined, TODAY);
			expect(result.kmRemaining).toBeUndefined();
			expect(result.daysRemaining).toBeUndefined();
			// No actionable signal → ok with a friendly label
			expect(result.status).toBe('ok');
			expect(result.label).toBe('No due date yet');
		});

		it('still computes days when currentOdometer is missing but a date interval exists', () => {
			const reminder = makeReminder({
				intervalKm: 10000,
				lastServiceOdometer: 50000,
				intervalDays: 30,
				lastServiceDate: daysFromToday(-20)
			});
			const result = computeReminderStatus(reminder, undefined, TODAY);
			expect(result.kmRemaining).toBeUndefined();
			expect(result.daysRemaining).toBe(10);
			expect(result.status).toBe('due-soon');
			expect(result.label).toBe('Due in 10 days');
		});
	});

	describe('exact boundaries', () => {
		it('km remaining exactly 0 is overdue', () => {
			const reminder = makeReminder({ intervalKm: 10000, lastServiceOdometer: 50000 });
			const result = computeReminderStatus(reminder, 60000, TODAY);
			expect(result.kmRemaining).toBe(0);
			expect(result.status).toBe('overdue');
			expect(result.label).toBe('Overdue by 0 km');
		});

		it('days remaining exactly 0 is overdue (due today)', () => {
			const reminder = makeReminder({ intervalDays: 30, lastServiceDate: daysFromToday(-30) });
			const result = computeReminderStatus(reminder, undefined, TODAY);
			expect(result.daysRemaining).toBe(0);
			expect(result.status).toBe('overdue');
		});

		it('km remaining exactly at the due-soon threshold is due-soon', () => {
			const reminder = makeReminder({ intervalKm: 10000, lastServiceOdometer: 50000 });
			// remaining === REMINDER_DUE_SOON_KM
			const result = computeReminderStatus(reminder, 60000 - REMINDER_DUE_SOON_KM, TODAY);
			expect(result.kmRemaining).toBe(REMINDER_DUE_SOON_KM);
			expect(result.status).toBe('due-soon');
		});

		it('days remaining exactly at the due-soon threshold is due-soon', () => {
			const reminder = makeReminder({
				intervalDays: 30,
				lastServiceDate: daysFromToday(-(30 - REMINDER_DUE_SOON_DAYS))
			});
			const result = computeReminderStatus(reminder, undefined, TODAY);
			expect(result.daysRemaining).toBe(REMINDER_DUE_SOON_DAYS);
			expect(result.status).toBe('due-soon');
		});

		it('km remaining one past the due-soon threshold is ok', () => {
			const reminder = makeReminder({ intervalKm: 10000, lastServiceOdometer: 50000 });
			const result = computeReminderStatus(reminder, 60000 - (REMINDER_DUE_SOON_KM + 1), TODAY);
			expect(result.kmRemaining).toBe(REMINDER_DUE_SOON_KM + 1);
			expect(result.status).toBe('ok');
		});
	});

	// Story 8.5 / H11 / AD-RT-3: an absent baseline anchors to `createdAt` on both dimensions,
	// instead of contributing no signal forever.
	describe('anchor rule (absent baseline resolves to createdAt, not no-signal)', () => {
		function fuelLog(date: string, odometer: number): FuelLog {
			return { date: new Date(date), odometer } as FuelLog;
		}

		it('anchors the date baseline to createdAt when lastServiceDate is absent', () => {
			const createdAt = daysFromToday(-40).getTime();
			const reminder = makeReminder({ intervalDays: 30, createdAt });
			// due 30 days after createdAt (40 days ago) → 10 days ago → overdue by 10 days
			const result = computeReminderStatus(reminder, undefined, TODAY);
			expect(result.daysRemaining).toBe(-10);
			expect(result.status).toBe('overdue');
		});

		it('anchors the km baseline to the odometer interpolated at createdAt when lastServiceOdometer is absent', () => {
			const createdAt = new Date('2025-06-01').getTime();
			const reminder = makeReminder({ intervalKm: 10000, createdAt });
			const fuelLogs = [fuelLog('2025-06-01', 40000)];
			// baseline 40000 (interpolated at createdAt); due 50000; current 45000 → 5000 remaining
			const result = computeReminderStatus(reminder, 45000, TODAY, fuelLogs);
			expect(result.kmRemaining).toBe(5000);
			expect(result.status).toBe('ok');
		});

		it('still yields no km signal when createdAt is set but the vehicle has zero fuel logs', () => {
			const reminder = makeReminder({ intervalKm: 10000, createdAt: Date.now() });
			const result = computeReminderStatus(reminder, 45000, TODAY, []);
			expect(result.kmRemaining).toBeUndefined();
		});

		it('prefers an explicit lastServiceOdometer over the createdAt-interpolated baseline', () => {
			const createdAt = new Date('2025-06-01').getTime();
			const reminder = makeReminder({
				intervalKm: 10000,
				createdAt,
				lastServiceOdometer: 42000
			});
			const fuelLogs = [fuelLog('2025-06-01', 40000)];
			// baseline 42000 (explicit), NOT 40000 (interpolated); due 52000; current 45000 → 7000 remaining
			const result = computeReminderStatus(reminder, 45000, TODAY, fuelLogs);
			expect(result.kmRemaining).toBe(7000);
		});

		it('prefers an explicit lastServiceDate over the createdAt anchor', () => {
			const createdAt = daysFromToday(-100).getTime();
			const reminder = makeReminder({
				intervalDays: 30,
				createdAt,
				lastServiceDate: daysFromToday(-2)
			});
			// baseline = lastServiceDate (2 days ago), NOT createdAt (100 days ago) → 28 days remaining
			const result = computeReminderStatus(reminder, undefined, TODAY);
			expect(result.daysRemaining).toBe(28);
		});
	});

	// Story 8.5 / S22 / AD-RT-6: due-soon threshold is resolved per the reminder's distance unit.
	// REMINDER_DUE_SOON_KM and REMINDER_DUE_SOON_MI are intentionally the SAME numeric value (500 —
	// a distinct round number per unit, not a lossy conversion), so `computeReminderStatus`'s
	// due-soon boundary can't distinguish a unit mix-up behaviorally — `resolveDueSoonThresholdKm`'s
	// resolution CHAIN is asserted directly instead.
	describe('resolveDueSoonThresholdKm (unit resolution chain)', () => {
		it("uses the reminder's own distanceUnit when present", () => {
			const reminder = makeReminder({ distanceUnit: 'mi' });
			expect(resolveDueSoonThresholdKm(reminder, [])).toBe(REMINDER_DUE_SOON_MI);
		});

		it("falls back to the vehicle's most-recent fuel log distanceUnit when the reminder has none", () => {
			const reminder = makeReminder({});
			const fuelLogs: FuelLog[] = [
				{ date: new Date('2025-01-01'), odometer: 40000, distanceUnit: 'mi' } as FuelLog
			];
			expect(resolveDueSoonThresholdKm(reminder, fuelLogs)).toBe(REMINDER_DUE_SOON_MI);
		});

		it("prefers the reminder's own distanceUnit over the vehicle's most-recent fuel log unit", () => {
			const reminder = makeReminder({ distanceUnit: 'km' });
			const fuelLogs: FuelLog[] = [
				{ date: new Date('2025-01-01'), odometer: 40000, distanceUnit: 'mi' } as FuelLog
			];
			expect(resolveDueSoonThresholdKm(reminder, fuelLogs)).toBe(REMINDER_DUE_SOON_KM);
		});

		it('falls back to REMINDER_DUE_SOON_KM when neither the reminder nor any fuel log carries a distance unit', () => {
			const reminder = makeReminder({});
			expect(resolveDueSoonThresholdKm(reminder, [])).toBe(REMINDER_DUE_SOON_KM);
		});

		it('resolves the "most recent" fuel log by date, not array order', () => {
			const reminder = makeReminder({});
			const fuelLogs: FuelLog[] = [
				{ date: new Date('2025-06-01'), odometer: 45000, distanceUnit: 'mi' } as FuelLog,
				{ date: new Date('2025-01-01'), odometer: 40000, distanceUnit: 'km' } as FuelLog
			];
			expect(resolveDueSoonThresholdKm(reminder, fuelLogs)).toBe(REMINDER_DUE_SOON_MI);
		});
	});

	// Integration check: the resolved threshold actually gates the due-soon boundary end-to-end.
	it('applies the unit-resolved due-soon threshold in computeReminderStatus', () => {
		const reminder = makeReminder({
			intervalKm: 10000,
			lastServiceOdometer: 50000,
			distanceUnit: 'mi'
		});
		const result = computeReminderStatus(reminder, 60000 - REMINDER_DUE_SOON_MI, TODAY);
		expect(result.status).toBe('due-soon');
	});

	// Story 8.5 / AD-RT-4: the dismissal due-instance model consumes these absolute thresholds.
	describe('dueAtOdometer / dueAtDate (absolute due-instance, independent of currentOdometer)', () => {
		it('reports dueAtOdometer even when currentOdometer is unknown', () => {
			const reminder = makeReminder({ intervalKm: 10000, lastServiceOdometer: 50000 });
			const result = computeReminderStatus(reminder, undefined, TODAY);
			expect(result.dueAtOdometer).toBe(60000);
			expect(result.kmRemaining).toBeUndefined();
		});

		it('reports dueAtDate as a YYYY-MM-DD string', () => {
			const reminder = makeReminder({ intervalDays: 30, lastServiceDate: daysFromToday(-2) });
			const result = computeReminderStatus(reminder, undefined, TODAY);
			const expected = new Date(TODAY);
			expected.setDate(expected.getDate() + 28);
			const y = expected.getFullYear();
			const m = String(expected.getMonth() + 1).padStart(2, '0');
			const d = String(expected.getDate()).padStart(2, '0');
			expect(result.dueAtDate).toBe(`${y}-${m}-${d}`);
		});

		it('omits both when neither interval is set', () => {
			const reminder = makeReminder({});
			const result = computeReminderStatus(reminder, 50000, TODAY);
			expect(result.dueAtOdometer).toBeUndefined();
			expect(result.dueAtDate).toBeUndefined();
		});
	});
});

describe('selectDueReminders', () => {
	// All km-based; evaluated at currentOdometer = 60000.
	// due = lastServiceOdometer + intervalKm.
	const overdueA = makeReminder({ id: 1, intervalKm: 5000, lastServiceOdometer: 50000 }); // due 55000 → -5000
	const dueSoonB = makeReminder({ id: 2, intervalKm: 10300, lastServiceOdometer: 50000 }); // due 60300 → 300
	const okC = makeReminder({ id: 3, intervalKm: 20000, lastServiceOdometer: 50000 }); // due 70000 → 10000
	const overdueD = makeReminder({ id: 4, intervalKm: 8000, lastServiceOdometer: 50000 }); // due 58000 → -2000

	it('filters out ok reminders, keeping only overdue and due-soon', () => {
		const result = selectDueReminders([overdueA, dueSoonB, okC], 60000, TODAY);
		expect(result.map((d) => d.reminder.id)).not.toContain(okC.id);
		expect(result).toHaveLength(2);
		expect(result.map((d) => d.status.status)).toEqual(['overdue', 'due-soon']);
	});

	it('orders overdue before due-soon, stable within each group', () => {
		// Input order: overdueA, dueSoonB, okC, overdueD.
		const result = selectDueReminders([overdueA, dueSoonB, okC, overdueD], 60000, TODAY);
		// Overdue first (input order preserved: A then D), then due-soon (B).
		expect(result.map((d) => d.reminder.id)).toEqual([overdueA.id, overdueD.id, dueSoonB.id]);
	});

	it('carries the computed status result (label + status) for each kept reminder', () => {
		const result = selectDueReminders([overdueA], 60000, TODAY);
		expect(result[0].status.status).toBe('overdue');
		expect(result[0].status.label).toBe('Overdue by 5,000 km');
	});

	it('returns an empty array when nothing is due', () => {
		expect(selectDueReminders([okC], 60000, TODAY)).toEqual([]);
	});

	it('returns an empty array for empty input', () => {
		expect(selectDueReminders([], 60000, TODAY)).toEqual([]);
	});
});

describe('localised labels (Hungarian)', () => {
	// Real i18n path: switch the active locale and assert the labels resolve in Hungarian (not an
	// English echo), proving the wrapper templates place {value} natively and the days plural is HU.
	it('renders the due / overdue / no-date labels in Hungarian', async () => {
		const { m } = await import('$lib/paraglide/messages');
		setLocale('hu', { reload: false });

		// Overdue by distance.
		const overdue = makeReminder({ intervalKm: 10000, lastServiceOdometer: 50000 });
		expect(computeReminderStatus(overdue, 60120, TODAY).label).toBe(
			m.reminder_overdue_by({ value: m.reminder_distance_km({ km: '120' }) })
		);

		// Due in days (plural).
		const due = makeReminder({ intervalDays: 30, lastServiceDate: daysFromToday(-2) });
		expect(computeReminderStatus(due, undefined, TODAY).label).toBe(
			m.reminder_due_in({ value: m.reminder_days_count({ count: 28 }) })
		);

		// No actionable signal.
		const none = makeReminder({ intervalKm: 10000, lastServiceOdometer: 50000 });
		expect(computeReminderStatus(none, undefined, TODAY).label).toBe(m.reminder_no_due_date());
	});
});
