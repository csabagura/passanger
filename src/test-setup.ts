/**
 * Global Vitest setup: lock Intl.DateTimeFormat, Intl.NumberFormat, and
 * Number.prototype.toLocaleString to 'en' locale so all tests produce stable,
 * locale-independent output regardless of the OS locale on the test machine.
 *
 * Without this, formatLocalCalendarDate(date) and toLocaleString() produce
 * locale-specific strings (e.g. "2026. márc. 10." on Hungarian OS) that break
 * assertions hard-coded for English output ("Mar 10, 2026", "87,400").
 *
 * Intl.NumberFormat is also locked so components that derive localeGroupSeparator
 * and localeDecimalSeparator from NumberFormat behave consistently in tests
 * (Hungarian locale has no group separator, making separatorIsAmbiguousDecimal
 * incorrectly true for valid comma-decimal inputs like "12,345").
 */

const OriginalDateTimeFormat = Intl.DateTimeFormat;

class StableDateTimeFormat extends OriginalDateTimeFormat {
	constructor(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
		super(locales ?? 'en', options);
	}
}

// @ts-expect-error: intentionally replacing global Intl.DateTimeFormat for test stability
globalThis.Intl.DateTimeFormat = StableDateTimeFormat;

const OriginalNumberFormat = Intl.NumberFormat;

class StableNumberFormat extends OriginalNumberFormat {
	constructor(locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
		super(locales ?? 'en', options);
	}
}

// @ts-expect-error: intentionally replacing global Intl.NumberFormat for test stability
globalThis.Intl.NumberFormat = StableNumberFormat;

const _originalToLocaleString = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function (
	locales?: Intl.LocalesArgument,
	options?: Intl.NumberFormatOptions
): string {
	return _originalToLocaleString.call(this, locales ?? 'en', options);
};
