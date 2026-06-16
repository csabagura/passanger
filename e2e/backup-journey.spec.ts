import { test, expect, type Page } from '@playwright/test';

// Fresh context per test → empty IndexedDB → first-run state on /log.
// Real round-trip: seed data, download a backup, mutate after the backup, then restore and assert
// the post-backup mutation is gone (proving the destructive replace-all restore works end to end).

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
	await page.goto('/log');
	await page.waitForLoadState('networkidle');

	const fuelRadio = page.getByRole('radio', { name: 'Fuel' });
	if ((await fuelRadio.getAttribute('aria-checked')) !== 'true') {
		await fuelRadio.click();
	}

	await page.getByLabel(/^Odometer/).fill(values.odometer);
	await page.getByLabel(/^Quantity/).fill(values.quantity);
	await page.getByLabel('Total Cost').fill(values.cost);
	await page.getByLabel('Currency').selectOption(values.currency);
	await page.getByRole('button', { name: 'Save', exact: true }).click();

	await expect(page.getByRole('status').filter({ hasText: /Logged|log one more/i })).toBeVisible();
}

function entriesList(page: Page) {
	return page.getByRole('list', { name: /History entries for/ });
}

async function gotoHistory(page: Page): Promise<void> {
	await page.goto('/history');
	await page.waitForLoadState('networkidle');
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'History', level: 1 })
	).toBeVisible();
}

test('backup & restore: replace-all round-trips the dataset', async ({ page }, testInfo) => {
	// 1. Seed a vehicle + one fuel log (forint).
	await createVehicle(page, 'Backup Smoke');
	await addFuelLog(page, { odometer: '50000', quantity: '40', cost: '20000', currency: 'Ft' });

	// 2. Download a backup of this exact state.
	await page.goto('/settings');
	await page.waitForLoadState('networkidle');
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download backup' }).click();
	const download = await downloadPromise;
	const backupPath = testInfo.outputPath('passanger-backup.json');
	await download.saveAs(backupPath);

	// 3. Mutate AFTER the backup: add a second log (euro). History now shows both.
	await addFuelLog(page, { odometer: '50400', quantity: '38', cost: '50', currency: '€' });
	await gotoHistory(page);
	await expect(entriesList(page).getByText('20000 Ft', { exact: true })).toBeVisible();
	await expect(entriesList(page).getByText('€50.00', { exact: true })).toBeVisible();

	// 4. Restore the backup (replace-all, behind the confirm).
	await page.goto('/settings');
	await page.waitForLoadState('networkidle');
	await page.locator('#settings-restore-file').setInputFiles(backupPath);
	await expect(page.getByRole('alertdialog', { name: /Replace all data/i })).toBeVisible();

	const reloaded = page.waitForEvent('load');
	await page.getByRole('button', { name: 'Replace all' }).click();
	await reloaded;

	// 5. Verify: the backup state is restored — the euro log added after the backup is gone,
	// the forint log from the backup is back.
	await gotoHistory(page);
	await expect(entriesList(page).getByText('20000 Ft', { exact: true })).toBeVisible();
	await expect(entriesList(page).getByText('€50.00', { exact: true })).toHaveCount(0);
});
