import { describe, it, expect } from 'vitest';
import {
	normalizeGroupingWhitespace,
	escapeRegExp,
	getLocaleNumberSeparators,
	parseGroupedCandidateWithSeparator,
	parseGroupedOdometerCandidate,
	parsePositiveNumeric,
	parseNonNegativeNumeric,
	isCollapsedFirstEntryDecimal,
	isGroupedOdometerValue
} from './numberInput';

describe('normalizeGroupingWhitespace', () => {
	it('collapses runs of spaces, NBSP and narrow NBSP to a single space and trims', () => {
		expect(normalizeGroupingWhitespace('  1 000 000  ')).toBe('1 000 000');
		expect(normalizeGroupingWhitespace('1   000')).toBe('1 000');
	});
});

describe('escapeRegExp', () => {
	it('escapes regex metacharacters', () => {
		expect(escapeRegExp('.')).toBe('\\.');
		expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
	});
});

describe('getLocaleNumberSeparators', () => {
	it('returns a decimal separator and (optionally) a group separator', () => {
		const seps = getLocaleNumberSeparators();
		expect(typeof seps.decimal).toBe('string');
		expect(seps.decimal.length).toBeGreaterThan(0);
		// group may be undefined for some locales, but in the jsdom default (en-US) it is ','
		expect(['string', 'undefined']).toContain(typeof seps.group);
	});
});

describe('parseGroupedCandidateWithSeparator', () => {
	it('parses a fully grouped number', () => {
		expect(parseGroupedCandidateWithSeparator('87,400', ',')).toBe(87400);
		expect(parseGroupedCandidateWithSeparator('1 000 000', ' ')).toBe(1000000);
	});
	it('returns null when the grouping is not clean', () => {
		expect(parseGroupedCandidateWithSeparator('87,40', ',')).toBeNull();
		expect(parseGroupedCandidateWithSeparator('8740', ',')).toBeNull();
	});
});

describe('parseGroupedOdometerCandidate', () => {
	it('detects space/comma/period grouping', () => {
		expect(parseGroupedOdometerCandidate('1 000')).toBe(1000);
		expect(parseGroupedOdometerCandidate('87,400')).toBe(87400);
		expect(parseGroupedOdometerCandidate('87.400')).toBe(87400);
	});
	it('returns null for an ungrouped number or empty', () => {
		expect(parseGroupedOdometerCandidate('87400')).toBeNull();
		expect(parseGroupedOdometerCandidate('')).toBeNull();
	});
	it('uses an exotic locale group separator when provided', () => {
		// Arabic thousands separator U+066C
		expect(parseGroupedOdometerCandidate('1٬000', '٬')).toBe(1000);
		// without the hint it is not recognized
		expect(parseGroupedOdometerCandidate('1٬000')).toBeNull();
	});
});

describe('parsePositiveNumeric (odometer/quantity, > 0)', () => {
	it('parses plain and comma decimals', () => {
		expect(parsePositiveNumeric('78.00')).toBe(78);
		expect(parsePositiveNumeric('78,5')).toBe(78.5);
		expect(parsePositiveNumeric('42')).toBe(42);
	});
	it('rejects zero, negatives, blanks and ambiguous double separators', () => {
		expect(parsePositiveNumeric('0')).toBeNull();
		expect(parsePositiveNumeric('-5')).toBeNull();
		expect(parsePositiveNumeric('')).toBeNull();
		expect(parsePositiveNumeric('   ')).toBeNull();
		expect(parsePositiveNumeric('1,000.5')).toBeNull();
	});
});

describe('parseNonNegativeNumeric (cost, >= 0)', () => {
	it('parses plain, comma decimal and zero', () => {
		expect(parseNonNegativeNumeric('78.00')).toBe(78);
		expect(parseNonNegativeNumeric('78,5')).toBe(78.5);
		expect(parseNonNegativeNumeric('0')).toBe(0);
	});
	it('rejects ambiguous double separators and blanks', () => {
		expect(parseNonNegativeNumeric('1,000.5')).toBeNull();
		expect(parseNonNegativeNumeric('1.000,5')).toBeNull();
		expect(parseNonNegativeNumeric('')).toBeNull();
	});
});

describe('isCollapsedFirstEntryDecimal', () => {
	it('treats "1,000" as a collapsed grouping on a first entry', () => {
		// parsed value of "1,000" as a comma-decimal would be 1 (one decimal-place lost)
		expect(isCollapsedFirstEntryDecimal('1,000', 1)).toBe(true);
	});
	it('never fires when a previous odometer baseline exists', () => {
		expect(isCollapsedFirstEntryDecimal('1,000', 1, true)).toBe(false);
	});
	it('returns false for period-grouped values', () => {
		expect(isCollapsedFirstEntryDecimal('1.000', 1)).toBe(false);
	});
});

describe('isGroupedOdometerValue — maintenance (default options)', () => {
	it('flags space- and comma-grouped values', () => {
		expect(isGroupedOdometerValue('1 000', 1000)).toBe(true);
		expect(isGroupedOdometerValue('87,400', 87400)).toBe(true);
	});
	it('does not flag a clean ungrouped reading', () => {
		expect(isGroupedOdometerValue('87400', 87400)).toBe(false);
	});
	it('flags when the parsed value is null but a grouped candidate exists', () => {
		expect(isGroupedOdometerValue('1 000', null)).toBe(true);
	});
});

describe('isGroupedOdometerValue — fuel (timeline-aware options)', () => {
	const fuelOpts = {
		localeGroupSeparator: ',',
		localeDecimalSeparator: '.',
		requireLocaleSpaceForWhitespaceGrouping: true,
		checkAmbiguousDecimalSeparator: true
	};

	it('matches the displayed previous-odometer hint exactly', () => {
		expect(
			isGroupedOdometerValue('87 400', 87400, {
				...fuelOpts,
				displayedPreviousOdometerHint: '87 400'
			})
		).toBe(true);
	});

	it('uses the comparable previous odometer to disambiguate', () => {
		// grouped candidate 87,400 > prev 50,000 and parsed (87.4) <= prev → grouped
		expect(
			isGroupedOdometerValue('87,400', 87.4, { ...fuelOpts, comparablePreviousOdometer: 50000 })
		).toBe(true);
		// parsed value already above the baseline → not treated as grouping error
		expect(
			isGroupedOdometerValue('87,400', 90000, { ...fuelOpts, comparablePreviousOdometer: 50000 })
		).toBe(false);
	});

	it('requires the locale group separator to be a space for whitespace grouping', () => {
		// locale group sep is ',' (not space) → a space-grouped value falls through to the
		// >=1000 integer check, which still flags an integer like 1000
		expect(isGroupedOdometerValue('1 000', 1000, fuelOpts)).toBe(true);
	});
});
