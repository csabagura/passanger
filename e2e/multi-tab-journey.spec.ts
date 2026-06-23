import { test, expect, type Page } from '@playwright/test';

// Multi-tab safety. Two same-origin tabs in ONE browser context share IndexedDB, localStorage AND
// BroadcastChannel, so a committed write / settings change / restore in tab A reconciles tab B.
// Each spec drives tab A and asserts on tab B WITHOUT reloading tab B (except where the feature
// explicitly asks the user to reload, after a restore). There is no `storage` listener in the app,
// so tab B reacting at all is proof the BroadcastChannel signal layer works.

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

	await expect(page.getByRole('status').filter({ hasText: /Saved|log one more/i })).toBeVisible();
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

test('data and settings changes in one tab reconcile another open tab', async ({ context }) => {
	const tabA = await context.newPage();
	await createVehicle(tabA, 'Sync Car');
	await addFuelLog(tabA, { odometer: '50000', quantity: '40', cost: '20000', currency: 'Ft' });

	// Tab B opens on History and sees the seeded log (shared IndexedDB + localStorage vehicle id).
	const tabB = await context.newPage();
	await gotoHistory(tabB);
	await expect(entriesList(tabB).getByText('20000 Ft', { exact: true })).toBeVisible();

	// (1) A write in tab A reaches tab B with no reload, and surfaces the subtle cue.
	await addFuelLog(tabA, { odometer: '50400', quantity: '38', cost: '33000', currency: 'Ft' });
	await expect(entriesList(tabB).getByText('33000 Ft', { exact: true })).toBeVisible();
	await expect(tabB.getByText('Updated in another tab')).toBeVisible();

	// (2) A theme change in tab A reaches tab B with no reload (only the broadcast can trigger this —
	// the app has no storage listener), flipping the document into dark mode.
	await expect(tabB.locator('html')).not.toHaveClass(/dark/);
	await tabA.goto('/settings');
	await tabA.waitForLoadState('networkidle');
	await tabA
		.getByRole('radiogroup', { name: 'Theme' })
		.getByRole('radio', { name: /dark/i })
		.click();
	await expect(tabB.locator('html')).toHaveClass(/dark/);

	await tabA.close();
	await tabB.close();
});

test('a restore in one tab prompts another open tab to reload (never silently swaps data)', async ({
	context
}, testInfo) => {
	const tabA = await context.newPage();
	await createVehicle(tabA, 'Restore Car');
	await addFuelLog(tabA, { odometer: '50000', quantity: '40', cost: '20000', currency: 'Ft' });

	// Download a backup of this exact state.
	await tabA.goto('/settings');
	await tabA.waitForLoadState('networkidle');
	const downloadPromise = tabA.waitForEvent('download');
	await tabA.getByRole('button', { name: 'Download backup' }).click();
	const download = await downloadPromise;
	const backupPath = testInfo.outputPath('passanger-backup.json');
	await download.saveAs(backupPath);

	// Mutate AFTER the backup so the restore is observably destructive.
	await addFuelLog(tabA, { odometer: '50400', quantity: '38', cost: '99000', currency: 'Ft' });

	// Tab B opens on History and sees both logs.
	const tabB = await context.newPage();
	await gotoHistory(tabB);
	await expect(entriesList(tabB).getByText('99000 Ft', { exact: true })).toBeVisible();

	// Restore the backup in tab A (replace-all, behind the confirm). Tab A reloads itself.
	await tabA.goto('/settings');
	await tabA.waitForLoadState('networkidle');
	await tabA.locator('#settings-restore-file').setInputFiles(backupPath);
	await expect(tabA.getByRole('alertdialog', { name: /Replace all data/i })).toBeVisible();
	const tabAReloaded = tabA.waitForEvent('load');
	await tabA.getByRole('button', { name: 'Replace all' }).click();
	await tabAReloaded;

	// Tab B shows the prominent reload prompt and does NOT auto-reload or silently swap — the stale
	// post-backup row is still on screen until the user acts.
	await expect(tabB.getByText(/replaced by a restore in another tab/i)).toBeVisible();
	await expect(entriesList(tabB).getByText('99000 Ft', { exact: true })).toBeVisible();

	// Clicking Reload rehydrates tab B to the restored (pre-mutation) state.
	const tabBReloaded = tabB.waitForEvent('load');
	await tabB.getByRole('button', { name: 'Reload' }).click();
	await tabBReloaded;
	await gotoHistory(tabB);
	await expect(entriesList(tabB).getByText('20000 Ft', { exact: true })).toBeVisible();
	await expect(entriesList(tabB).getByText('99000 Ft', { exact: true })).toHaveCount(0);

	await tabA.close();
	await tabB.close();
});
