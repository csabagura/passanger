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
