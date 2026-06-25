import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	computeReminderStatus,
	selectDueReminders,
	REMINDER_DUE_SOON_KM,
	REMINDER_DUE_SOON_DAYS
} from './serviceReminder';
import { setLocale } from '$lib/paraglide/runtime';
import type { ServiceReminder } from '$lib/db/schema';

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

		it('treats a missing lastServiceOdometer as 0', () => {
			const reminder = makeReminder({ intervalKm: 1000 });
			// due at 0 + 1000 = 1000; current 300 → 700 remaining
			const result = computeReminderStatus(reminder, 300, TODAY);
			expect(result.status).toBe('ok');
			expect(result.kmRemaining).toBe(700);
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
