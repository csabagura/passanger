import type { FuelUnit } from '$lib/config';
import { DEFAULT_CURRENCY } from '$lib/config';
import type { Expense, FuelLog } from '$lib/db/schema';
import { isFiniteNumber } from '$lib/utils/calculations';
import { m } from '$lib/paraglide/messages';

export type HistoryEntryFilter = 'all' | 'fuel' | 'maintenance';
export type HistoryFuelVolumeUnit = FuelLog['unit'];
export type HistoryTimePeriod = 'current-month' | 'year-to-date' | 'all-time';

export type HistoryEntry =
	| { kind: 'fuel'; entry: FuelLog }
	| { kind: 'maintenance'; entry: Expense };

export interface HistoryTimePeriodOption {
	value: HistoryTimePeriod;
	// i18n (6.1): label + ariaLabel resolve through Paraglide (m.history_period_*), so they are
	// `string` rather than the former English literal unions.
	label: string;
	ariaLabel: string;
}

export interface HistoryMonthGroup {
	key: string;
	label: string;
	subtotalCost: number;
	entries: HistoryEntry[];
}

export interface HistorySummary {
	totalSpend: number;
	totalSpendByCurrency: Record<string, number>;
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
		label: m.history_period_current_month(),
		ariaLabel: m.history_period_aria_current_month()
	},
	{
		value: 'year-to-date',
		label: m.history_period_year_to_date(),
		ariaLabel: m.history_period_aria_year_to_date()
	},
	{
		value: 'all-time',
		label: m.history_period_all_time(),
		ariaLabel: m.history_period_aria_all_time()
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

/** The currency an entry was logged in, falling back to the home currency for legacy rows. */
export function resolveHistoryEntryCurrency(entry: HistoryEntry, homeCurrency: string): string {
	return entry.entry.currency ?? homeCurrency;
}

/**
 * Sum spend grouped by currency. Currencies cannot be added together without an exchange
 * rate (and the app makes no network calls), so totals are reported per currency. Legacy
 * entries with no currency are attributed to the home currency. Non-finite `cost` rows are
 * skipped (PREP-1 convention) — a single `NaN`/`Infinity` would otherwise poison the whole
 * per-currency total, surfacing as `€NaN` and silently dropping the spend Insight that
 * `spendDelta` derives from this sum.
 */
export function summarizeSpendByCurrency(
	entries: HistoryEntry[],
	homeCurrency: string
): Record<string, number> {
	const byCurrency: Record<string, number> = {};
	for (const entry of entries) {
		const cost = getHistoryEntryCost(entry);
		if (!isFiniteNumber(cost)) {
			continue;
		}
		const currency = resolveHistoryEntryCurrency(entry, homeCurrency);
		byCurrency[currency] = (byCurrency[currency] ?? 0) + cost;
	}
	return byCurrency;
}

export interface ConvertedHomeSpend {
	total: number;
	unconvertedEntries: number;
	convertibleEntries: number;
	ratedEntries: number;
}

/**
 * Approximate a single home-currency total from user-entered exchange rates. The app makes no
 * network calls, so rates are supplied by the caller (from `AppSettings`). `rate[c]` is the
 * home-currency value of 1 unit of currency `c`; converted = cost × rate. Home-currency entries
 * always count at rate 1. Entries in a currency with no usable (finite > 0) rate are excluded
 * from the total and counted in `unconvertedEntries` so the UI can flag them. `ratedEntries`
 * counts non-home entries actually converted via a rate — the UI shows the converted total only
 * when this is > 0, so home-currency entries alone never produce a misleading partial total.
 */
export function convertHistorySpendToHome(
	entries: HistoryEntry[],
	homeCurrency: string,
	rates: Record<string, number> | undefined
): ConvertedHomeSpend {
	let total = 0;
	let unconvertedEntries = 0;
	let convertibleEntries = 0;
	let ratedEntries = 0;

	for (const entry of entries) {
		const currency = resolveHistoryEntryCurrency(entry, homeCurrency);
		const cost = getHistoryEntryCost(entry);

		// Skip corrupt rows (NaN/Infinity) before they reach `total`, mirroring the PREP-4.2 fold in
		// summarizeSpendByCurrency/monthlySpendByCurrency — `NaN <= 0 → false` slips the legacy guard and
		// would otherwise surface a dead `€NaN` blended total. A skipped row is neither converted nor
		// unconverted (it is corrupt, not foreign-without-rate), so it counts toward no tally.
		if (!isFiniteNumber(cost)) {
			continue;
		}

		if (currency === homeCurrency) {
			total += cost;
			convertibleEntries++;
			continue;
		}

		const rate = rates?.[currency];
		if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
			total += cost * rate;
			convertibleEntries++;
			ratedEntries++;
			continue;
		}

		unconvertedEntries++;
	}

	return { total, unconvertedEntries, convertibleEntries, ratedEntries };
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

/**
 * The entries that fall within a time period relative to `referenceDate` — the exact set the
 * period summary (and the converted-total helper) operate on.
 */
export function filterHistoryEntriesForTimePeriod(
	entries: HistoryEntry[],
	period: HistoryTimePeriod,
	referenceDate: Date = new Date()
): HistoryEntry[] {
	return entries.filter((entry) =>
		isHistoryEntryInTimePeriod(entry.entry.date, period, referenceDate)
	);
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
		// Keep the row visible but exclude a non-finite cost from the subtotal (PREP-1): the
		// entry still groups into the month; only `€NaN` is kept out of the displayed total,
		// staying in lockstep with the `totalSpend` guard below so the two never diverge.
		const cost = getHistoryEntryCost(entry);
		const subtotal = isFiniteNumber(cost) ? cost : 0;
		const lastGroup = monthGroups.at(-1);

		if (lastGroup?.key === monthKey) {
			lastGroup.entries.push(entry);
			lastGroup.subtotalCost += subtotal;
			continue;
		}

		monthGroups.push({
			key: monthKey,
			label: formatHistoryMonthLabel(entry.entry.date, locale),
			subtotalCost: subtotal,
			entries: [entry]
		});
	}

	return monthGroups;
}

export function summarizeHistoryEntries(
	entries: HistoryEntry[],
	preferredFuelUnit: FuelUnit = 'L/100km',
	homeCurrency: string = DEFAULT_CURRENCY
): HistorySummary {
	const totalSpend = entries.reduce((sum, entry) => {
		const cost = getHistoryEntryCost(entry);
		return sum + (isFiniteNumber(cost) ? cost : 0);
	}, 0);
	const totalSpendByCurrency = summarizeSpendByCurrency(entries, homeCurrency);
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
		totalSpendByCurrency,
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
	referenceDate: Date = new Date(),
	homeCurrency: string = DEFAULT_CURRENCY
): HistoryTimePeriodSummary {
	const periodOption = getHistoryTimePeriodOption(period);
	const periodEntries = filterHistoryEntriesForTimePeriod(entries, period, referenceDate);

	return {
		timePeriod: period,
		periodLabel: periodOption.label,
		periodAriaLabel: periodOption.ariaLabel,
		...summarizeHistoryEntries(periodEntries, preferredFuelUnit, homeCurrency)
	};
}

export function summarizeCurrentMonthHistoryEntries(
	entries: HistoryEntry[],
	preferredFuelUnit: FuelUnit = 'L/100km',
	referenceDate: Date = new Date(),
	locale: Intl.LocalesArgument = undefined,
	homeCurrency: string = DEFAULT_CURRENCY
): CurrentMonthHistorySummary {
	const currentMonthSummary = summarizeHistoryEntriesForTimePeriod(
		entries,
		'current-month',
		preferredFuelUnit,
		referenceDate,
		homeCurrency
	);

	return {
		monthKey: getHistoryMonthKey(referenceDate),
		calendarLabel: formatHistoryMonthLabel(referenceDate, locale),
		...currentMonthSummary
	};
}
