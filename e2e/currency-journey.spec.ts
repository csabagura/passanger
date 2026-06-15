import { test, expect, type Page } from '@playwright/test';

// Fresh context per test → empty IndexedDB → first-run state on /log.

async function createVehicle(page: Page, name: string): Promise<void> {
	await page.goto('/log');
	await page.waitForLoadState('networkidle');

	await expect(page.getByRole('heading', { name: 'No vehicle yet' })).toBeVisible();
	await page.getByRole('button', { name: /Add your vehicle to get started/i }).click();

	await page.getByLabel('Display Name').fill(name);
	await page.getByLabel('Make').fill('Honda');
	await page.getByLabel('Model').fill('Civic');
	await page.getByRole('button', { name: 'Save vehicle' }).click();

	await expect(page.getByRole('radiogroup', { name: 'Log mode' })).toBeVisible();
}

async function addFuelLog(
	page: Page,
	values: { odometer: string; quantity: string; cost: string; currency: string }
): Promise<void> {
	const fuelRadio = page.getByRole('radio', { name: 'Fuel' });
	if ((await fuelRadio.getAttribute('aria-checked')) !== 'true') {
		await fuelRadio.click();
	}

	await page.getByLabel(/^Odometer/).fill(values.odometer);
	await page.getByLabel(/^Quantity/).fill(values.quantity);
	await page.getByLabel('Total Cost').fill(values.cost);
	// The currency picker sits next to the cost field; the entry is stored in this currency.
	await page.getByLabel('Currency').selectOption(values.currency);
	await page.getByRole('button', { name: 'Save', exact: true }).click();

	await expect(page.getByRole('status').filter({ hasText: /Logged|log one more/i })).toBeVisible();
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

	// Add a second fill-up in euro (€). Euro keeps two decimals and a prefix symbol.
	await page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'Log' })
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
