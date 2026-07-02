// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { m } from '$lib/paraglide/messages';
import { getLocale, setLocale, baseLocale } from '$lib/paraglide/runtime';
import { formatLocalCalendarDate } from '$lib/utils/date';

// Paraglide i18n foundation (Epic 6 / ADR-002): proves EN/HU message resolution and the
// getLocale() formatter seam. setLocale(..., { reload: false }) switches the active locale
// WITHOUT the default page reload (jsdom can't reload); beforeEach pins 'en' for determinism.
describe('i18n foundation (Paraglide EN/HU)', () => {
	beforeEach(() => {
		setLocale('en', { reload: false });
	});

	afterEach(() => {
		// Reset so the active locale never leaks to other tests (the last test ends on 'hu').
		setLocale('en', { reload: false });
	});

	it('defaults to the base locale (English)', () => {
		expect(getLocale()).toBe(baseLocale);
		expect(getLocale()).toBe('en');
		expect(m.nav_home()).toBe('Home');
		expect(m.nav_maintain()).toBe('Maintain');
		expect(m.settings_title()).toBe('Settings');
	});

	it('resolves Hungarian messages after switching locale', () => {
		setLocale('hu', { reload: false });
		expect(getLocale()).toBe('hu');
		expect(m.nav_home()).toBe('Kezdőlap');
		expect(m.nav_maintain()).toBe('Karbantartás');
		expect(m.settings_title()).toBe('Beállítások');
	});

	it('threads the active locale into Intl date formatting (the formatter seam)', () => {
		const date = new Date(2026, 0, 15); // 15 January 2026
		const enLabel = formatLocalCalendarDate(date);
		expect(enLabel).toContain('Jan'); // English short month

		setLocale('hu', { reload: false });
		const huLabel = formatLocalCalendarDate(date);
		// The seam (`locale ?? getLocale()`) flows the active locale into Intl, so HU differs from EN.
		expect(huLabel).not.toBe(enLabel);
	});
});

// Story 6.1 (AI-5.3): the route-by-route string catalog. Asserts EN + HU resolution for
// representative new keys across every surface, plus dynamic-parameter and plural output in both
// locales. The e2e (e2e/i18n-language-switch.spec.ts) covers the real rendered path; this guards the
// catalog itself so an EN echo / missing HU / broken plural fails fast at the unit layer.
describe('i18n string catalog (Story 6.1, EN + HU)', () => {
	beforeEach(() => setLocale('en', { reload: false }));
	afterEach(() => setLocale('en', { reload: false }));

	// One representative static key per surface — EN exact, then HU exact (never an English echo).
	const STATIC: ReadonlyArray<[() => string, string, string]> = [
		[() => m.common_cancel(), 'Cancel', 'Mégse'], // universals
		[() => m.skip_to_content(), 'Skip to content', 'Ugrás a tartalomra'], // app chrome (Story 6.2 skip-link)
		[() => m.capture_title(), 'Log an entry', 'Bejegyzés rögzítése'], // B capture
		[() => m.fuel_field_cost(), 'Total Cost', 'Teljes költség'], // B fuel form
		[() => m.upnext_heading(), 'Up next', 'Következő'], // C Home
		[() => m.history_filter_all(), 'All', 'Mind'], // D History
		[() => m.understand_split_title(), 'Fuel vs maintenance', 'Üzemanyag vs. karbantartás'], // E Understand
		[() => m.maintain_heading(), 'Maintain', 'Karbantartás'], // F Maintain
		[() => m.reminder_status_overdue(), 'Overdue', 'Lejárt'], // F serviceReminder shared infra
		[() => m.settings_appearance_heading(), 'Appearance', 'Megjelenés'], // G Settings
		[() => m.import_step_source(), 'Source', 'Forrás'] // G Import wizard
	];

	it('resolves representative static keys to English at the base locale', () => {
		for (const [fn, en] of STATIC) {
			expect(fn()).toBe(en);
		}
	});

	it('resolves the same keys to real Hungarian after switching locale (no English echo)', () => {
		setLocale('hu', { reload: false });
		for (const [fn, en, hu] of STATIC) {
			expect(fn()).toBe(hu);
			expect(fn()).not.toBe(en); // a real translation, not an English placeholder
		}
	});

	it('interpolates parameters in both locales (no concatenation of translated fragments)', () => {
		// Home summary line — the #1 concat trap: complete templates with the vehicle name as a param.
		expect(
			m.home_tracking_fuel_expense({
				fuelPart: '3 fill-ups',
				expensePart: '2 expenses',
				vehicleName: 'Old Faithful'
			})
		).toBe('Tracking 3 fill-ups · 2 expenses for Old Faithful.');
		// Numeric param (vehicle-year validation) is interpolated, not glued, in both locales.
		expect(m.vehicleform_error_year({ max: 2026 })).toBe('Enter a valid year (1900–2026)');
		setLocale('hu', { reload: false });
		const hu = m.home_tracking_fuel_expense({
			fuelPart: '3 tankolás',
			expensePart: '2 kiadás',
			vehicleName: 'Öreg Hűség'
		});
		expect(hu).toContain('Öreg Hűség');
		expect(hu).toContain('3 tankolás');
		expect(hu).not.toContain('Tracking'); // Hungarian template, not the English one
		expect(m.vehicleform_error_year({ max: 2026 })).toContain('2026');
	});

	it('selects the correct plural category in English and Hungarian (Intl.PluralRules)', () => {
		// English: one vs other.
		expect(m.home_fillups_count({ count: 1 })).toBe('1 fill-up');
		expect(m.home_fillups_count({ count: 5 })).toBe('5 fill-ups');
		expect(m.import_preview_expenses({ count: 1 })).toBe('1 expense');
		expect(m.import_preview_expenses({ count: 3 })).toBe('3 expenses');
		// Hungarian: the noun stays singular after a numeral (one === other), authored natively.
		setLocale('hu', { reload: false });
		expect(m.home_fillups_count({ count: 1 })).toBe('1 tankolás');
		expect(m.home_fillups_count({ count: 5 })).toBe('5 tankolás');
		expect(m.import_preview_expenses({ count: 1 })).toBe('1 kiadás');
		expect(m.import_preview_expenses({ count: 3 })).toBe('3 kiadás');
	});

	it('localizes the string-producing utils end-to-end (insight + reminder reset) under Hungarian', () => {
		// EN baseline.
		expect(m.insight_consumption_up({ pct: 12 })).toBe('Consumption is up about 12% this month.');
		expect(m.reset_offer({ title: 'Oil Change' })).toBe('Logged. Reset the Oil Change reminder?');
		// HU — real translation, free-text title passed through verbatim as a param.
		setLocale('hu', { reload: false });
		expect(m.insight_consumption_up({ pct: 12 })).not.toContain('Consumption');
		expect(m.insight_consumption_up({ pct: 12 })).toContain('12%');
		expect(m.reset_offer({ title: 'Oil Change' })).toContain('Oil Change');
		expect(m.reset_offer({ title: 'Oil Change' })).not.toContain('Logged.');
	});
});
