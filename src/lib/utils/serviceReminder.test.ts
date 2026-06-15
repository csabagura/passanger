import { describe, it, expect } from 'vitest';
import {
	computeReminderStatus,
	REMINDER_DUE_SOON_KM,
	REMINDER_DUE_SOON_DAYS
} from './serviceReminder';
import type { ServiceReminder } from '$lib/db/schema';

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
