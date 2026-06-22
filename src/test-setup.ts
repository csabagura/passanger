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

// jsdom has no `window.matchMedia`. The app guards it (layout theme $effect), but svelte-sonner's
// Toaster — now mounted in the root layout (story 1.4) — calls it unconditionally, so any test that
// renders the layout or the Toaster needs a stub. Provide a minimal no-match implementation.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
	window.matchMedia = (query: string) =>
		({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		}) as unknown as MediaQueryList;
}

// jsdom implements neither IntersectionObserver nor ResizeObserver. bits-ui's Sheet/Dialog (Epic 2's
// global Capture Sheet, story 2-1) and observer-driven UI (LiveQuery-backed lists, intersection/resize
// effects in Epic 2/3) construct them on mount and would throw under jsdom. Stub both with inert no-ops.
// Added AHEAD of the Sheet/draft tests per Epic 1 retro AI-5 (proactive, not reactive). Focus-trap needs
// no stub — bits-ui drives focus via real DOM APIs jsdom supports.
if (typeof globalThis.IntersectionObserver !== 'function') {
	class IntersectionObserverStub {
		readonly root = null;
		readonly rootMargin = '';
		readonly thresholds: readonly number[] = [];
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
		takeRecords(): IntersectionObserverEntry[] {
			return [];
		}
	}
	globalThis.IntersectionObserver =
		IntersectionObserverStub as unknown as typeof IntersectionObserver;
}

if (typeof globalThis.ResizeObserver !== 'function') {
	class ResizeObserverStub {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	}
	globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

const _originalToLocaleString = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function (
	locales?: Intl.LocalesArgument,
	options?: Intl.NumberFormatOptions
): string {
	return _originalToLocaleString.call(this, locales ?? 'en', options);
};
