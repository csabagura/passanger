import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// AI-5.3 / FR-18 (Epic 6 Paraglide foundation, ADR-002): switching language in Settings persists
// across reloads and re-renders BUNDLED messages with ZERO off-device network requests — Paraglide
// compiles translations into the app bundle (CSP connect-src 'none'); nothing is fetched at runtime.
// Also axe-scans the Hungarian Settings surface (a re-surfaced UI must be verified, not assumed).
test('Settings language switch: EN→HU persists across reload, renders bundled HU strings, no network', async ({
	page
}) => {
	// Fail if ANYTHING is fetched off-device — translations must be bundled, never fetched.
	const offDeviceRequests: string[] = [];
	page.on('request', (req) => {
		const url = req.url();
		if (
			!url.startsWith('http://localhost:4173') &&
			!url.startsWith('data:') &&
			!url.startsWith('blob:')
		) {
			offDeviceRequests.push(url);
		}
	});

	await page.goto('/settings');
	await page.waitForLoadState('networkidle');

	// Base locale (English): the bottom-nav labels render English message strings (m.nav_*()).
	await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Maintain' })).toBeVisible();

	// Switch to Hungarian via the Settings language selector. setLocale() reloads (reload-on-switch).
	await page.getByRole('combobox', { name: 'Language' }).selectOption('hu');

	// After the reload, the nav renders Hungarian — proves message resolution + the persisted switch.
	await expect(page.getByRole('link', { name: 'Kezdőlap' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Karbantartás' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Home' })).toHaveCount(0);

	// Persists across a fresh reload (the localStorage locale strategy).
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('link', { name: 'Kezdőlap' })).toBeVisible();

	// The Hungarian Settings surface is axe-clean (no critical/serious WCAG 2.1 AA violations).
	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'critical' || v.impact === 'serious'
	);
	expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);

	// The entire flow (initial load + switch + two reloads) made ZERO off-device requests.
	expect(offDeviceRequests, `off-device requests: ${offDeviceRequests.join(', ')}`).toEqual([]);
});
