// Locale-aware numeric input parsing shared by FuelEntryForm and MaintenanceForm.
//
// Extracted from the two forms, which previously held copy-pasted (and slowly
// diverging) copies of this logic. The pure primitives are identical to both
// originals. The two context-dependent helpers — isCollapsedFirstEntryDecimal and
// isGroupedOdometerValue — are parameterized so each form's exact prior behavior is
// preserved: the fuel form passes the richer odometer-timeline context; the
// maintenance form relies on the (simpler) defaults.
//
// FIX #2 / locale handling: users in comma-decimal locales (e.g. "1 000,5") must be
// able to enter quantities/costs, and grouped odometer values like "87,400" or
// "1 000" must be rejected with guidance rather than silently mis-parsed.

const GROUPING_WHITESPACE_PATTERN = /[\s\u00A0\u202F]+/g;

/** Collapse all runs of whitespace (incl. NBSP / narrow NBSP) to a single space and trim. */
export function normalizeGroupingWhitespace(value: string): string {
	return value.replace(GROUPING_WHITESPACE_PATTERN, ' ').trim();
}

/** Escape a string for safe use inside a dynamically-built RegExp. */
export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface LocaleNumberSeparators {
	/** The locale's thousands-grouping separator, or undefined if none. */
	group: string | undefined;
	/** The locale's decimal separator (defaults to '.'). */
	decimal: string;
}

/** Detect the active locale's grouping and decimal separators via Intl. */
export function getLocaleNumberSeparators(): LocaleNumberSeparators {
	const parts = new Intl.NumberFormat().formatToParts(1000.1);
	return {
		group: parts.find((part) => part.type === 'group')?.value,
		decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.'
	};
}

/**
 * If `value` is a fully grouped number using `separator` every 3 digits
 * (e.g. "87,400" or "1 000 000"), return the un-grouped numeric value; else null.
 */
export function parseGroupedCandidateWithSeparator(
	value: string,
	separator: string
): number | null {
	const separatorPattern = escapeRegExp(separator);
	const groupedPattern = new RegExp(`^\\d{1,3}(?:${separatorPattern}\\d{3})+$`);
	if (!groupedPattern.test(value)) {
		return null;
	}

	const candidate = Number(value.replace(new RegExp(separatorPattern, 'g'), ''));
	return Number.isFinite(candidate) ? candidate : null;
}

/**
 * Detect a grouped odometer value across the common separators (space, comma, period)
 * and, when provided, an exotic locale grouping separator. Returns the un-grouped value
 * or null when the input is not a clean grouped number.
 */
export function parseGroupedOdometerCandidate(
	value: string,
	localeGroupSeparator?: string
): number | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	const normalizedWhitespace = normalizeGroupingWhitespace(trimmed);
	const candidates = [
		parseGroupedCandidateWithSeparator(normalizedWhitespace, ' '),
		parseGroupedCandidateWithSeparator(trimmed, ','),
		parseGroupedCandidateWithSeparator(trimmed, '.')
	];

	if (
		localeGroupSeparator &&
		localeGroupSeparator !== ',' &&
		localeGroupSeparator !== '.' &&
		normalizeGroupingWhitespace(localeGroupSeparator) !== ' '
	) {
		candidates.push(parseGroupedCandidateWithSeparator(trimmed, localeGroupSeparator));
	}

	return candidates.find((candidate) => candidate !== null) ?? null;
}

// Shared single-value numeric parser. Accepts at most one decimal separator (comma or
// period); a comma is normalized to a period. The leading `-?` in the pattern is
// retained from the fuel form's original; negatives are rejected downstream by the
// min-value check (so the only theoretical divergence from the maintenance form's old
// copy is "-0" → 0 instead of null, which is immaterial for odometer/quantity/cost).
function parseSingleNumeric(value: string, min: 0 | 'positive'): number | null {
	if (!value || !value.trim()) {
		return null;
	}

	let normalized = value.trim();

	const commaCount = (normalized.match(/,/g) || []).length;
	const periodCount = (normalized.match(/\./g) || []).length;

	if (commaCount + periodCount > 1) {
		return null;
	}

	if (commaCount === 1) {
		normalized = normalized.replace(',', '.');
	}

	if (!/^-?(\d+\.?\d*|\.\d+)$/.test(normalized)) {
		return null;
	}

	const parsed = Number.parseFloat(normalized);
	if (!Number.isFinite(parsed)) {
		return null;
	}

	if (min === 'positive') {
		return parsed > 0 ? parsed : null;
	}
	return parsed >= 0 ? parsed : null;
}

/** Parse a strictly positive number (> 0). Used for odometer and fuel quantity. */
export function parsePositiveNumeric(value: string): number | null {
	return parseSingleNumeric(value, 'positive');
}

/** Parse a non-negative number (>= 0). Used for cost. */
export function parseNonNegativeNumeric(value: string): number | null {
	return parseSingleNumeric(value, 0);
}

/**
 * Heuristic: did the user type a 3-decimal value like "1,000" that is really a grouped
 * "1000" collapsed onto a comma? Only meaningful for a first entry — when an odometer
 * baseline exists (`hasPreviousOdometer`), this never fires.
 */
export function isCollapsedFirstEntryDecimal(
	value: string,
	parsedValue: number,
	hasPreviousOdometer = false
): boolean {
	if (hasPreviousOdometer) {
		return false;
	}

	const trimmed = value.trim();
	if (!/^\d{1,3}[,.]\d{3}$/.test(trimmed)) {
		return false;
	}

	if (!trimmed.includes(',')) {
		return false;
	}

	const normalized = trimmed.replace(',', '.');
	const fraction = normalized.match(/\.(\d{3})$/)?.[1];
	if (!fraction) {
		return false;
	}

	const parsedFractionLength = parsedValue.toString().split('.')[1]?.length ?? 0;
	return parsedFractionLength < fraction.length;
}

export interface GroupedOdometerOptions {
	/** Locale grouping separator, forwarded to parseGroupedOdometerCandidate. */
	localeGroupSeparator?: string;
	/** Locale decimal separator, used by the ambiguous-decimal check. */
	localeDecimalSeparator?: string;
	/** Pre-formatted hint string of the previous odometer; exact match = grouped. */
	displayedPreviousOdometerHint?: string | null;
	/** Previous odometer to compare against, when a unit-comparable baseline exists. */
	comparablePreviousOdometer?: number | null;
	/** Fuel form: whitespace grouping only counts when the locale group sep is a space. */
	requireLocaleSpaceForWhitespaceGrouping?: boolean;
	/** Fuel form: also treat "decimal-sep + group-sep both present" as grouped. */
	checkAmbiguousDecimalSeparator?: boolean;
	/** Forwarded to isCollapsedFirstEntryDecimal. */
	hasPreviousOdometer?: boolean;
}

/**
 * Decide whether an odometer input string looks like a thousands-grouped number that
 * should be rejected (the app stores raw odometer integers, never grouped strings).
 *
 * Defaults reproduce the maintenance form's simpler behavior; the fuel form passes the
 * full options bag to reproduce its odometer-timeline-aware behavior.
 */
export function isGroupedOdometerValue(
	value: string,
	parsedValue: number | null,
	options: GroupedOdometerOptions = {}
): boolean {
	const {
		localeGroupSeparator,
		localeDecimalSeparator,
		displayedPreviousOdometerHint = null,
		comparablePreviousOdometer = null,
		requireLocaleSpaceForWhitespaceGrouping = false,
		checkAmbiguousDecimalSeparator = false,
		hasPreviousOdometer = false
	} = options;

	const trimmed = value.trim();
	if (!trimmed) {
		return false;
	}

	const normalizedTrimmed = normalizeGroupingWhitespace(trimmed);

	if (displayedPreviousOdometerHint && normalizedTrimmed === displayedPreviousOdometerHint) {
		return true;
	}

	const groupedCandidate = parseGroupedOdometerCandidate(trimmed, localeGroupSeparator);
	if (groupedCandidate === null) {
		return false;
	}

	if (comparablePreviousOdometer !== null) {
		if (parsedValue === null) {
			return true;
		}
		return (
			groupedCandidate > comparablePreviousOdometer && parsedValue <= comparablePreviousOdometer
		);
	}

	if (parsedValue === null) {
		return true;
	}

	const usesWhitespaceGrouping = requireLocaleSpaceForWhitespaceGrouping
		? normalizedTrimmed.includes(' ') &&
			localeGroupSeparator !== undefined &&
			normalizeGroupingWhitespace(localeGroupSeparator) === ' '
		: normalizedTrimmed.includes(' ');
	if (usesWhitespaceGrouping) {
		return true;
	}

	const separatorIsAmbiguousDecimal = checkAmbiguousDecimalSeparator
		? trimmed.includes(localeDecimalSeparator ?? '') && trimmed.includes(localeGroupSeparator ?? '')
		: false;

	return (
		groupedCandidate >= 1000 &&
		(Number.isInteger(parsedValue) ||
			isCollapsedFirstEntryDecimal(trimmed, parsedValue, hasPreviousOdometer) ||
			separatorIsAmbiguousDecimal)
	);
}
