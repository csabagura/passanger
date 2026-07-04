import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Story 9.1: the guided onboarding wizard replaces the plain single-form first-run. Fresh context
// per test → empty IndexedDB → first-run state on Home (/). This is the AC6 real-path e2e (AI-5.3):
// walk the actual wizard, axe-scan it, verify the seeded reminder lands, and assert the 44px target
// floor that axe is structurally blind to (AI-6.2).

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function openWizard(page: Page): Promise<void> {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: 'No vehicle yet' })).toBeVisible();
	await page.getByRole('button', { name: /Add your vehicle to get started/i }).click();
	await expect(page.getByRole('heading', { name: 'Add your car' })).toBeVisible();
	await expect(page.getByText(/step 1 of 3/i)).toBeVisible();
}

test('onboarding wizard: guided setup lands on a working dashboard and seeds a reminder', async ({
	page
}) => {
	await openWizard(page);

	// Step 1 — vehicle basics.
	await page.getByLabel('Display Name').fill('My Civic');
	await page.getByLabel('Make').fill('Honda');
	await page.getByLabel('Model').fill('Civic');
	await page.getByRole('button', { name: 'Next' }).click();

	// Step 2 — measurement + currency (choose MPG ⇒ mi to exercise the settings write).
	await expect(page.getByText(/units & currency/i)).toBeVisible();
	await page.getByRole('radio', { name: /miles per gallon/i }).check();
	await page.getByRole('button', { name: 'Next' }).click();

	// Step 3 — starting odometer + an opt-in preset reminder.
	await expect(page.getByLabel(/starting odometer/i)).toBeVisible();
	await page.getByLabel(/starting odometer/i).fill('45000');
	await page.getByRole('checkbox', { name: 'Oil change' }).check();
	await page.getByRole('button', { name: 'Finish setup' }).click();

	// Landed on a populated Home dashboard (no first-run CTA, no wizard).
	await expect(page.getByRole('heading', { name: 'No vehicle yet' })).toHaveCount(0);
	await expect(page.getByText(/No entries yet for/i)).toBeVisible();

	// The seeded reminder is real — it shows on the Maintain surface.
	await page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'Maintain' })
		.click();
	await page.waitForLoadState('networkidle');
	await expect(page.getByText('Oil change')).toBeVisible();
});

test('onboarding wizard step 1 has no critical/serious WCAG 2.1 AA violations', async ({
	page
}) => {
	await openWizard(page);
	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'critical' || v.impact === 'serious'
	);
	expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});

test('onboarding controls meet the 44px target floor (AI-6.2, axe-blind)', async ({ page }) => {
	await openWizard(page);
	// Primary "Next" button (size lg) on step 1.
	const nextBox = await page.getByRole('button', { name: 'Next' }).boundingBox();
	expect(nextBox!.height).toBeGreaterThanOrEqual(44);

	// Advance to step 3 and check a preset-reminder row (min-h-11 = 44px).
	await page.getByLabel('Display Name').fill('My Civic');
	await page.getByLabel('Make').fill('Honda');
	await page.getByLabel('Model').fill('Civic');
	await page.getByRole('button', { name: 'Next' }).click();
	await page.getByRole('button', { name: 'Next' }).click();
	const presetRow = page.getByText('Oil change').locator('xpath=ancestor::label');
	const rowBox = await presetRow.boundingBox();
	expect(rowBox!.height).toBeGreaterThanOrEqual(44);
});
