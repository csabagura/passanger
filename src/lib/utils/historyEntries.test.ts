import { describe, expect, it } from 'vitest';
import type { Expense, FuelLog } from '$lib/db/schema';
import {
	compareHistoryEntriesNewestFirst,
	filterHistoryEntries,
	getHistoryEntryKey,
	groupHistoryEntriesByMonth,
	mergeHistoryEntries,
	summarizeCurrentMonthHistoryEntries,
	summarizeHistoryEntriesForTimePeriod,
	summarizeHistoryEntries,
	type HistoryEntry
} from './historyEntries';

function createFuelEntry(overrides: Partial<FuelLog> = {}): FuelLog {
	return {
		id: overrides.id ?? 9,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date('2026-03-10T12:00:00Z'),
		odometer: overrides.odometer ?? 87400,
		quantity: overrides.quantity ?? 42,
		unit: overrides.unit ?? 'L',
		distanceUnit: overrides.distanceUnit ?? 'km',
		totalCost: overrides.totalCost ?? 78,
		calculatedConsumption: overrides.calculatedConsumption ?? 7.2,
		notes: overrides.notes ?? ''
	};
}

function createMaintenanceEntry(overrides: Partial<Expense> = {}): Expense {
	return {
		id: overrides.id ?? 12,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date('2026-03-10T12:00:00Z'),
		type: overrides.type ?? 'Oil Change',
		odometer: overrides.odometer ?? 87400,
		cost: overrides.cost ?? 78,
		notes: overrides.notes ?? 'Changed oil filter'
	};
}

function formatHistoryMonthLabel(date: Date): string {
	return new Intl.DateTimeFormat(undefined, {
		month: 'long',
		year: 'numeric'
	}).format(date);
}

describe('historyEntries', () => {
	const litersPerGallon = 3.785411784;
	const kilometersPerMile = 1.609344;

	it('merges mixed entries newest-first by date and then id', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({ id: 4, date: new Date('2026-03-09T12:00:00Z') }),
				createFuelEntry({ id: 8, date: new Date('2026-03-10T12:00:00Z') })
			],
			[
				createMaintenanceEntry({ id: 6, date: new Date('2026-03-10T12:00:00Z') }),
				createMaintenanceEntry({ id: 2, date: new Date('2026-03-08T12:00:00Z') })
			]
		);

		expect(entries.map(getHistoryEntryKey)).toEqual([
			'fuel-8',
			'maintenance-6',
			'fuel-4',
			'maintenance-2'
		]);
	});

	it('produces stable mixed-entry keys and comparison results for same-day ties', () => {
		const fuelEntry = { kind: 'fuel', entry: createFuelEntry({ id: 3 }) } as const;
		const maintenanceEntry = {
			kind: 'maintenance',
			entry: createMaintenanceEntry({ id: 7 })
		} as const;

		expect(getHistoryEntryKey(fuelEntry)).toBe('fuel-3');
		expect(getHistoryEntryKey(maintenanceEntry)).toBe('maintenance-7');
		expect(compareHistoryEntriesNewestFirst(fuelEntry, maintenanceEntry)).toBeGreaterThan(0);
		expect(compareHistoryEntriesNewestFirst(maintenanceEntry, fuelEntry)).toBeLessThan(0);
	});

	it('returns an empty array when both inputs are empty', () => {
		expect(mergeHistoryEntries([], [])).toEqual([]);
	});

	it('returns only fuel entries in newest-first order when expenses input is empty', () => {
		const older = createFuelEntry({ id: 2, date: new Date('2026-03-09T12:00:00Z') });
		const newer = createFuelEntry({ id: 5, date: new Date('2026-03-10T12:00:00Z') });
		const entries = mergeHistoryEntries([older, newer], []);
		expect(entries.map(getHistoryEntryKey)).toEqual(['fuel-5', 'fuel-2']);
	});

	it('returns only maintenance entries in newest-first order when fuelLogs input is empty', () => {
		const older = createMaintenanceEntry({ id: 3, date: new Date('2026-03-08T12:00:00Z') });
		const newer = createMaintenanceEntry({ id: 7, date: new Date('2026-03-10T12:00:00Z') });
		const entries = mergeHistoryEntries([], [older, newer]);
		expect(entries.map(getHistoryEntryKey)).toEqual(['maintenance-7', 'maintenance-3']);
	});

	it('fuel-N and maintenance-N keys are distinct for the same numeric id (no namespace collision)', () => {
		const fuelEntry = { kind: 'fuel' as const, entry: createFuelEntry({ id: 5 }) };
		const maintenanceEntry = {
			kind: 'maintenance' as const,
			entry: createMaintenanceEntry({ id: 5 })
		};
		const fuelKey = getHistoryEntryKey(fuelEntry);
		const maintenanceKey = getHistoryEntryKey(maintenanceEntry);
		expect(fuelKey).toBe('fuel-5');
		expect(maintenanceKey).toBe('maintenance-5');
		expect(fuelKey).not.toBe(maintenanceKey);
	});

	it('filters mixed history entries by supported filter without changing newest-first order', () => {
		const fuelNewest = { kind: 'fuel' as const, entry: createFuelEntry({ id: 11 }) };
		const maintenanceNewest = {
			kind: 'maintenance' as const,
			entry: createMaintenanceEntry({ id: 14, type: 'Brake Pads' })
		};
		const fuelOlder = {
			kind: 'fuel' as const,
			entry: createFuelEntry({ id: 8, date: new Date('2026-03-09T12:00:00Z') })
		};
		const entries: HistoryEntry[] = [maintenanceNewest, fuelNewest, fuelOlder];

		expect(filterHistoryEntries(entries, 'all').map(getHistoryEntryKey)).toEqual([
			'maintenance-14',
			'fuel-11',
			'fuel-8'
		]);
		expect(filterHistoryEntries(entries, 'fuel').map(getHistoryEntryKey)).toEqual([
			'fuel-11',
			'fuel-8'
		]);
		expect(filterHistoryEntries(entries, 'maintenance').map(getHistoryEntryKey)).toEqual([
			'maintenance-14'
		]);
	});

	it('preserves mixed-entry object identity for items that remain visible after filtering', () => {
		const fuelEntry = { kind: 'fuel' as const, entry: createFuelEntry({ id: 21 }) };
		const maintenanceEntry = {
			kind: 'maintenance' as const,
			entry: createMaintenanceEntry({ id: 31 })
		};
		const entries: HistoryEntry[] = [maintenanceEntry, fuelEntry];

		expect(filterHistoryEntries(entries, 'all')[0]).toBe(maintenanceEntry);
		expect(filterHistoryEntries(entries, 'fuel')[0]).toBe(fuelEntry);
		expect(filterHistoryEntries(entries, 'maintenance')[0]).toBe(maintenanceEntry);
	});

	it('returns an empty list when a filter has no matching entries', () => {
		const entries: HistoryEntry[] = [
			{ kind: 'fuel', entry: createFuelEntry({ id: 2 }) },
			{ kind: 'fuel', entry: createFuelEntry({ id: 5, date: new Date('2026-03-11T12:00:00Z') }) }
		];

		expect(filterHistoryEntries(entries, 'maintenance')).toEqual([]);
	});

	it('groups visible history entries by month and calculates month subtotals', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({
					id: 11,
					date: new Date('2026-03-12T12:00:00Z'),
					totalCost: 78
				}),
				createFuelEntry({
					id: 9,
					date: new Date('2026-02-10T12:00:00Z'),
					totalCost: 44
				})
			],
			[
				createMaintenanceEntry({
					id: 21,
					date: new Date('2026-03-10T12:00:00Z'),
					cost: 120
				})
			]
		);

		expect(groupHistoryEntriesByMonth(entries)).toEqual([
			{
				key: '2026-03',
				label: formatHistoryMonthLabel(entries[0].entry.date),
				subtotalCost: 198,
				entries: [entries[0], entries[1]]
			},
			{
				key: '2026-02',
				label: formatHistoryMonthLabel(entries[2].entry.date),
				subtotalCost: 44,
				entries: [entries[2]]
			}
		]);
	});

	it('summarizes the current month using the same month boundaries as grouped history', () => {
		const referenceDate = new Date(2026, 2, 15, 10, 0, 0, 0);
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({
					id: 11,
					date: new Date(2026, 2, 12, 12, 0, 0, 0),
					quantity: 40,
					totalCost: 78,
					calculatedConsumption: 8
				}),
				createFuelEntry({
					id: 9,
					date: new Date(2026, 1, 25, 12, 0, 0, 0),
					quantity: 30,
					totalCost: 44,
					calculatedConsumption: 7.5
				})
			],
			[
				createMaintenanceEntry({
					id: 21,
					date: new Date(2026, 2, 10, 12, 0, 0, 0),
					cost: 120
				})
			]
		);

		const currentMonthSummary = summarizeCurrentMonthHistoryEntries(
			entries,
			'L/100km',
			referenceDate
		);
		const groupedCurrentMonth = groupHistoryEntriesByMonth(entries).find(
			(group) => group.key === currentMonthSummary.monthKey
		);

		expect(currentMonthSummary.monthKey).toBe('2026-03');
		expect(currentMonthSummary.calendarLabel).toBe(formatHistoryMonthLabel(referenceDate));
		expect(currentMonthSummary.totalSpend).toBe(198);
		expect(currentMonthSummary.totalFuelVolume).toBe(40);
		expect(currentMonthSummary.fuelVolumeUnit).toBe('L');
		expect(currentMonthSummary.averageConsumption).toBeCloseTo(8, 6);
		expect(currentMonthSummary.averageConsumptionUnit).toBe('L');
		expect(groupedCurrentMonth?.subtotalCost).toBe(currentMonthSummary.totalSpend);
	});

	it('returns a zeroed current-month summary when only older visible entries remain', () => {
		const referenceDate = new Date(2026, 2, 15, 10, 0, 0, 0);
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({
					id: 9,
					date: new Date(2026, 1, 25, 12, 0, 0, 0),
					quantity: 30,
					totalCost: 44,
					calculatedConsumption: 7.5
				})
			],
			[
				createMaintenanceEntry({
					id: 21,
					date: new Date(2026, 1, 10, 12, 0, 0, 0),
					cost: 120
				})
			]
		);

		expect(summarizeCurrentMonthHistoryEntries(entries, 'L/100km', referenceDate)).toEqual({
			monthKey: '2026-03',
			calendarLabel: formatHistoryMonthLabel(referenceDate),
			timePeriod: 'current-month',
			periodLabel: 'This month',
			periodAriaLabel: 'this month',
			totalSpend: 0,
			totalFuelVolume: 0,
			fuelVolumeUnit: 'L',
			averageConsumption: null,
			averageConsumptionUnit: 'L'
		});
	});

	it('summarizes explicit Current Month, Year-to-Date, and All-Time windows without drifting labels', () => {
		const referenceDate = new Date(2026, 2, 15, 10, 0, 0, 0);
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({
					id: 15,
					date: new Date(2026, 2, 12, 12, 0, 0, 0),
					quantity: 40,
					totalCost: 78,
					calculatedConsumption: 8
				}),
				createFuelEntry({
					id: 14,
					date: new Date(2026, 0, 25, 12, 0, 0, 0),
					quantity: 10,
					unit: 'gal',
					distanceUnit: 'mi',
					totalCost: 44,
					calculatedConsumption: 25
				}),
				createFuelEntry({
					id: 13,
					date: new Date(2025, 11, 30, 12, 0, 0, 0),
					quantity: 20,
					totalCost: 33,
					calculatedConsumption: 7
				})
			],
			[
				createMaintenanceEntry({
					id: 31,
					date: new Date(2026, 2, 10, 12, 0, 0, 0),
					cost: 120
				}),
				createMaintenanceEntry({
					id: 30,
					date: new Date(2025, 11, 15, 12, 0, 0, 0),
					cost: 250
				})
			]
		);

		const currentMonthSummary = summarizeHistoryEntriesForTimePeriod(
			entries,
			'current-month',
			'L/100km',
			referenceDate
		);
		const yearToDateSummary = summarizeHistoryEntriesForTimePeriod(
			entries,
			'year-to-date',
			'L/100km',
			referenceDate
		);
		const allTimeSummary = summarizeHistoryEntriesForTimePeriod(
			entries,
			'all-time',
			'L/100km',
			referenceDate
		);

		expect(currentMonthSummary).toMatchObject({
			timePeriod: 'current-month',
			periodLabel: 'This month',
			periodAriaLabel: 'this month',
			totalSpend: 198,
			totalFuelVolume: 40,
			fuelVolumeUnit: 'L',
			averageConsumptionUnit: 'L'
		});
		expect(currentMonthSummary.averageConsumption).toBeCloseTo(8, 6);

		expect(yearToDateSummary).toMatchObject({
			timePeriod: 'year-to-date',
			periodLabel: 'This year',
			periodAriaLabel: 'this year',
			totalSpend: 242,
			fuelVolumeUnit: 'L',
			averageConsumptionUnit: 'L'
		});
		expect(yearToDateSummary.totalFuelVolume).toBeCloseTo(40 + 10 * litersPerGallon, 6);
		expect(yearToDateSummary.averageConsumption).toBeCloseTo(
			((40 + 10 * litersPerGallon) / (500 + 250 * kilometersPerMile)) * 100,
			6
		);

		expect(allTimeSummary).toMatchObject({
			timePeriod: 'all-time',
			periodLabel: 'All time',
			periodAriaLabel: 'all time',
			totalSpend: 525,
			fuelVolumeUnit: 'L',
			averageConsumptionUnit: 'L'
		});
		expect(allTimeSummary.totalFuelVolume).toBeCloseTo(40 + 10 * litersPerGallon + 20, 6);
		expect(allTimeSummary.averageConsumption).toBeCloseTo(
			((40 + 10 * litersPerGallon + 20) / (500 + 250 * kilometersPerMile + (20 / 7) * 100)) * 100,
			6
		);
	});

	it('keeps year-to-date bounded by the reference date while current-month follows the calendar month', () => {
		const referenceDate = new Date(2026, 2, 15, 10, 0, 0, 0);
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({
					id: 18,
					date: new Date(2026, 2, 20, 12, 0, 0, 0),
					quantity: 20,
					totalCost: 30,
					calculatedConsumption: 5
				})
			],
			[]
		);

		expect(
			summarizeHistoryEntriesForTimePeriod(entries, 'current-month', 'L/100km', referenceDate)
		).toMatchObject({
			timePeriod: 'current-month',
			totalSpend: 30,
			totalFuelVolume: 20
		});
		expect(
			summarizeHistoryEntriesForTimePeriod(entries, 'year-to-date', 'L/100km', referenceDate)
		).toMatchObject({
			timePeriod: 'year-to-date',
			totalSpend: 0,
			totalFuelVolume: 0,
			averageConsumption: null
		});
	});

	it('summarizes spend, fuel volume, and weighted average consumption from mixed entries', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({
					id: 11,
					date: new Date('2026-03-12T12:00:00Z'),
					quantity: 40,
					totalCost: 78,
					calculatedConsumption: 8
				}),
				createFuelEntry({
					id: 9,
					date: new Date('2026-02-10T12:00:00Z'),
					quantity: 20,
					totalCost: 44,
					calculatedConsumption: 10
				}),
				createFuelEntry({
					id: 7,
					date: new Date('2026-02-05T12:00:00Z'),
					quantity: 35,
					totalCost: 51,
					calculatedConsumption: 0
				})
			],
			[
				createMaintenanceEntry({
					id: 21,
					date: new Date('2026-03-10T12:00:00Z'),
					cost: 120
				})
			]
		);

		const summary = summarizeHistoryEntries(entries, 'L/100km');

		expect(summary.totalSpend).toBe(293);
		expect(summary.totalFuelVolume).toBe(95);
		expect(summary.fuelVolumeUnit).toBe('L');
		expect(summary.averageConsumption).toBeCloseTo(8.5714, 4);
		expect(summary.averageConsumptionUnit).toBe('L');
	});

	it('converts mixed fuel units into the preferred metric summary without dropping visible logs', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({
					id: 11,
					date: new Date('2026-03-12T12:00:00Z'),
					quantity: 40,
					unit: 'L',
					distanceUnit: 'km',
					totalCost: 78,
					calculatedConsumption: 8
				}),
				createFuelEntry({
					id: 9,
					date: new Date('2026-03-10T12:00:00Z'),
					quantity: 10,
					unit: 'gal',
					distanceUnit: 'mi',
					totalCost: 44,
					calculatedConsumption: 25
				})
			],
			[]
		);

		const summary = summarizeHistoryEntries(entries, 'L/100km');

		expect(summary.totalSpend).toBe(122);
		expect(summary.totalFuelVolume).toBeCloseTo(40 + 10 * litersPerGallon, 6);
		expect(summary.fuelVolumeUnit).toBe('L');
		expect(summary.averageConsumption).toBeCloseTo(
			((40 + 10 * litersPerGallon) / (500 + 250 * kilometersPerMile)) * 100,
			6
		);
		expect(summary.averageConsumptionUnit).toBe('L');
	});

	it('converts mixed fuel units into the preferred imperial summary without dropping visible logs', () => {
		const entries = mergeHistoryEntries(
			[
				createFuelEntry({
					id: 11,
					date: new Date('2026-03-12T12:00:00Z'),
					quantity: 40,
					unit: 'L',
					distanceUnit: 'km',
					totalCost: 78,
					calculatedConsumption: 8
				}),
				createFuelEntry({
					id: 9,
					date: new Date('2026-03-10T12:00:00Z'),
					quantity: 10,
					unit: 'gal',
					distanceUnit: 'mi',
					totalCost: 44,
					calculatedConsumption: 25
				})
			],
			[]
		);

		const summary = summarizeHistoryEntries(entries, 'MPG');

		expect(summary.totalSpend).toBe(122);
		expect(summary.totalFuelVolume).toBeCloseTo(10 + 40 / litersPerGallon, 6);
		expect(summary.fuelVolumeUnit).toBe('gal');
		expect(summary.averageConsumption).toBeCloseTo(
			(500 / kilometersPerMile + 250) / (10 + 40 / litersPerGallon),
			6
		);
		expect(summary.averageConsumptionUnit).toBe('gal');
	});

	it('returns zeroed fuel metrics and no average when only maintenance entries remain visible', () => {
		const entries = mergeHistoryEntries(
			[],
			[
				createMaintenanceEntry({
					id: 21,
					date: new Date('2026-03-10T12:00:00Z'),
					cost: 120
				})
			]
		);

		expect(summarizeHistoryEntries(entries, 'L/100km')).toEqual({
			totalSpend: 120,
			totalFuelVolume: 0,
			fuelVolumeUnit: 'L',
			averageConsumption: null,
			averageConsumptionUnit: 'L'
		});
	});
});
