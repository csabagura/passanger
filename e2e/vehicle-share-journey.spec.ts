import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Story 9.3 (Per-car export handoff). Real-path e2e (AI-5.3): seed a car + a fuel log, EXPORT it to a
// local file from the Settings vehicle row, then RE-IMPORT that file as a new car — proving the round
// trip creates a second, correctly-remapped vehicle (its history rides along under regenerated ids).
// Fresh context per test → empty IndexedDB → first-run wizard on Home. No network anywhere (Blob
// download + file.text() import; connect-src 'none' is untouched).

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function onboardFirstVehicle(page: Page, name: string): Promise<void> {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /Add your vehicle to get started/i }).click();
	await expect(page.getByRole('heading', { name: 'Add your car' })).toBeVisible();

	await page.getByLabel('Display Name').fill(name);
	await page.getByLabel('Make').fill('Honda');
	await page.getByLabel('Model').fill('Civic');
	await page.getByRole('button', { name: 'Next' }).click();
	await page.getByRole('button', { name: 'Next' }).click();
	await page.getByRole('button', { name: 'Finish setup' }).click();

	// Wait for the wizard to fully close (its save is async — a premature nav aborts it; see
	// archive-restore-journey for the full rationale).
	await expect(page.getByText(/step \d+ of \d+/i)).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'No vehicle yet' })).toHaveCount(0);
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
	await sheet.getByLabel('Currency').selectOption(values.currency);
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();

	await expect(sheet.getByRole('status').filter({ hasText: /Saved|log one more/i })).toBeVisible();
	await sheet.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(page.getByText('Log an entry')).toHaveCount(0);
}

function entriesList(page: Page) {
	return page.getByRole('list', { name: /History entries for/ });
}

test('per-car export → re-import creates a new, correctly-remapped vehicle', async ({
	page
}, testInfo) => {
	// 1. Seed one car + a fuel log with a distinctive cost (the proof-of-remap marker).
	await onboardFirstVehicle(page, 'Shared Ride');
	await addFuelLog(page, { odometer: '50000', quantity: '40', cost: '12345', currency: 'Ft' });

	// 2. Export that car from its Settings row → capture the local Blob download.
	await page.goto('/settings');
	await page.waitForLoadState('networkidle');
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: /Export Shared Ride to a file/i }).click();
	const download = await downloadPromise;
	// The filename is the per-car sibling of the backup: passanger-car-<slug>-YYYY-MM-DD.json.
	expect(download.suggestedFilename()).toMatch(
		/^passanger-car-shared-ride-\d{4}-\d{2}-\d{2}\.json$/
	);
	const sharePath = testInfo.outputPath('shared-car.json');
	await download.saveAs(sharePath);

	// 3. Re-import the file as a NEW car (behind the confirm) — additive, no reload.
	await page.locator('#settings-car-import-file').setInputFiles(sharePath);
	await expect(page.getByRole('alertdialog', { name: /Add this car/i })).toBeVisible();
	await page.getByRole('button', { name: /^Add car$/i }).click();

	// A new vehicle now exists: the count went 1 → 2, and the success notice names it.
	await expect(page.getByText(/Added "Shared Ride" from the shared file/i)).toBeVisible();
	await expect(page.getByText(/2 of 5 vehicles/i)).toBeVisible();

	// 4. Prove the import REMAPPED the child rows onto the new vehicle (not left dangling on the
	// original): archive the ORIGINAL (first row, lower id) so the active vehicle re-points to the
	// imported copy, then confirm the copy's History still carries the remapped fuel log.
	await page
		.getByRole('button', { name: /archive shared ride/i })
		.first()
		.click();
	await expect(page.getByRole('alertdialog')).toBeVisible();
	await page.getByRole('button', { name: /confirm archive/i }).click();

	// One active 'Shared Ride' (the imported copy) remains; the original is archived.
	const activeList = page.getByRole('list', { name: /^vehicle list$/i });
	await expect(activeList.getByText('Shared Ride')).toHaveCount(1);
	await expect(
		page.getByRole('list', { name: /archived vehicles/i }).getByText('Shared Ride')
	).toBeVisible();

	// The active vehicle is now the imported copy — its History shows the remapped log.
	await page.goto('/history');
	await page.waitForLoadState('networkidle');
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'History', level: 1 })
	).toBeVisible();
	await expect(entriesList(page).getByText('12345 Ft', { exact: true })).toBeVisible();
});

test('a per-car file is rejected by the full-restore input (mutual rejection)', async ({
	page
}, testInfo) => {
	await onboardFirstVehicle(page, 'Shared Ride');

	// Export a per-car file.
	await page.goto('/settings');
	await page.waitForLoadState('networkidle');
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: /Export Shared Ride to a file/i }).click();
	const download = await downloadPromise;
	const sharePath = testInfo.outputPath('shared-car.json');
	await download.saveAs(sharePath);

	// Feeding it to the FULL-backup restore input must be rejected (it has no `vehicles`/`settings`).
	await page.locator('#settings-restore-file').setInputFiles(sharePath);
	await expect(page.getByRole('alertdialog', { name: /Replace all data/i })).toHaveCount(0);
	await expect(page.getByRole('alert')).toBeVisible();
});

test('the import-a-car control has no critical/serious WCAG 2.1 AA violations', async ({
	page
}, testInfo) => {
	await onboardFirstVehicle(page, 'Shared Ride');

	await page.goto('/settings');
	await page.waitForLoadState('networkidle');
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: /Export Shared Ride to a file/i }).click();
	const download = await downloadPromise;
	const sharePath = testInfo.outputPath('shared-car.json');
	await download.saveAs(sharePath);

	// Open the confirm dialog so the axe scan covers the alertdialog too.
	await page.locator('#settings-car-import-file').setInputFiles(sharePath);
	await expect(page.getByRole('alertdialog', { name: /Add this car/i })).toBeVisible();

	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'critical' || v.impact === 'serious'
	);
	expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});
