import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Fresh context per test → empty IndexedDB → first-run state on Home (/). Story 3.3: capture happens
// in the global Capture sheet opened by the FAB.

async function createVehicle(page: Page, name: string): Promise<void> {
	await page.goto('/');
	await page.waitForLoadState('networkidle');

	await expect(page.getByRole('heading', { name: 'No vehicle yet' })).toBeVisible();
	await page.getByRole('button', { name: /Add your vehicle to get started/i }).click();

	await page.getByLabel('Display Name').fill(name);
	await page.getByLabel('Make').fill('Honda');
	await page.getByLabel('Model').fill('Civic');
	// Story 9.1: the onboarding wizard replaced the single-form first-run — advance its 3 steps.
	await page.getByRole('button', { name: 'Next' }).click();
	await page.getByRole('button', { name: 'Next' }).click();
	await page.getByRole('button', { name: 'Finish setup' }).click();

	await expect(page.getByText(/No entries yet for/i)).toBeVisible();
}

async function addFuelLog(
	page: Page,
	values: { odometer: string; quantity: string; cost: string; currency: string }
): Promise<void> {
	await page.getByRole('button', { name: /Log a fill-up or expense/i }).click();
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByRole('tab', { name: 'Fuel', selected: true })).toBeVisible();

	await sheet.getByLabel(/^Odometer/).fill(values.odometer);
	await sheet.getByLabel(/^Quantity/).fill(values.quantity);
	await sheet.getByLabel('Total Cost').fill(values.cost);
	// The currency picker sits next to the cost field; the entry is stored in this currency.
	await sheet.getByLabel('Currency').selectOption(values.currency);
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();

	await expect(sheet.getByRole('status').filter({ hasText: /Saved|log one more/i })).toBeVisible();
	await sheet.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(page.getByText('Log an entry')).toHaveCount(0);
}

async function gotoHistory(page: Page): Promise<void> {
	await page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'History' })
		.click();
	await page.waitForLoadState('networkidle');
	// The page body has its own <h1>History</h1>; the app header also shows the page title,
	// so scope to <main> to disambiguate.
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'History', level: 1 })
	).toBeVisible();
}

// The list of entry cards (scoped away from the stat bar, which also renders amounts).
function entriesList(page: Page) {
	return page.getByRole('list', { name: /History entries for/ });
}

test('multi-currency: forint formatting and segmented totals', async ({ page }) => {
	await createVehicle(page, 'Border Hopper');

	// First fill-up in forint (Ft). Forint is a zero-decimal, suffix currency → "20000 Ft".
	await addFuelLog(page, { odometer: '50000', quantity: '40', cost: '20000', currency: 'Ft' });

	await gotoHistory(page);

	// History formats the forint entry without decimals and with the symbol after the amount.
	await expect(entriesList(page).getByText('20000 Ft', { exact: true })).toBeVisible();
	await expect(page.getByText(/Ft20000|Ft 20000/)).toHaveCount(0);

	// Add a second fill-up in euro (€). Euro keeps two decimals and a prefix symbol. The Capture sheet
	// is reachable from any surface via the FAB, so navigate Home first, then open it.
	await page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'Home' })
		.click();
	await page.waitForLoadState('networkidle');
	await addFuelLog(page, { odometer: '50400', quantity: '38', cost: '50', currency: '€' });

	await gotoHistory(page);

	// The stat bar cannot sum across currencies (no FX rate); it segments each currency's
	// subtotal instead. Both the forint and euro totals appear, not a single summed number.
	const statBar = page.getByRole('region', { name: 'History totals' });
	await expect(statBar).toBeVisible();
	const totalSpend = statBar.locator('div', { has: page.getByText('Total spend') }).locator('dd');
	await expect(totalSpend).toContainText('20000 Ft');
	await expect(totalSpend).toContainText('€50.00');

	// Both entries are still individually listed with their own currency formatting.
	await expect(entriesList(page).getByText('20000 Ft', { exact: true })).toBeVisible();
	await expect(entriesList(page).getByText('€50.00', { exact: true })).toBeVisible();
});

test('Display rate: Understand shows one blended total only after a rate is set', async ({
	page
}) => {
	await createVehicle(page, 'Border Hopper');

	// Spend across two currencies: 20000 Ft + €50 (home currency defaults to €).
	await addFuelLog(page, { odometer: '50000', quantity: '40', cost: '20000', currency: 'Ft' });
	await page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'Home' })
		.click();
	await page.waitForLoadState('networkidle');
	await addFuelLog(page, { odometer: '50400', quantity: '38', cost: '50', currency: '€' });

	// Before any Display Rate is set, Understand shows the honest per-currency note and NO blend.
	await page.goto('/understand');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText(/Other currencies aren't/i)).toBeVisible();
	await expect(page.getByText(/using your rate/i)).toHaveCount(0);

	// Set a Display Rate for Ft in Settings (1 Ft = €0.0025).
	await page.goto('/settings');
	await page.waitForLoadState('networkidle');
	await page.getByLabel('1 Ft =').fill('0.0025');
	await page.getByRole('button', { name: 'Save settings' }).click();
	// The save persists to localStorage; the next full navigation re-reads it into the settings context.

	// Back on Understand the single blended total appears, labeled with the user's own rate (the weak
	// forint forward-rate rounds to €0.00, so the label flips to the legible inverse "1 € = 400 Ft").
	await page.goto('/understand');
	await page.waitForLoadState('networkidle');
	// €50 + 20000 Ft × 0.0025 = €100.00.
	await expect(page.getByText('≈ €100.00 using your rate (1 € = 400 Ft)')).toBeVisible();
	// Every foreign currency is now rated → the unconverted note has nothing left to list.
	await expect(page.getByText(/Other currencies aren't/i)).toHaveCount(0);

	// The blended total is real text on an accessible surface (NFR-3).
	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'critical' || v.impact === 'serious'
	);
	expect(serious).toEqual([]);
});
