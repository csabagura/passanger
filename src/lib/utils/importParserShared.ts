// Shared CSV-parser machinery reused by all three format parsers (Fuelly, aCar, Drivvo).
// Story 8.3 (AC3) — consolidates the byte-identical/near-identical helpers that had drifted into
// 3 separate copies. Date parsers are intentionally NOT here — they encode genuinely different,
// non-overlapping format grammars and must stay as 3 distinct functions (see story AC3 fence).

import { validateImportRow } from '$lib/utils/importValidation';
import type { ImportRow, NormalizedImportEntry } from '$lib/utils/importTypes';

/**
 * Normalize a numeric string that may use comma as decimal separator.
 * "1.234,56" → 1234.56 (European thousands + decimal comma)
 * "1234.56" → 1234.56 (US format, no change)
 * "1234,56" → 1234.56 (European decimal comma, no thousands)
 * Lifted unchanged from the former Drivvo-private implementation (Story 8.3 AC3) — now shared by
 * all three parsers so a comma-decimal cell never silently truncates via bare `parseFloat`.
 */
export function normalizeDecimal(value: string): number {
	const cleaned = value.trim();
	if (!cleaned) return NaN;
	const lastComma = cleaned.lastIndexOf(',');
	const lastDot = cleaned.lastIndexOf('.');
	if (lastComma > lastDot) {
		// Comma is decimal separator: remove dots (thousands), replace comma with dot
		return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
	}
	// Dot is decimal separator (or no separator): remove commas (thousands)
	return parseFloat(cleaned.replace(/,/g, ''));
}

/**
 * Find a column value case-insensitively from a row object.
 * Byte-identical across Fuelly/aCar prior to consolidation.
 */
export function getColumn(row: Record<string, string>, columnName: string): string {
	const key = Object.keys(row).find((k) => k.toLowerCase().trim() === columnName.toLowerCase());
	return key ? (row[key] ?? '') : '';
}

/**
 * True when PapaParse reported a fatal structural error (broken delimiter/quoting) — the same
 * filter duplicated in all 3 parsers' error handling.
 */
export function hasFatalParseErrors(errors: readonly { type: string }[] | undefined): boolean {
	if (!errors || errors.length === 0) return false;
	return errors.some((e) => e.type === 'Delimiter' || e.type === 'Quotes');
}

export interface ParsedEntry {
	data: Partial<NormalizedImportEntry>;
	rowNumber: number;
}

/**
 * Shared sort → validate → resort pipeline used by all 3 parsers to detect odometer-decrease
 * warnings in date order, then restore CSV row order for display.
 *
 * `groupKeyFn` supports both grouping shapes: Fuelly groups the decrease-chain per vehicle name
 * (multi-key); aCar/Drivvo have a single vehicle per file (constant key). Do not force one shape
 * onto the other.
 *
 * S7 hardening (Story 8.3 AC4): a row whose date failed to parse is excluded from the
 * odometer-decrease chain entirely — it neither seeds `prevOdometer` for its group nor is sorted
 * ahead of dated rows via an epoch(0) fallback. It is still validated and returned (its own
 * "unparseable date" error is unaffected), just processed after all dated rows in its group so it
 * cannot poison another row's decrease check.
 */
export function sortValidateResort(
	entries: ParsedEntry[],
	groupKeyFn: (entry: ParsedEntry) => string,
	validateOptionsFn?: (entry: ParsedEntry) => { skipQuantityValidation?: boolean } | undefined
): ImportRow[] {
	const hasValidDate = (entry: ParsedEntry): boolean =>
		entry.data.date instanceof Date && !isNaN(entry.data.date.getTime());

	// Dated rows sort by group then date so the decrease chain only ever sees real dates.
	// Undated rows are appended after their group's dated rows (order among themselves doesn't
	// matter — they can't seed or consume a decrease comparison).
	const sorted = [...entries].sort((a, b) => {
		const groupA = groupKeyFn(a);
		const groupB = groupKeyFn(b);
		if (groupA !== groupB) return groupA.localeCompare(groupB);
		const validA = hasValidDate(a);
		const validB = hasValidDate(b);
		if (validA !== validB) return validA ? -1 : 1;
		if (!validA) return 0;
		return (a.data.date as Date).getTime() - (b.data.date as Date).getTime();
	});

	const validatedRows: ImportRow[] = [];
	const prevOdometerByGroup = new Map<string, number>();

	for (const entry of sorted) {
		const group = groupKeyFn(entry);
		const prevOdometer = hasValidDate(entry) ? prevOdometerByGroup.get(group) : undefined;
		const validated = validateImportRow(
			entry.data,
			entry.rowNumber,
			prevOdometer,
			validateOptionsFn?.(entry)
		);
		validatedRows.push(validated);

		if (hasValidDate(entry) && entry.data.odometer != null && !isNaN(entry.data.odometer)) {
			prevOdometerByGroup.set(group, entry.data.odometer);
		}
	}

	// Re-sort by rowNumber for display order (original CSV order).
	validatedRows.sort((a, b) => a.rowNumber - b.rowNumber);

	return validatedRows;
}
