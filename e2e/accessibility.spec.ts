import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const routes = [
	{ name: 'Fuel Entry', path: '/fuel-entry' },
	{ name: 'Maintenance', path: '/maintenance' },
	{ name: 'History', path: '/history' },
	{ name: 'Export', path: '/export' }
];

for (const route of routes) {
	test(`${route.name} (${route.path}) has no critical or serious WCAG 2.1 AA violations`, async ({
		page
	}) => {
		await page.goto(route.path);
		// Wait for SvelteKit hydration / page content
		await page.waitForLoadState('networkidle');

		const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

		const serious = results.violations.filter(
			(v) => v.impact === 'critical' || v.impact === 'serious'
		);

		if (serious.length > 0) {
			const summary = serious
				.map(
					(v) =>
						`[${v.impact}] ${v.id}: ${v.description}\n` +
						v.nodes.map((n) => `  - ${n.html}`).join('\n')
				)
				.join('\n\n');
			expect.soft(serious, `Accessibility violations on ${route.path}:\n\n${summary}`).toEqual([]);
		}

		expect(serious).toEqual([]);
	});
}

test('Root (/) redirects to /fuel-entry', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/fuel-entry/);
});

test('Fuel Entry form fields are reachable via Tab and show visible focus', async ({ page }) => {
	await page.goto('/fuel-entry');
	await page.waitForLoadState('networkidle');

	// Tab through form — expect focus reaches the first input field
	await page.keyboard.press('Tab');

	// Keep tabbing until we reach an input field (skip any initial elements)
	for (let i = 0; i < 10; i++) {
		const tag = await page.evaluate(() => document.activeElement?.tagName);
		if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') break;
		await page.keyboard.press('Tab');
	}

	const activeTag = await page.evaluate(() => document.activeElement?.tagName);
	expect(['INPUT', 'SELECT', 'BUTTON']).toContain(activeTag);

	// Verify focus is visible (outline or ring style)
	const focusVisible = await page.evaluate(() => {
		const el = document.activeElement;
		if (!el) return false;
		const style = window.getComputedStyle(el);
		return (
			style.outlineStyle !== 'none' ||
			style.boxShadow !== 'none' ||
			el.classList.toString().includes('ring')
		);
	});
	expect(focusVisible).toBe(true);
});

test('App is fully usable with prefers-reduced-motion: reduce', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/fuel-entry');
	await page.waitForLoadState('networkidle');

	// Verify page loads and is interactive with reduced motion
	await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible();

	// Navigate to each route to confirm no motion-dependent features break
	for (const path of ['/maintenance', '/history', '/export']) {
		await page.goto(path);
		await page.waitForLoadState('networkidle');
		await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible();
	}
});

test('NavBar tabs are reachable via keyboard', async ({ page }) => {
	await page.goto('/fuel-entry');
	await page.waitForLoadState('networkidle');

	const nav = page.locator('nav[aria-label="Main navigation"]');
	await expect(nav).toBeVisible();

	// Focus the first nav link via Tab (may require multiple tabs)
	for (let i = 0; i < 20; i++) {
		await page.keyboard.press('Tab');
		const isInNav = await page.evaluate(() => {
			const el = document.activeElement;
			return el?.closest('nav[aria-label="Main navigation"]') !== null;
		});
		if (isInNav) break;
	}

	// Verify we reached a nav link
	const navLink = await page.evaluate(() => {
		const el = document.activeElement;
		return el?.tagName === 'A' && el?.closest('nav') !== null;
	});
	expect(navLink).toBe(true);

	// Arrow right should move to next tab
	await page.keyboard.press('ArrowRight');
	const href = await page.evaluate(() => (document.activeElement as HTMLAnchorElement)?.pathname);
	expect(href).toBe('/maintenance');
});
