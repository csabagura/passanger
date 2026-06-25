import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Story 5.3 — the first import e2e journey. Exercises the full upload → value-first Preview → commit
// path of the reshaped wizard, asserts the preview's value (entry count + date span + total spend)
// is real text shown BEFORE the final commit, and axe-scans the post-upload Preview surface (SM-7).

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// A small, valid Fuelly export (detected by the 'fuelup_date' header). Dates all in Jun 2021 so the
// span renders deterministically as "Jun 2021 – Jun 2021". car_name matches the seeded vehicle.
const FUELLY_CSV = [
	'fuelup_date,odometer,litres,price,notes,car_name',
	'06/06/2021,186886,57.432,1.27,,Renegade',
	'06/12/2021,187205,50.441,1.32,,Renegade',
	'06/19/2021,187500,45.2,1.40,,Renegade'
].join('\n');

async function createVehicle(page: Page, name: string): Promise<void> {
	await page.goto('/');
	await page.waitForLoadState('networkidle');

	await expect(page.getByRole('heading', { name: 'No vehicle yet' })).toBeVisible();
	await page.getByRole('button', { name: /Add your vehicle to get started/i }).click();

	await page.getByLabel('Display Name').fill(name);
	await page.getByLabel('Make').fill('Jeep');
	await page.getByLabel('Model').fill('Renegade');
	await page.getByRole('button', { name: 'Save vehicle' }).click();

	await expect(page.getByText(/No entries yet for/i)).toBeVisible();
}

test('import: upload → value-first Preview (before commit) → commit lands rows', async ({
	page
}, testInfo) => {
	// Seed a vehicle the CSV's rows will match by name.
	await createVehicle(page, 'Renegade');

	// Write the fixture at runtime (no e2e/fixtures dir exists — the established round-trip pattern).
	const csvPath = testInfo.outputPath('fuelly.csv');
	await testInfo.attach('fuelly.csv', { body: FUELLY_CSV, contentType: 'text/csv' });
	const fs = await import('node:fs/promises');
	await fs.writeFile(csvPath, FUELLY_CSV, 'utf8');

	// Open the import wizard.
	await page.goto('/import');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText('Step 1 of 6: Source')).toBeVisible();

	// Step 1: choose Fuelly.
	await page.getByRole('button', { name: /Import from Fuelly/i }).click();
	await expect(page.getByText('Step 2 of 6: Upload')).toBeVisible();

	// Step 2: upload the CSV (the file input is sr-only, no id).
	await page.locator('input[type="file"]').setInputFiles(csvPath);
	const continueBtn = page.getByRole('button', { name: /^Continue$/i });
	await expect(continueBtn).toBeEnabled();
	await continueBtn.click();

	// Step 3: the value-first Preview. Its value is real selectable text and appears BEFORE commit.
	await expect(page.getByText('Step 3 of 6: Preview')).toBeVisible();
	const preview = page.getByTestId('import-preview');
	await expect(preview).toContainText('3 entries spanning Jun 2021 – Jun 2021');
	await expect(preview).toContainText('Total spend');
	await expect(preview).toContainText('Amounts shown in');
	// The mapping is demoted to an optional disclosure, not a mandatory wall.
	await expect(page.getByText('How we mapped this')).toBeVisible();

	// No data has been committed yet — History is still empty.
	// (We assert this implicitly by only reaching History after the commit below.)

	// Axe-scan the post-upload Preview surface (SM-7 / DEC-16).
	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'critical' || v.impact === 'serious'
	);
	expect(serious).toEqual([]);

	// Advance: Preview → (Review auto-skips, all valid) → Vehicles.
	await page.getByRole('button', { name: /^Continue$/i }).click();
	await expect(page.getByText('Step 5 of 6: Vehicles')).toBeVisible();

	// Step 5: the source vehicle auto-matches the seeded "Renegade"; proceed to Confirm.
	const reviewImportBtn = page.getByTestId('review-import-btn');
	await expect(reviewImportBtn).toBeEnabled();
	await reviewImportBtn.click();

	// Step 6: commit.
	await expect(page.getByText('Step 6 of 6: Confirm')).toBeVisible();
	await page.getByTestId('import-btn').click();
	await expect(page.getByTestId('import-success')).toBeVisible();

	// Land the imported rows on History.
	await page.getByRole('button', { name: 'View imported history' }).click();
	await page.waitForLoadState('networkidle');
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'History', level: 1 })
	).toBeVisible();
	await expect(page.getByRole('list', { name: /History entries for/ })).toBeVisible();
});
