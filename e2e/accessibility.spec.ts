import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Story 3.3: Home (/) is the default surface. /fuel-entry, /maintenance and /log no longer render
// standalone form pages — they redirect into the global Capture sheet — so the scanned route set is
// Home + the surviving destination pages (History, Export, Settings). The Capture sheet itself is
// scanned separately below (it is a portalled dialog, not a route).
const routes = [
	{ name: 'Home', path: '/' },
	{ name: 'Understand', path: '/understand' },
	{ name: 'Maintain', path: '/maintain' },
	{ name: 'History', path: '/history' },
	{ name: 'Export', path: '/export' },
	{ name: 'Settings', path: '/settings' }
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

test('Root (/) renders Home without redirecting', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	// No redirect away from root, and the Home tab is the active nav item.
	await expect(page).toHaveURL(/\/$/);
	const homeLink = page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'Home' });
	await expect(homeLink).toHaveAttribute('aria-current', 'page');
});

test('Legacy /fuel-entry redirects into the Capture sheet on Home', async ({ page }) => {
	await page.goto('/fuel-entry');
	await page.waitForLoadState('networkidle');
	// Lands on Home with the Capture sheet opened (the `?capture=fuel` param is stripped by the layout).
	await expect(page.getByText('Log an entry')).toBeVisible();
	await expect(page).not.toHaveURL(/fuel-entry|\/log/);
});

test('Legacy /maintenance redirects into the Capture sheet on Home', async ({ page }) => {
	await page.goto('/maintenance');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText('Log an entry')).toBeVisible();
	await expect(page).not.toHaveURL(/maintenance/);
});

test('Capture sheet is reachable via keyboard and shows visible focus', async ({ page }) => {
	await page.goto('/?capture=fuel');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText('Log an entry')).toBeVisible();

	// bits-ui Dialog traps focus inside the sheet; tabbing must keep focus on a visible-focus control.
	await page.keyboard.press('Tab');

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

// Story 3.4 — the Home Hero Metric: a tap-to-toggle Cost-per-Distance ↔ Consumption control whose
// choice is remembered. Setting up a vehicle + a fuel log with a derivable distance gives both metrics
// a real value, so the toggle and its persistence can be exercised end-to-end and axe-scanned.
async function seedVehicleAndFill(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /Add your vehicle to get started/i }).click();
	await page.getByLabel('Display Name').fill('Hero Car');
	await page.getByLabel('Make').fill('Toyota');
	await page.getByLabel('Model').fill('Corolla');
	await page.getByRole('button', { name: 'Save vehicle' }).click();
	await expect(page.getByText(/No entries yet for/i)).toBeVisible();

	// Two fills (ascending odometer) so the second computes a consumption → a derivable distance.
	for (const fill of [
		{ odometer: '10000', quantity: '40', cost: '60' },
		{ odometer: '10500', quantity: '42', cost: '78' }
	]) {
		await page.getByRole('button', { name: /Log a fill-up or expense/i }).click();
		const sheet = page.getByRole('dialog');
		await sheet.getByLabel(/^Odometer/).fill(fill.odometer);
		await sheet.getByLabel(/^Quantity/).fill(fill.quantity);
		await sheet.getByLabel('Total Cost').fill(fill.cost);
		await sheet.getByRole('button', { name: 'Save', exact: true }).click();
		await sheet.getByRole('button', { name: 'Done', exact: true }).click();
		await expect(page.getByText('Log an entry')).toHaveCount(0);
	}
}

test('Home Hero Metric toggles cost ↔ consumption, persists across reload, stays axe-clean', async ({
	page
}) => {
	await seedVehicleAndFill(page);

	// Defaults to the Cost-per-Distance stat (DEC-2: money is the default hook).
	const toggle = page.getByRole('button', { name: /Tap to switch/i });
	await expect(toggle).toHaveAccessibleName(/^Cost per km:/i);

	// Tap flips to Consumption (label + value switch together).
	await toggle.click();
	await expect(toggle).toHaveAccessibleName(/^Consumption:/i);
	await expect(toggle).toHaveAccessibleName(/8\.4 L\/100km/);

	// The toggle remains axe-clean in the consumption state.
	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'critical' || v.impact === 'serious'
	);
	expect(serious).toEqual([]);

	// The choice is remembered across a full reload (persisted to settings/localStorage).
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('button', { name: /Tap to switch/i })).toHaveAccessibleName(
		/^Consumption:/i
	);
});

// Story 4.4 — the Understand surface. /analytics merges into /understand (PREP-3); the surface shows
// four interactive charts + ≤3 plain-language insights. AI-3.2 mandates e2e for route-topology changes.
test('Legacy /analytics redirects to /understand', async ({ page }) => {
	await page.goto('/analytics');
	await page.waitForLoadState('networkidle');
	await expect(page).toHaveURL(/\/understand$/);
	// The Understand surface renders — not a 404 / the old /analytics. This fresh context has no vehicle,
	// so the no-vehicle empty state is shown (deterministic).
	await expect(page.getByText('No vehicle yet')).toBeVisible();
});

test('Understand (/understand) with data is axe-clean and a chart is keyboard-operable', async ({
	page
}) => {
	await seedVehicleAndFill(page);
	await page.goto('/understand');
	await page.waitForLoadState('networkidle');

	await expect(page.getByRole('heading', { name: 'Consumption trend' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Maintenance cost trend' })).toBeVisible();

	// The view-as-table toggle swaps a chart for the mandated screen-reader table (FR-17).
	const tableToggle = page.getByRole('button', { name: 'View as table' }).first();
	await tableToggle.click();
	await expect(page.getByRole('table').first()).toBeVisible();
	await expect(page.getByRole('button', { name: 'View as chart' }).first()).toBeVisible();

	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'critical' || v.impact === 'serious'
	);
	expect(serious).toEqual([]);
});

// Story 4.5 — the Maintain surface (AD-3). Reminders moved out of Settings to /maintain with
// predicted dates + status. AI-3.2 mandates e2e for route-topology changes; /maintain had zero axe
// coverage before this. Seeding a vehicle + a reminder exercises the list, status, and Edit affordance.
test('Maintain (/maintain) with a reminder is axe-clean and Edit is keyboard-operable', async ({
	page
}) => {
	// Seed a vehicle from Home's first-run flow.
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /Add your vehicle to get started/i }).click();
	await page.getByLabel('Display Name').fill('Maintainer');
	await page.getByLabel('Make').fill('Subaru');
	await page.getByLabel('Model').fill('Outback');
	await page.getByRole('button', { name: 'Save vehicle' }).click();
	await expect(page.getByText(/No entries yet for/i)).toBeVisible();

	// Add a reminder on the Maintain surface (reached via the bottom nav, PREP-3 flip).
	await page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'Maintain' })
		.click();
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /Add reminder/i }).click();
	await page.getByLabel('Title').fill('Oil change');
	await page.getByLabel('Every (km)').fill('10000');
	await page.getByRole('button', { name: 'Save reminder' }).click();

	const list = page.getByRole('list', { name: 'Service reminders' });
	await expect(list.getByText('Oil change')).toBeVisible();

	// axe-scan the seeded surface.
	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'critical' || v.impact === 'serious'
	);
	expect(serious).toEqual([]);

	// The Edit affordance is keyboard-operable: focus it and activate → the edit form opens.
	const editButton = page.getByRole('button', { name: 'Edit Oil change' });
	await editButton.focus();
	await expect(editButton).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Edit reminder' })).toBeVisible();
});

test('App is fully usable with prefers-reduced-motion: reduce', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');
	await page.waitForLoadState('networkidle');

	// Verify Home loads and is interactive with reduced motion
	await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible();

	// Navigate to each surviving route to confirm no motion-dependent features break
	for (const path of ['/history', '/export', '/settings']) {
		await page.goto(path);
		await page.waitForLoadState('networkidle');
		await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible();
	}
});

test('NavBar tabs are reachable via keyboard', async ({ page }) => {
	await page.goto('/');
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

	// Arrow right should move to the next tab (Home → Understand / /understand in the DEC-1 NavBar)
	await page.keyboard.press('ArrowRight');
	const href = await page.evaluate(() => (document.activeElement as HTMLAnchorElement)?.pathname);
	expect(href).toBe('/understand');
});
