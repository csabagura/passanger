import type { FuelUnit } from '$lib/config';
import type { Expense, FuelLog } from '$lib/db/schema';

export type HistoryEntryFilter = 'all' | 'fuel' | 'maintenance';
export type HistoryFuelVolumeUnit = FuelLog['unit'];
export type HistoryTimePeriod = 'current-month' | 'year-to-date' | 'all-time';

export type HistoryEntry =
	| { kind: 'fuel'; entry: FuelLog }
	| { kind: 'maintenance'; entry: Expense };

export interface HistoryTimePeriodOption {
	value: HistoryTimePeriod;
	label: 'This month' | 'This year' | 'All time';
	ariaLabel: 'this month' | 'this year' | 'all time';
}

export interface HistoryMonthGroup {
	key: string;
	label: string;
	subtotalCost: number;
	entries: HistoryEntry[];
}

export interface HistorySummary {
	totalSpend: number;
	totalFuelVolume: number;
	fuelVolumeUnit: HistoryFuelVolumeUnit;
	averageConsumption: number | null;
	averageConsumptionUnit: HistoryFuelVolumeUnit;
}

export interface HistoryTimePeriodSummary extends HistorySummary {
	timePeriod: HistoryTimePeriod;
	periodLabel: HistoryTimePeriodOption['label'];
	periodAriaLabel: HistoryTimePeriodOption['ariaLabel'];
}

export interface CurrentMonthHistorySummary extends HistoryTimePeriodSummary {
	monthKey: string;
	calendarLabel: string;
}

import { LITERS_PER_GALLON, KILOMETERS_PER_MILE } from '$lib/utils/calculations';

export const historyTimePeriodOptions = [
	{
		value: 'current-month',
		label: 'This month',
		ariaLabel: 'this month'
	},
	{
		value: 'year-to-date',
		label: 'This year',
		ariaLabel: 'this year'
	},
	{
		value: 'all-time',
		label: 'All time',
		ariaLabel: 'all time'
	}
] as const satisfies ReadonlyArray<HistoryTimePeriodOption>;

const historyTimePeriodOptionsByValue = new Map<HistoryTimePeriod, HistoryTimePeriodOption>(
	historyTimePeriodOptions.map((option) => [option.value, option])
);

export function getHistoryEntryKey(value: HistoryEntry): string {
	return `${value.kind}-${value.entry.id}`;
}

export function compareHistoryEntriesNewestFirst(left: HistoryEntry, right: HistoryEntry): number {
	const dateDifference = right.entry.date.getTime() - left.entry.date.getTime();
	return dateDifference !== 0 ? dateDifference : right.entry.id - left.entry.id;
}

export function mergeHistoryEntries(fuelLogs: FuelLog[], expenses: Expense[]): HistoryEntry[] {
	return [
		...fuelLogs.map((entry) => ({ kind: 'fuel', entry }) satisfies HistoryEntry),
		...expenses.map((entry) => ({ kind: 'maintenance', entry }) satisfies HistoryEntry)
	].sort(compareHistoryEntriesNewestFirst);
}

export function filterHistoryEntries(
	entries: HistoryEntry[],
	filter: HistoryEntryFilter
): HistoryEntry[] {
	if (filter === 'all') {
		return entries;
	}

	return entries.filter((entry) => entry.kind === filter);
}

function getHistoryEntryCost(entry: HistoryEntry): number {
	return entry.kind === 'fuel' ? entry.entry.totalCost : entry.entry.cost;
}

function getHistoryMonthKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getHistoryTimePeriodOption(period: HistoryTimePeriod): HistoryTimePeriodOption {
	const option = historyTimePeriodOptionsByValue.get(period);
	if (!option) {
		throw new Error(`Unsupported history time period: ${period}`);
	}

	return option;
}

function formatHistoryMonthLabel(date: Date, locale: Intl.LocalesArgument = undefined): string {
	return new Intl.DateTimeFormat(locale, {
		month: 'long',
		year: 'numeric'
	}).format(date);
}

function getPreferredFuelVolumeUnit(preferredFuelUnit: FuelUnit): HistoryFuelVolumeUnit {
	return preferredFuelUnit === 'MPG' ? 'gal' : 'L';
}

function convertFuelVolumeToUnit(
	quantity: number,
	fromUnit: HistoryFuelVolumeUnit,
	toUnit: HistoryFuelVolumeUnit
): number {
	if (fromUnit === toUnit) {
		return quantity;
	}

	return fromUnit === 'L' ? quantity / LITERS_PER_GALLON : quantity * LITERS_PER_GALLON;
}

function convertDistanceToUnit(
	distance: number,
	fromUnit: 'km' | 'mi',
	toUnit: 'km' | 'mi'
): number {
	if (fromUnit === toUnit) {
		return distance;
	}

	return fromUnit === 'km' ? distance / KILOMETERS_PER_MILE : distance * KILOMETERS_PER_MILE;
}

function isHistoryEntryInTimePeriod(
	entryDate: Date,
	period: HistoryTimePeriod,
	referenceDate: Date
): boolean {
	switch (period) {
		case 'current-month':
			return (
				entryDate.getFullYear() === referenceDate.getFullYear() &&
				entryDate.getMonth() === referenceDate.getMonth()
			);
		case 'year-to-date':
			return (
				entryDate.getTime() <= referenceDate.getTime() &&
				entryDate.getTime() >= new Date(referenceDate.getFullYear(), 0, 1, 0, 0, 0, 0).getTime()
			);
		case 'all-time':
			return true;
	}
}

function getFuelEntryDistance(entry: FuelLog): number | null {
	if (entry.calculatedConsumption <= 0 || entry.quantity <= 0) {
		return null;
	}

	return entry.unit === 'L'
		? (entry.quantity / entry.calculatedConsumption) * 100
		: entry.calculatedConsumption * entry.quantity;
}

export function groupHistoryEntriesByMonth(
	entries: HistoryEntry[],
	locale: Intl.LocalesArgument = undefined
): HistoryMonthGroup[] {
	const monthGroups: HistoryMonthGroup[] = [];

	for (const entry of entries) {
		const monthKey = getHistoryMonthKey(entry.entry.date);
		const lastGroup = monthGroups.at(-1);

		if (lastGroup?.key === monthKey) {
			lastGroup.entries.push(entry);
			lastGroup.subtotalCost += getHistoryEntryCost(entry);
			continue;
		}

		monthGroups.push({
			key: monthKey,
			label: formatHistoryMonthLabel(entry.entry.date, locale),
			subtotalCost: getHistoryEntryCost(entry),
			entries: [entry]
		});
	}

	return monthGroups;
}

export function summarizeHistoryEntries(
	entries: HistoryEntry[],
	preferredFuelUnit: FuelUnit = 'L/100km'
): HistorySummary {
	const totalSpend = entries.reduce((sum, entry) => sum + getHistoryEntryCost(entry), 0);
	const preferredVolumeUnit = getPreferredFuelVolumeUnit(preferredFuelUnit);
	const preferredDistanceUnit = preferredVolumeUnit === 'L' ? 'km' : 'mi';
	const fuelEntries = entries.filter(
		(entry): entry is Extract<HistoryEntry, { kind: 'fuel' }> => entry.kind === 'fuel'
	);
	const totalFuelVolume = fuelEntries.reduce(
		(sum, fuelEntry) =>
			sum +
			convertFuelVolumeToUnit(fuelEntry.entry.quantity, fuelEntry.entry.unit, preferredVolumeUnit),
		0
	);

	let totalQuantityInPreferredUnit = 0;
	let totalDistanceInPreferredUnit = 0;

	for (const fuelEntry of fuelEntries) {
		const entryDistance = getFuelEntryDistance(fuelEntry.entry);
		if (entryDistance === null) {
			continue;
		}

		totalQuantityInPreferredUnit += convertFuelVolumeToUnit(
			fuelEntry.entry.quantity,
			fuelEntry.entry.unit,
			preferredVolumeUnit
		);
		totalDistanceInPreferredUnit += convertDistanceToUnit(
			entryDistance,
			fuelEntry.entry.distanceUnit,
			preferredDistanceUnit
		);
	}

	return {
		totalSpend,
		totalFuelVolume,
		fuelVolumeUnit: preferredVolumeUnit,
		averageConsumption:
			totalQuantityInPreferredUnit > 0 && totalDistanceInPreferredUnit > 0
				? preferredVolumeUnit === 'L'
					? (totalQuantityInPreferredUnit / totalDistanceInPreferredUnit) * 100
					: totalDistanceInPreferredUnit / totalQuantityInPreferredUnit
				: null,
		averageConsumptionUnit: preferredVolumeUnit
	};
}

export function summarizeHistoryEntriesForTimePeriod(
	entries: HistoryEntry[],
	period: HistoryTimePeriod,
	preferredFuelUnit: FuelUnit = 'L/100km',
	referenceDate: Date = new Date()
): HistoryTimePeriodSummary {
	const periodOption = getHistoryTimePeriodOption(period);
	const periodEntries = entries.filter((entry) =>
		isHistoryEntryInTimePeriod(entry.entry.date, period, referenceDate)
	);

	return {
		timePeriod: period,
		periodLabel: periodOption.label,
		periodAriaLabel: periodOption.ariaLabel,
		...summarizeHistoryEntries(periodEntries, preferredFuelUnit)
	};
}

export function summarizeCurrentMonthHistoryEntries(
	entries: HistoryEntry[],
	preferredFuelUnit: FuelUnit = 'L/100km',
	referenceDate: Date = new Date(),
	locale: Intl.LocalesArgument = undefined
): CurrentMonthHistorySummary {
	const currentMonthSummary = summarizeHistoryEntriesForTimePeriod(
		entries,
		'current-month',
		preferredFuelUnit,
		referenceDate
	);

	return {
		monthKey: getHistoryMonthKey(referenceDate),
		calendarLabel: formatHistoryMonthLabel(referenceDate, locale),
		...currentMonthSummary
	};
}
