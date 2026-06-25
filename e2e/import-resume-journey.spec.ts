import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Story 5.4 (FR-16, UJ-6, SM-6) — the first resume e2e. Drives the import wizard to the value-first
// Preview step, then simulates the "tab closed and reopened" via page.reload() (a reload re-mounts
// the SPA against the same origin's localStorage). Asserts the wizard RESUMES on the persisted step
// rather than restarting at Step 1, axe-scans the resumed surface, and proves the resumed state still
// commits atomically (rows land on /history).

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// A small, valid Fuelly export (detected by the 'fuelup_date' header). car_name matches the vehicle.
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

test('import resume: reload mid-import resumes on the persisted step, then commits', async ({
	page
}, testInfo) => {
	// Seed a vehicle the CSV's rows will match by name.
	await createVehicle(page, 'Renegade');

	// Write the fixture at runtime (the established round-trip pattern — no e2e/fixtures dir).
	const csvPath = testInfo.outputPath('fuelly.csv');
	const fs = await import('node:fs/promises');
	await fs.writeFile(csvPath, FUELLY_CSV, 'utf8');

	// Open the import wizard and advance to the value-first Preview (Step 3).
	await page.goto('/import');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText('Step 1 of 6: Source')).toBeVisible();

	await page.getByRole('button', { name: /Import from Fuelly/i }).click();
	await expect(page.getByText('Step 2 of 6: Upload')).toBeVisible();

	await page.locator('input[type="file"]').setInputFiles(csvPath);
	const continueBtn = page.getByRole('button', { name: /^Continue$/i });
	await expect(continueBtn).toBeEnabled();
	await continueBtn.click();

	await expect(page.getByText('Step 3 of 6: Preview')).toBeVisible();
	await expect(page.getByTestId('import-preview')).toContainText(
		'3 entries spanning Jun 2021 – Jun 2021'
	);

	// --- Simulate tab close + reopen mid-import ---
	await page.reload();
	await page.waitForLoadState('networkidle');

	// RESUME: the wizard lands back on Step 3 (Preview) with its data, NOT Step 1.
	await expect(page.getByText('Step 3 of 6: Preview')).toBeVisible();
	await expect(page.getByText('Step 1 of 6: Source')).toHaveCount(0);
	await expect(page.getByTestId('import-preview')).toContainText(
		'3 entries spanning Jun 2021 – Jun 2021'
	);

	// Axe-scan the resumed surface.
	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'critical' || v.impact === 'serious'
	);
	expect(serious).toEqual([]);

	// The resumed state still commits atomically. Advance: Preview → (Review auto-skips) → Vehicles.
	await page.getByRole('button', { name: /^Continue$/i }).click();
	await expect(page.getByText('Step 5 of 6: Vehicles')).toBeVisible();

	const reviewImportBtn = page.getByTestId('review-import-btn');
	await expect(reviewImportBtn).toBeEnabled();
	await reviewImportBtn.click();

	await expect(page.getByText('Step 6 of 6: Confirm')).toBeVisible();
	await page.getByTestId('import-btn').click();
	await expect(page.getByTestId('import-success')).toBeVisible();

	// Land the imported rows on History (proves the resumed → committed path worked).
	await page.getByRole('button', { name: 'View imported history' }).click();
	await page.waitForLoadState('networkidle');
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'History', level: 1 })
	).toBeVisible();
	await expect(page.getByRole('list', { name: /History entries for/ })).toBeVisible();

	// A committed import must not resurrect: re-opening /import starts fresh at Step 1.
	await page.goto('/import');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText('Step 1 of 6: Source')).toBeVisible();
});
